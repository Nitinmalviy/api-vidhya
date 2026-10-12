import mongoose, { Schema, type Types } from 'mongoose';
import type { WalletOwnerType } from './Wallet';

export type WalletBucket = 'balance' | 'pending';
export type WalletDirection = 'CREDIT' | 'DEBIT';

export type WalletEntryKind =
  /** Patient added money through Razorpay. */
  | 'TOPUP'
  /** Patient paid for an appointment from the wallet. */
  | 'APPOINTMENT_PAYMENT'
  /** Patient refunded for a cancelled, paid appointment. */
  | 'APPOINTMENT_REFUND'
  /** Doctor's fee for a paid appointment, held in `pending`. */
  | 'CONSULT_EARNING'
  /** Doctor's fee moved from `pending` to `balance` once the consult is completed. */
  | 'EARNING_RELEASED'
  /** Doctor's pending fee reversed because the appointment was cancelled. */
  | 'EARNING_REVERSED'
  /** Doctor withdrew to their bank account. */
  | 'WITHDRAWAL'
  /** A failed / reversed / rejected withdrawal returned to the doctor. */
  | 'WITHDRAWAL_REVERSAL';

/**
 * Append-only ledger. Every change to a wallet writes exactly one entry per
 * bucket it touches, and `idempotencyKey` is unique, so a retried webhook or a
 * double-clicked button can never move money twice.
 */
export interface IWalletEntry {
  walletId: Types.ObjectId;
  ownerType: WalletOwnerType;
  ownerId: Types.ObjectId;
  kind: WalletEntryKind;
  direction: WalletDirection;
  bucket: WalletBucket;
  amount: number; // paise, always positive
  balanceAfter: number; // value of `bucket` after this entry, paise
  idempotencyKey: string;
  description: string;
  refType?: 'Appointment' | 'Transaction' | 'Withdrawal';
  refId?: Types.ObjectId;
  createdAt?: Date;
}

const walletEntrySchema = new Schema<IWalletEntry>(
  {
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true },
    ownerType: { type: String, enum: ['patient', 'doctor'], required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    kind: {
      type: String,
      enum: [
        'TOPUP',
        'APPOINTMENT_PAYMENT',
        'APPOINTMENT_REFUND',
        'CONSULT_EARNING',
        'EARNING_RELEASED',
        'EARNING_REVERSED',
        'WITHDRAWAL',
        'WITHDRAWAL_REVERSAL',
      ],
      required: true,
    },
    direction: { type: String, enum: ['CREDIT', 'DEBIT'], required: true },
    bucket: { type: String, enum: ['balance', 'pending'], required: true },
    amount: { type: Number, required: true, min: 1 },
    balanceAfter: { type: Number, required: true },
    idempotencyKey: { type: String, required: true, unique: true },
    description: { type: String, required: true, maxlength: 200 },
    refType: { type: String, enum: ['Appointment', 'Transaction', 'Withdrawal'] },
    refId: { type: Schema.Types.ObjectId },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

walletEntrySchema.index({ walletId: 1, createdAt: -1 });

export const WalletEntry = mongoose.model<IWalletEntry>('WalletEntry', walletEntrySchema);
