import { Types } from 'mongoose';
import { Doctor } from '../models/Doctor';
import { Withdrawal, type IWithdrawal, type WithdrawalStatus } from '../models/Withdrawal';
import { BadRequestError } from '../utils/AppError';
import { logger } from '../utils/logger';
import { createNotification } from './notification';
import { createPayout, RazorpayXError, type RazorpayXPayout } from './razorpayx';
import { inTransaction, post, postOnce, toRupees } from './wallet';

export const MIN_WITHDRAWAL_PAISE = 100_00; // ₹100
export const MAX_WITHDRAWAL_PAISE = 2_00_000_00; // ₹2,00,000 per request (IMPS limit is ₹5L)

/**
 * Debits the doctor's available balance and starts a RazorpayX payout.
 *
 * Order matters: money leaves the wallet first (atomically, guarded against
 * overdraft), THEN the payout is requested. If RazorpayX rejects the request
 * outright, the amount goes straight back. If the call times out we leave it
 * REQUESTED — the payout webhook (or a support retry with the same
 * idempotency key) settles it, so we never pay twice or lose money.
 */
export async function requestWithdrawal(doctorId: string, amount: number) {
  if (!Number.isInteger(amount) || amount < MIN_WITHDRAWAL_PAISE) {
    throw new BadRequestError('Minimum withdrawal is ₹100');
  }
  if (amount > MAX_WITHDRAWAL_PAISE) {
    throw new BadRequestError('Maximum withdrawal is ₹2,00,000 per request');
  }

  const doctor = await Doctor.findById(doctorId).select('payoutAccount kycStatus').lean();
  if (!doctor) throw new BadRequestError('Doctor not found');
  if (doctor.kycStatus !== 'APPROVED') throw new BadRequestError('Complete KYC before withdrawing');
  const acct = doctor.payoutAccount;
  if (!acct?.razorpayFundAccountId) throw new BadRequestError('Add a bank account before withdrawing');

  const withdrawal = await inTransaction(async (session) => {
    const [w] = await Withdrawal.create(
      [
        {
          doctorId,
          amount,
          status: 'REQUESTED',
          mode: 'IMPS',
          bank: { holderName: acct.holderName, ifsc: acct.ifsc, last4: acct.last4 },
          razorpayFundAccountId: acct.razorpayFundAccountId,
        },
      ],
      { session }
    );
    await post(
      `withdraw:${w._id}`,
      [
        {
          ownerType: 'doctor',
          ownerId: doctorId,
          bucket: 'balance',
          direction: 'DEBIT',
          amount,
          kind: 'WITHDRAWAL',
          description: `Withdrawal to bank ···· ${acct.last4}`,
          refType: 'Withdrawal',
          refId: w._id,
        },
      ],
      session
    );
    return w;
  });

  try {
    const payout = await createPayout({
      withdrawalId: String(withdrawal._id),
      fundAccountId: acct.razorpayFundAccountId,
      amount,
      mode: 'IMPS',
    });
    await applyPayoutState(String(withdrawal._id), payout);
  } catch (err) {
    if (err instanceof RazorpayXError && err.status >= 400 && err.status < 500) {
      // Definitive rejection — nothing was paid, so return the money.
      await failWithdrawal(String(withdrawal._id), 'FAILED', err.description ?? 'Payout rejected');
    } else {
      // Network/5xx: outcome unknown. Leave REQUESTED; the webhook settles it.
      logger.error({ err, withdrawalId: String(withdrawal._id) }, 'Payout request outcome unknown');
    }
  }

  return Withdrawal.findById(withdrawal._id).lean();
}

const PAYOUT_STATUS: Record<string, WithdrawalStatus> = {
  queued: 'PROCESSING',
  pending: 'PROCESSING',
  processing: 'PROCESSING',
  processed: 'PROCESSED',
  reversed: 'REVERSED',
  cancelled: 'FAILED',
  rejected: 'FAILED',
  failed: 'FAILED',
};

/**
 * Applies a payout's latest state, from the create call or the webhook.
 * Final states never move backwards, except PROCESSED → REVERSED (a bank bounce).
 */
export async function applyPayoutState(withdrawalId: string, payout: RazorpayXPayout): Promise<void> {
  const next = PAYOUT_STATUS[payout.status];
  if (!next || !Types.ObjectId.isValid(withdrawalId)) return;

  if (next === 'FAILED' || next === 'REVERSED') {
    await failWithdrawal(withdrawalId, next, payout.failure_reason ?? `Payout ${payout.status}`, payout.id);
    return;
  }

  const allowedFrom: WithdrawalStatus[] = next === 'PROCESSED' ? ['REQUESTED', 'PROCESSING'] : ['REQUESTED'];
  const update: Partial<IWithdrawal> = { status: next, razorpayPayoutId: payout.id };
  if (next === 'PROCESSED') {
    update.processedAt = new Date();
    if (payout.utr) update.utr = payout.utr;
  }
  const w = await Withdrawal.findOneAndUpdate(
    { _id: withdrawalId, status: { $in: allowedFrom } },
    update,
    { new: true }
  ).lean();

  if (w && next === 'PROCESSED') {
    await notifyDoctor(
      String(w.doctorId),
      'Withdrawal processed',
      `₹${toRupees(w.amount).toLocaleString('en-IN')} has been sent to your bank account ···· ${w.bank.last4}.`
    );
  }
}

/** Marks a withdrawal failed/reversed and returns the amount to the doctor's wallet exactly once. */
async function failWithdrawal(
  withdrawalId: string,
  status: 'FAILED' | 'REVERSED',
  reason: string,
  payoutId?: string
): Promise<void> {
  const from: WithdrawalStatus[] = status === 'REVERSED' ? ['REQUESTED', 'PROCESSING', 'PROCESSED'] : ['REQUESTED', 'PROCESSING'];
  const w = await Withdrawal.findOneAndUpdate(
    { _id: withdrawalId, status: { $in: from } },
    { status, failureReason: reason, ...(payoutId ? { razorpayPayoutId: payoutId } : {}) },
    { new: true }
  ).lean();
  if (!w) return; // already final

  const refunded = await postOnce(`withdraw-reversal:${withdrawalId}`, [
    {
      ownerType: 'doctor',
      ownerId: w.doctorId,
      bucket: 'balance',
      direction: 'CREDIT',
      amount: w.amount,
      kind: 'WITHDRAWAL_REVERSAL',
      description: `Withdrawal ${status === 'REVERSED' ? 'reversed' : 'failed'} · returned to wallet`,
      refType: 'Withdrawal',
      refId: w._id,
    },
  ]);
  if (refunded) {
    await notifyDoctor(
      String(w.doctorId),
      'Withdrawal could not be completed',
      `₹${toRupees(w.amount).toLocaleString('en-IN')} is back in your VidhyaCare wallet. Reason: ${reason}`
    );
  }
}

async function notifyDoctor(doctorId: string, title: string, message: string): Promise<void> {
  try {
    await createNotification({ userId: doctorId, role: 'doctor', type: 'GENERAL', title, message });
  } catch (err) {
    logger.warn({ err }, 'Withdrawal notification failed');
  }
}
