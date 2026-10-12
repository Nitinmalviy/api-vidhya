import mongoose, { type ClientSession, Types } from 'mongoose';
import { Wallet, type IWallet, type WalletOwnerType } from '../models/Wallet';
import {
  WalletEntry,
  type WalletBucket,
  type WalletDirection,
  type WalletEntryKind,
} from '../models/WalletEntry';
import { Appointment, ONLINE_PAYMENT_METHODS, type AppointmentPaymentMethod } from '../models/Appointment';
import { BadRequestError } from '../utils/AppError';
import { createNotification } from './notification';

/**
 * Every rupee that moves between wallets goes through this file.
 *
 * Rules that keep the books straight:
 *  - amounts are integer paise;
 *  - each balance change and its ledger entry are written in ONE MongoDB
 *    transaction (needs a replica set — Atlas always is one);
 *  - each ledger entry has a unique idempotency key, so replays (webhook
 *    retries, double clicks) are no-ops instead of double credits;
 *  - debits are conditional updates (`balance >= amount`), so a wallet can
 *    never go negative even under concurrent requests.
 */

export const toPaise = (rupees: number): number => Math.round(rupees * 100);
export const toRupees = (paise: number): number => Math.round(paise) / 100;

export class InsufficientFundsError extends BadRequestError {
  constructor(message = 'Insufficient wallet balance') {
    super(message);
  }
}

export interface LedgerOp {
  ownerType: WalletOwnerType;
  ownerId: Types.ObjectId | string;
  bucket: WalletBucket;
  direction: WalletDirection;
  amount: number; // paise
  kind: WalletEntryKind;
  description: string;
  refType?: 'Appointment' | 'Transaction' | 'Withdrawal' | 'LabBooking';
  refId?: Types.ObjectId | string;
}

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;

/** Runs `fn` in a transaction, retrying transient errors as the driver advises. */
export async function inTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}

export async function getOrCreateWallet(
  ownerType: WalletOwnerType,
  ownerId: Types.ObjectId | string,
  session?: ClientSession
) {
  const filter = { ownerType, ownerId: new Types.ObjectId(String(ownerId)) };
  try {
    return await Wallet.findOneAndUpdate(
      filter,
      { $setOnInsert: { balance: 0, pending: 0, currency: 'INR' } },
      { upsert: true, new: true, session }
    );
  } catch (err) {
    // Two first-ever requests raced on the upsert; the other one created it.
    if (isDuplicateKey(err)) {
      const existing = await Wallet.findOne(filter).session(session ?? null);
      if (existing) return existing;
    }
    throw err;
  }
}

/**
 * Applies ledger ops inside an open transaction. `key` makes the whole posting
 * idempotent: op i is stored under `${key}#${i}`. Returns false when the
 * posting was already applied earlier.
 */
export async function post(key: string, ops: LedgerOp[], session: ClientSession): Promise<boolean> {
  if (await WalletEntry.exists({ idempotencyKey: `${key}#0` }).session(session)) return false;

  for (const [i, op] of ops.entries()) {
    if (!Number.isInteger(op.amount) || op.amount <= 0) {
      throw new Error(`Ledger amount must be positive integer paise, got ${op.amount}`);
    }
    const wallet = await getOrCreateWallet(op.ownerType, op.ownerId, session);
    const delta = op.direction === 'CREDIT' ? op.amount : -op.amount;
    const guard = op.direction === 'DEBIT' ? { [op.bucket]: { $gte: op.amount } } : {};

    const updated = await Wallet.findOneAndUpdate(
      { _id: wallet._id, ...guard },
      { $inc: { [op.bucket]: delta } },
      { new: true, session }
    );
    if (!updated) throw new InsufficientFundsError();

    await WalletEntry.create(
      [
        {
          walletId: wallet._id,
          ownerType: op.ownerType,
          ownerId: op.ownerId,
          kind: op.kind,
          direction: op.direction,
          bucket: op.bucket,
          amount: op.amount,
          balanceAfter: updated[op.bucket as keyof Pick<IWallet, 'balance' | 'pending'>],
          idempotencyKey: `${key}#${i}`,
          description: op.description,
          refType: op.refType,
          refId: op.refId,
        },
      ],
      { session }
    );
  }
  return true;
}

/** `post` in its own transaction. A concurrent duplicate resolves to `false`. */
export async function postOnce(key: string, ops: LedgerOp[]): Promise<boolean> {
  try {
    return await inTransaction((session) => post(key, ops, session));
  } catch (err) {
    if (isDuplicateKey(err)) return false;
    throw err;
  }
}

// ── Patient top-up ───────────────────────────────────────────────────────────

export function creditTopup(params: {
  patientId: string;
  amount: number; // paise
  transactionId: string;
  razorpayOrderId: string;
}): Promise<boolean> {
  return postOnce(`topup:${params.razorpayOrderId}`, [
    {
      ownerType: 'patient',
      ownerId: params.patientId,
      bucket: 'balance',
      direction: 'CREDIT',
      amount: params.amount,
      kind: 'TOPUP',
      description: 'Added money via Razorpay',
      refType: 'Transaction',
      refId: params.transactionId,
    },
  ]);
}

// ── Appointments ─────────────────────────────────────────────────────────────

const apptLabel = (a: { date: string; timeSlot: string }) => `${a.date}, ${a.timeSlot}`;

/**
 * Marks a BOOKED, UNPAID appointment as paid and books the doctor's fee into
 * their `pending` bucket. With method WALLET the patient's wallet is debited
 * in the same transaction. Throws if the appointment is not payable.
 */
export async function settleAppointmentPayment(params: {
  appointmentId: string;
  patientId: string;
  amount: number; // paise
  method: AppointmentPaymentMethod;
  session: ClientSession;
}): Promise<void> {
  const { appointmentId, patientId, amount, method, session } = params;

  const appt = await Appointment.findOneAndUpdate(
    { _id: appointmentId, patientId, status: 'BOOKED', paymentStatus: { $ne: 'PAID' }, source: { $ne: 'OFFLINE' } },
    { paymentStatus: 'PAID', paymentMethod: method, amountPaid: amount, paidAt: new Date() },
    { new: true, session }
  );
  if (!appt) throw new BadRequestError('This appointment is already paid or no longer payable');

  const ops: LedgerOp[] = [];
  if (method === 'WALLET') {
    ops.push({
      ownerType: 'patient',
      ownerId: patientId,
      bucket: 'balance',
      direction: 'DEBIT',
      amount,
      kind: 'APPOINTMENT_PAYMENT',
      description: `Consultation · ${apptLabel(appt)}`,
      refType: 'Appointment',
      refId: appt._id,
    });
  }
  ops.push({
    ownerType: 'doctor',
    ownerId: appt.doctorId,
    bucket: 'pending',
    direction: 'CREDIT',
    amount,
    kind: 'CONSULT_EARNING',
    description: `Consultation fee · ${apptLabel(appt)}`,
    refType: 'Appointment',
    refId: appt._id,
  });

  await post(`appt-pay:${appointmentId}`, ops, session);
}

/** Moves a completed consultation's fee from the doctor's pending to available balance. */
export async function releaseAppointmentEarning(appointmentId: string): Promise<boolean> {
  const appt = await Appointment.findById(appointmentId).lean();
  if (!appt || appt.paymentStatus !== 'PAID' || !appt.amountPaid) return false;
  // Fees collected at the clinic never entered the ledger, so there is nothing to release.
  if (!appt.paymentMethod || !ONLINE_PAYMENT_METHODS.includes(appt.paymentMethod)) return false;

  return postOnce(`appt-release:${appointmentId}`, [
    {
      ownerType: 'doctor',
      ownerId: appt.doctorId,
      bucket: 'pending',
      direction: 'DEBIT',
      amount: appt.amountPaid,
      kind: 'EARNING_RELEASED',
      description: `Consult completed · ${apptLabel(appt)}`,
      refType: 'Appointment',
      refId: appt._id,
    },
    {
      ownerType: 'doctor',
      ownerId: appt.doctorId,
      bucket: 'balance',
      direction: 'CREDIT',
      amount: appt.amountPaid,
      kind: 'EARNING_RELEASED',
      description: `Consult completed · ${apptLabel(appt)}`,
      refType: 'Appointment',
      refId: appt._id,
    },
  ]);
}

/**
 * Refunds a cancelled, paid appointment to the patient's wallet and takes the
 * fee back out of the doctor's pending bucket. Returns the refunded paise, or
 * 0 when there was nothing to refund.
 */
export async function refundCancelledAppointment(appointmentId: string): Promise<number> {
  try {
    return await inTransaction(async (session) => {
      const appt = await Appointment.findOneAndUpdate(
        // Only platform payments are refunded to the wallet; cash/UPI taken at the clinic is
        // settled by the doctor in person.
        { _id: appointmentId, status: 'CANCELLED', paymentStatus: 'PAID', paymentMethod: { $in: ONLINE_PAYMENT_METHODS } },
        { paymentStatus: 'REFUNDED' },
        { new: true, session }
      );
      if (!appt || !appt.amountPaid || !appt.patientId) return 0;

      await post(
        `appt-refund:${appointmentId}`,
        [
          {
            ownerType: 'doctor',
            ownerId: appt.doctorId,
            bucket: 'pending',
            direction: 'DEBIT',
            amount: appt.amountPaid,
            kind: 'EARNING_REVERSED',
            description: `Cancelled · ${apptLabel(appt)}`,
            refType: 'Appointment',
            refId: appt._id,
          },
          {
            ownerType: 'patient',
            ownerId: appt.patientId,
            bucket: 'balance',
            direction: 'CREDIT',
            amount: appt.amountPaid,
            kind: 'APPOINTMENT_REFUND',
            description: `Refund · cancelled booking ${apptLabel(appt)}`,
            refType: 'Appointment',
            refId: appt._id,
          },
        ],
        session
      );
      return appt.amountPaid;
    });
  } catch (err) {
    if (isDuplicateKey(err)) return 0;
    throw err;
  }
}

/** Tells both sides a booking is paid. Call after the payment transaction commits. */
export async function notifyAppointmentPaid(appointmentId: string): Promise<void> {
  const appt = await Appointment.findById(appointmentId).select('patientId doctorId date timeSlot amountPaid paymentMethod').lean();
  if (!appt?.amountPaid || !appt.patientId) return;
  const amount = `₹${toRupees(appt.amountPaid).toLocaleString('en-IN')}`;
  const via = appt.paymentMethod === 'WALLET' ? 'from your VidhyaCare wallet' : 'via Razorpay';
  await createNotification({
    userId: appt.patientId,
    role: 'patient',
    type: 'GENERAL',
    title: 'Payment successful',
    message: `${amount} paid ${via} for your appointment on ${apptLabel(appt)}.`,
  });
  await createNotification({
    userId: appt.doctorId,
    role: 'doctor',
    type: 'GENERAL',
    title: 'Booking paid',
    message: `${amount} received for ${apptLabel(appt)}. It moves to your available balance once you mark the consult complete.`,
  });
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function walletSummary(ownerType: WalletOwnerType, ownerId: string, limit = 50) {
  const wallet = await getOrCreateWallet(ownerType, ownerId);
  const entries = await WalletEntry.find({ walletId: wallet._id })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .lean();

  return {
    balance: toRupees(wallet.balance),
    pending: toRupees(wallet.pending),
    currency: wallet.currency,
    entries: entries.map((e) => ({
      id: String(e._id),
      kind: e.kind,
      direction: e.direction,
      bucket: e.bucket,
      amount: toRupees(e.amount),
      description: e.description,
      createdAt: e.createdAt ?? null,
    })),
  };
}
