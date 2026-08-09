import crypto from 'crypto';
import type { Request, Response } from 'express';
import { PLAN_DURATION_DAYS, PLAN_NAMES } from '../../config/razorpay';
import { env } from '../../config/env';
import { Patient } from '../../models/Patient';
import { Subscription, type SubscriptionStatus } from '../../models/Subscription';
import { Transaction } from '../../models/Transaction';
import { createNotification } from '../../services/notification';
import { logger } from '../../utils/logger';

/**
 * Razorpay webhook — the only place a recurring UPI Autopay debit becomes a
 * plan extension. The mandate itself never grants access; money arriving does.
 *
 * Mount with a raw body parser (see app.ts) so the signature can be verified
 * against the exact bytes Razorpay signed.
 *
 * Configure in the Razorpay dashboard → Webhooks:
 *   URL     https://api.vidhyacare.in/api/v1/webhooks/razorpay
 *   Secret  RAZORPAY_WEBHOOK_SECRET
 *   Events  subscription.authenticated, subscription.activated,
 *           subscription.charged, subscription.pending, subscription.halted,
 *           subscription.cancelled, subscription.completed
 */

const fromEpoch = (value: unknown): Date | null =>
  typeof value === 'number' && value > 0 ? new Date(value * 1000) : null;

const fmtDate = (d: Date): string =>
  d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Maps a webhook event to the subscription status it implies. */
const EVENT_STATUS: Record<string, SubscriptionStatus> = {
  'subscription.authenticated': 'authenticated',
  'subscription.activated': 'active',
  'subscription.charged': 'active',
  'subscription.pending': 'pending',
  'subscription.halted': 'halted',
  'subscription.cancelled': 'cancelled',
  'subscription.completed': 'completed',
  'subscription.expired': 'expired',
};

export const handleRazorpayWebhook = async (req: Request, res: Response): Promise<void> => {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('Razorpay webhook hit but RAZORPAY_WEBHOOK_SECRET is not set');
    res.status(503).json({ success: false, message: 'Webhook not configured' });
    return;
  }

  // req.body is a Buffer here (express.raw). Anything else means the raw parser
  // isn't mounted and the signature cannot be trusted.
  if (!Buffer.isBuffer(req.body)) {
    logger.error('Razorpay webhook body is not raw — check the express.raw mount in app.ts');
    res.status(500).json({ success: false, message: 'Webhook misconfigured' });
    return;
  }

  const signature = String(req.headers['x-razorpay-signature'] ?? '');
  const expected = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
  const ok =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!ok) {
    logger.warn('Razorpay webhook signature mismatch — ignoring');
    res.status(400).json({ success: false, message: 'Invalid signature' });
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    res.status(400).json({ success: false, message: 'Malformed payload' });
    return;
  }

  const event = String(payload?.event ?? '');
  const subEntity = payload?.payload?.subscription?.entity;
  const paymentEntity = payload?.payload?.payment?.entity;

  // Acknowledge first-class: Razorpay retries on any non-2xx, and a duplicate
  // delivery must not double-extend a plan. Everything below is idempotent.
  try {
    if (!subEntity?.id) {
      logger.info({ event }, 'Razorpay webhook without a subscription entity — ignored');
      res.status(200).json({ success: true });
      return;
    }

    const record = await Subscription.findOne({ razorpaySubscriptionId: subEntity.id });
    if (!record) {
      logger.warn({ event, subscriptionId: subEntity.id }, 'Webhook for an unknown subscription');
      res.status(200).json({ success: true });
      return;
    }

    const status = EVENT_STATUS[event];
    if (status) record.status = status;
    record.currentStart = fromEpoch(subEntity.current_start);
    record.currentEnd = fromEpoch(subEntity.current_end);
    record.chargeAt = fromEpoch(subEntity.charge_at);
    if (typeof subEntity.paid_count === 'number') record.paidCount = subEntity.paid_count;
    if (paymentEntity?.method) record.paymentMethod = paymentEntity.method;
    if (status === 'cancelled' && !record.cancelledAt) record.cancelledAt = new Date();
    await record.save();

    if (event === 'subscription.charged') {
      await applyCharge(record, paymentEntity);
    } else if (event === 'subscription.halted') {
      await notify(
        record.patientId.toString(),
        'Auto-pay failed',
        'We could not collect your VidhyaCare membership payment. Please pay manually or set up auto-pay again to keep your plan.'
      );
    } else if (event === 'subscription.cancelled') {
      await notify(
        record.patientId.toString(),
        'Auto-pay cancelled',
        'Your membership will not renew automatically. You can re-enable auto-pay any time from Subscription settings.'
      );
    }

    res.status(200).json({ success: true });
  } catch (err) {
    logger.error({ err, event }, 'Razorpay webhook processing failed');
    // 500 makes Razorpay retry, which is what we want for a transient DB error.
    res.status(500).json({ success: false });
  }
};

/**
 * A successful auto-debit: record the money, then extend the plan by one cycle.
 * Extending from the later of "now" and the current expiry means an early debit
 * never shortens what the patient already paid for.
 */
async function applyCharge(
  record: { patientId: unknown; planId: string; amount: number; _id: unknown },
  paymentEntity: any
): Promise<void> {
  const patientId = String(record.patientId);
  const paymentId: string | undefined = paymentEntity?.id;

  // Idempotency: the same payment id must never be booked twice.
  if (paymentId) {
    const already = await Transaction.findOne({ razorpayPaymentId: paymentId }).select('_id').lean();
    if (already) {
      logger.info({ paymentId }, 'Duplicate subscription.charged delivery — already booked');
      return;
    }
  }

  const planName = PLAN_NAMES[record.planId as 'single' | 'family'] ?? 'Premium';
  const amount =
    typeof paymentEntity?.amount === 'number' ? paymentEntity.amount / 100 : record.amount;

  await Transaction.create({
    patientId,
    amount,
    currency: paymentEntity?.currency ?? 'INR',
    type: 'SUBSCRIPTION',
    status: 'SUCCESS',
    // Subscription invoices carry an order id; fall back to the payment id so
    // the unique index still has something stable.
    razorpayOrderId: paymentEntity?.order_id ?? `sub_${paymentId ?? Date.now()}`,
    ...(paymentId ? { razorpayPaymentId: paymentId } : {}),
    metadata: {
      planId: record.planId,
      planName,
      autoPay: true,
      subscriptionId: String(record._id),
      method: paymentEntity?.method ?? 'upi',
    },
  });

  const patient = await Patient.findById(patientId).select('plan planExpiresAt').lean();
  const base =
    patient?.planExpiresAt && patient.planExpiresAt > new Date() ? patient.planExpiresAt : new Date();
  const planExpiresAt = new Date(base.getTime() + PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000);

  await Patient.findByIdAndUpdate(patientId, {
    plan: 'PREMIUM',
    planId: record.planId,
    planExpiresAt,
  });

  await notify(
    patientId,
    'Membership renewed',
    `₹${amount} was debited via auto-pay. Your ${planName} plan is active until ${fmtDate(planExpiresAt)}.`
  );
}

/** In-app notification; never allowed to fail the webhook. */
async function notify(patientId: string, title: string, message: string): Promise<void> {
  try {
    await createNotification({ userId: patientId, role: 'patient', type: 'GENERAL', title, message });
  } catch (err) {
    logger.warn({ err }, 'Autopay notification failed');
  }
}
