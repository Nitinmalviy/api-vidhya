import mongoose, { Schema, type Types } from 'mongoose';

export type TransactionStatus = 'PENDING' | 'SUCCESS' | 'FAILED';
export type TransactionType = 'SUBSCRIPTION' | 'APPOINTMENT';

export interface ITransaction {
  patientId: Types.ObjectId;
  amount: number;
  currency: string;
  type: TransactionType;
  status: TransactionStatus;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  metadata?: Record<string, any>;
}

const transactionSchema = new Schema<ITransaction>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'INR' },
    type: { type: String, enum: ['SUBSCRIPTION', 'APPOINTMENT'], required: true },
    status: { type: String, enum: ['PENDING', 'SUCCESS', 'FAILED'], default: 'PENDING' },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

export const Transaction = mongoose.model<ITransaction>('Transaction', transactionSchema);
