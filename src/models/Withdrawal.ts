import mongoose, { Schema, type Types } from 'mongoose';

/**
 * REQUESTED  wallet debited, payout not yet accepted by RazorpayX
 * PROCESSING RazorpayX accepted the payout (queued / pending / processing)
 * PROCESSED  money reached the bank; `utr` is set
 * FAILED     payout failed or was rejected — amount returned to the wallet
 * REVERSED   bank bounced it after processing — amount returned to the wallet
 */
export type WithdrawalStatus = 'REQUESTED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'REVERSED';

export interface IWithdrawal {
  doctorId: Types.ObjectId;
  amount: number; // paise
  status: WithdrawalStatus;
  mode: 'IMPS' | 'NEFT';
  bank: { holderName: string; ifsc: string; last4: string };
  razorpayFundAccountId: string;
  razorpayPayoutId?: string;
  utr?: string;
  failureReason?: string;
  processedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const withdrawalSchema = new Schema<IWithdrawal>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['REQUESTED', 'PROCESSING', 'PROCESSED', 'FAILED', 'REVERSED'],
      default: 'REQUESTED',
    },
    mode: { type: String, enum: ['IMPS', 'NEFT'], default: 'IMPS' },
    bank: {
      holderName: { type: String, required: true },
      ifsc: { type: String, required: true },
      last4: { type: String, required: true },
    },
    razorpayFundAccountId: { type: String, required: true },
    razorpayPayoutId: { type: String, index: { unique: true, sparse: true } },
    utr: { type: String },
    failureReason: { type: String },
    processedAt: { type: Date },
  },
  { timestamps: true }
);

withdrawalSchema.index({ doctorId: 1, createdAt: -1 });

export const Withdrawal = mongoose.model<IWithdrawal>('Withdrawal', withdrawalSchema);
