import crypto from 'crypto';
import type { Response } from 'express';
import {
  AUTOPAY_PLAN_IDS,
  AUTOPAY_TOTAL_CYCLES,
  PLAN_NAMES,
  PLAN_PRICES,
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  isRazorpayConfigured,
  razorpay,
} from '../../config/razorpay';
import { Patient } from '../../models/Patient';
import {
  ACTIVE_SUBSCRIPTION_STATES,
  Subscription,
  type SubscriptionStatus,
} from '../../models/Subscription';
import type { AuthRequest } from '../../types';
import {
  BadRequestError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from '../../utils/AppError';

const PLAN_IDS = ['single', 'family'] as const;
type PlanId = (typeof PLAN_IDS)[number];

const PLAN_RANK: Record<PlanId, number> = { single: 1, family: 2 };

/** Razorpay sends epoch seconds; nulls are normal for a mandate that isn't live yet. */
const fromEpoch = (value: unknown): Date | null =>
  typeof value === 'number' && value > 0 ? new Date(value * 1000) : null;

function serializeSubscription(s: {
  planId: string;
  status: SubscriptionStatus;
  amount: number;
  chargeAt?: Date | null;
  currentEnd?: Date | null;
  paymentMethod?: string;
  paidCount: number;
  cancelAtCycleEnd: boolean;
  razorpaySubscriptionId: string;
  shortUrl?: string;
}) {
  return {
    planId: s.planId,
    planName: PLAN_NAMES[s.planId as PlanId] ?? s.planId,
    status: s.status,
    amount: s.amount,
    /** Next auto-debit date — what the user actually wants to see. */
    nextChargeAt: s.chargeAt ?? null,
    currentEnd: s.currentEnd ?? null,
    paymentMethod: s.paymentMethod ?? null,
    paidCount: s.paidCount,
    cancelAtCycleEnd: s.cancelAtCycleEnd,
    subscriptionId: s.razorpaySubscriptionId,
    authLink: s.shortUrl ?? null,
    /** True while Razorpay is debiting on schedule. */
    isLive: s.status === 'active' || s.status === 'authenticated',
    /** A failed debit that Razorpay is still retrying, or has given up on. */
    needsAttention: s.status === 'pending' || s.status === 'halted',
  };
}

/** The patient's current mandate, if any is still in play. */
async function findLiveSubscription(patientId: string) {
  return Subscription.findOne({
    patientId,
    status: { $in: ACTIVE_SUBSCRIPTION_STATES },
  }).sort({ createdAt: -1 });
}

/* ─────────────────────────────────────────────
   GET /api/v1/patient/subscription
   Plan state + autopay mandate in one call.
───────────────────────────────────────────── */
export const getSubscription = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const [patient, sub] = await Promise.all([
    Patient.findById(req.user.id).select('plan planId planExpiresAt').lean(),
    findLiveSubscription(req.user.id),
  ]);
  if (!patient) throw new NotFoundError('Patient');

  res.status(200).json({
    success: true,
    data: {
      plan: patient.plan,
      planId: patient.planId ?? null,
      planExpiresAt: patient.planExpiresAt ?? null,
      autoPay: sub ? serializeSubscription(sub) : null,
      /** Autopay can only be offered when the account is wired up for it. */
      autoPayAvailable: isRazorpayConfigured() && !!AUTOPAY_PLAN_IDS.single,
    },
  });
};

/* ─────────────────────────────────────────────
   POST /api/v1/patient/subscription/autopay  { planId }
   Creates the Razorpay subscription. The client then opens Checkout with the
   returned subscriptionId, where the user approves the UPI Autopay mandate.
   Nothing is charged and no plan is granted here — that happens on verify /
   the subscription.charged webhook.
───────────────────────────────────────────── */
export const startAutoPay = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  if (!isRazorpayConfigured()) {
    throw new ServiceUnavailableError('Online payments are not configured yet');
  }

  const { planId } = req.body ?? {};
  if (!PLAN_IDS.includes(planId)) throw new BadRequestError("planId must be 'single' or 'family'");
  const nextPlan = planId as PlanId;

  const razorpayPlanId = AUTOPAY_PLAN_IDS[nextPlan];
  if (!razorpayPlanId) {
    throw new ServiceUnavailableError(
      'Auto-pay is not set up for this plan yet — please use one-time payment'
    );
  }

  const patient = await Patient.findById(req.user.id).select(
    'name email phone plan planId planExpiresAt razorpayCustomerId'
  );
  if (!patient) throw new NotFoundError('Patient');

  // Same downgrade/no-op guard as one-time checkout, so a live Family mandate
  // can't be replaced by a cheaper Single one mid-cycle.
  const planStillActive =
    patient.plan === 'PREMIUM' && !!patient.planExpiresAt && patient.planExpiresAt > new Date();
  if (planStillActive && patient.planId) {
    const currentRank = PLAN_RANK[patient.planId as PlanId] ?? 0;
    if (PLAN_RANK[nextPlan] < currentRank) {
      throw new BadRequestError('You cannot downgrade while your current plan is active');
    }
  }

  const existing = await findLiveSubscription(req.user.id);
  if (existing) {
    if (existing.planId === nextPlan) {
      throw new BadRequestError(
        'Auto-pay is already set up for this plan. Cancel it first if you want to redo the mandate.'
      );
    }
    // Switching plans: revoke the old mandate immediately so the user is never
    // charged twice, then fall through and create the new one.
    try {
      await razorpay.subscriptions.cancel(existing.razorpaySubscriptionId, false);
    } catch (err) {
      req.log?.warn({ err }, 'Could not cancel previous mandate before upgrade');
    }
    existing.status = 'cancelled';
    existing.cancelledAt = new Date();
    await existing.save();
  }

  // Reuse the Razorpay customer so a returning user sees their saved UPI ids.
  let customerId = patient.razorpayCustomerId;
  if (!customerId) {
    try {
      const customer = await razorpay.customers.create({
        name: patient.name,
        email: patient.email,
        contact: patient.phone,
        fail_existing: 0,
      });
      customerId = customer.id;
      patient.razorpayCustomerId = customerId;
      await patient.save();
    } catch (err) {
      // Not fatal — Razorpay will collect the details on the mandate screen.
      req.log?.warn({ err }, 'Could not create Razorpay customer');
    }
  }

  const subscription = await razorpay.subscriptions.create({
    plan_id: razorpayPlanId,
    total_count: AUTOPAY_TOTAL_CYCLES,
    quantity: 1,
    // Razorpay emails/SMSes the mandate + pre-debit notifications for us.
    customer_notify: 1,
    ...(customerId ? { customer_id: customerId } : {}),
    notes: { patientId: String(patient._id), appPlanId: nextPlan },
  });

  const record = await Subscription.create({
    patientId: patient._id,
    planId: nextPlan,
    razorpayPlanId,
    razorpaySubscriptionId: subscription.id,
    ...(customerId ? { razorpayCustomerId: customerId } : {}),
    status: (subscription.status as SubscriptionStatus) ?? 'created',
    amount: PLAN_PRICES[nextPlan],
    ...(subscription.short_url ? { shortUrl: subscription.short_url } : {}),
    currentStart: fromEpoch(subscription.current_start),
    currentEnd: fromEpoch(subscription.current_end),
    chargeAt: fromEpoch(subscription.charge_at),
    paidCount: subscription.paid_count ?? 0,
  });

  res.status(201).json({
    success: true,
    message: 'Approve the UPI Autopay mandate to finish setting up auto-pay',
    data: {
      subscriptionId: subscription.id,
      key: RAZORPAY_KEY_ID,
      planId: nextPlan,
      planName: PLAN_NAMES[nextPlan],
      amount: PLAN_PRICES[nextPlan],
      authLink: record.shortUrl ?? null,
      prefill: { name: patient.name, email: patient.email, contact: patient.phone },
    },
  });
};

/* ─────────────────────────────────────────────
   POST /api/v1/patient/subscription/autopay/verify
   { razorpay_payment_id, razorpay_subscription_id, razorpay_signature }

   Called right after the user approves the mandate in Checkout. Confirms the
   signature so the mandate can be trusted, then reads the live state back from
   Razorpay. The plan itself is granted by the subscription.charged webhook —
   this only records that the mandate exists.
───────────────────────────────────────────── */
export const verifyAutoPay = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body ?? {};

  if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    throw new BadRequestError('Missing mandate confirmation details');
  }

  // For subscriptions the payload is payment_id|subscription_id — the opposite
  // order from one-time orders.
  const expected = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest('hex');

  const provided = String(razorpay_signature);
  const matches =
    expected.length === provided.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  if (!matches) throw new BadRequestError('Invalid mandate signature');

  const record = await Subscription.findOne({
    razorpaySubscriptionId: String(razorpay_subscription_id),
    patientId: req.user.id,
  });
  if (!record) throw new NotFoundError('Subscription');

  // Read the authoritative state instead of assuming 'authenticated'.
  try {
    const live = await razorpay.subscriptions.fetch(String(razorpay_subscription_id));
    record.status = (live.status as SubscriptionStatus) ?? 'authenticated';
    record.currentStart = fromEpoch(live.current_start);
    record.currentEnd = fromEpoch(live.current_end);
    record.chargeAt = fromEpoch(live.charge_at);
    record.paidCount = live.paid_count ?? record.paidCount;
  } catch (err) {
    req.log?.warn({ err }, 'Could not fetch subscription after mandate approval');
    record.status = 'authenticated';
  }
  await record.save();

  res.status(200).json({
    success: true,
    message: 'Auto-pay is set up. Your plan renews automatically every month.',
    data: { autoPay: serializeSubscription(record) },
  });
};

/* ─────────────────────────────────────────────
   POST /api/v1/patient/subscription/autopay/cancel  { immediate? }
   Revokes the UPI mandate. By default the current paid cycle is honoured —
   the plan keeps working until planExpiresAt, it just won't renew.
───────────────────────────────────────────── */
export const cancelAutoPay = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const record = await findLiveSubscription(req.user.id);
  if (!record) throw new BadRequestError('Auto-pay is not active on your account');

  const immediate = req.body?.immediate === true;

  try {
    await razorpay.subscriptions.cancel(record.razorpaySubscriptionId, !immediate);
  } catch (err) {
    req.log?.error({ err }, 'Razorpay mandate cancellation failed');
    throw new BadRequestError('Could not cancel auto-pay right now — please try again');
  }

  record.cancelAtCycleEnd = !immediate;
  record.cancelledAt = new Date();
  // At cycle end Razorpay keeps the subscription active until the date passes,
  // and sends subscription.cancelled then; reflect that rather than lying now.
  if (immediate) record.status = 'cancelled';
  await record.save();

  res.status(200).json({
    success: true,
    message: immediate
      ? 'Auto-pay cancelled. No further payments will be taken.'
      : 'Auto-pay cancelled. Your plan stays active until the end of this cycle and will not renew.',
    data: { autoPay: serializeSubscription(record) },
  });
};
