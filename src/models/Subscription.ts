import mongoose, { Schema, type Types } from 'mongoose';

/**
 * A Razorpay subscription (UPI Autopay mandate) belonging to a patient.
 *
 * Mirrors Razorpay's own subscription states so the app never has to guess:
 *  created       — subscription made, mandate not yet approved by the user
 *  authenticated — mandate approved, first debit pending
 *  active        — mandate live, debiting every cycle
 *  pending       — a debit failed; Razorpay is retrying
 *  halted        — retries exhausted, no more debits until the user fixes it
 *  cancelled     — mandate revoked (by user or by us)
 *  completed     — all authorised cycles used up
 *  expired       — mandate expired at the bank
 */
export type SubscriptionStatus =
  | 'created'
  | 'authenticated'
  | 'active'
  | 'pending'
  | 'halted'
  | 'cancelled'
  | 'completed'
  | 'expired';

export const ACTIVE_SUBSCRIPTION_STATES: SubscriptionStatus[] = [
  'created',
  'authenticated',
  'active',
  'pending',
];

export interface ISubscription {
  patientId: Types.ObjectId;
  /** Our plan id — 'single' | 'family'. */
  planId: string;
  /** Razorpay plan id the mandate was created against. */
  razorpayPlanId: string;
  razorpaySubscriptionId: string;
  razorpayCustomerId?: string;
  status: SubscriptionStatus;
  /** Rupees per cycle, recorded for receipts. */
  amount: number;
  /** Razorpay's hosted authorisation link — a fallback if Checkout can't open. */
  shortUrl?: string;
  /** Current billing cycle, straight from Razorpay. */
  currentStart?: Date | null;
  currentEnd?: Date | null;
  /** When Razorpay will attempt the next auto-debit. */
  chargeAt?: Date | null;
  /** How the mandate is paid — 'upi' for UPI Autopay, 'card'/'emandate' otherwise. */
  paymentMethod?: string;
  /** Cycles Razorpay reports as already paid. */
  paidCount: number;
  cancelledAt?: Date | null;
  /** True when cancellation was requested but takes effect at cycle end. */
  cancelAtCycleEnd: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    planId: { type: String, required: true },
    razorpayPlanId: { type: String, required: true },
    razorpaySubscriptionId: { type: String, required: true, unique: true },
    razorpayCustomerId: { type: String },
    status: {
      type: String,
      enum: [
        'created',
        'authenticated',
        'active',
        'pending',
        'halted',
        'cancelled',
        'completed',
        'expired',
      ],
      default: 'created',
      index: true,
    },
    amount: { type: Number, required: true },
    shortUrl: { type: String },
    currentStart: { type: Date, default: null },
    currentEnd: { type: Date, default: null },
    chargeAt: { type: Date, default: null },
    paymentMethod: { type: String },
    paidCount: { type: Number, default: 0 },
    cancelledAt: { type: Date, default: null },
    cancelAtCycleEnd: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Subscription = mongoose.model<ISubscription>('Subscription', subscriptionSchema);
