import mongoose, { Schema, type Types } from 'mongoose';

export type WalletOwnerType = 'patient' | 'doctor';

/**
 * One wallet per patient and per doctor. All amounts are integer paise so
 * rupee arithmetic never hits floating-point rounding.
 *
 * - `balance`  money the owner can spend (patient) or withdraw (doctor).
 * - `pending`  doctor only: fees for consultations that are paid but not yet
 *              completed. Released to `balance` on completion, reversed on
 *              cancellation.
 *
 * Never $inc these directly — go through services/wallet.ts, which writes the
 * matching ledger entry in the same transaction.
 */
export interface IWallet {
  ownerType: WalletOwnerType;
  ownerId: Types.ObjectId;
  balance: number;
  pending: number;
  currency: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const walletSchema = new Schema<IWallet>(
  {
    ownerType: { type: String, enum: ['patient', 'doctor'], required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    balance: { type: Number, default: 0, min: 0 },
    pending: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'INR' },
  },
  { timestamps: true }
);

walletSchema.index({ ownerType: 1, ownerId: 1 }, { unique: true });

export const Wallet = mongoose.model<IWallet>('Wallet', walletSchema);
