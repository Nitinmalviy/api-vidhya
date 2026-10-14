import mongoose, { Schema, type Types } from 'mongoose';

/**
 * Append-only trail of money handled at the clinic desk: who recorded or undid
 * a desk payment, and paid visits that were cancelled (with what was refunded).
 * Nothing in the app updates or deletes these rows.
 */
export type PaymentAuditEvent = 'RECORDED' | 'UNDONE' | 'CANCELLED_PAID';
export type AuditActor = {
  kind: 'doctor' | 'admin';
  id: Types.ObjectId;
  /** Snapshot, so the trail still reads right if the account is renamed or removed. */
  name: string;
  /** Admin role at the time (SUPER_ADMIN / MODERATOR / FRONT_DESK). */
  role?: string;
};

export interface IPaymentAudit {
  appointmentId: Types.ObjectId;
  doctorId: Types.ObjectId;
  /** Visit date (YYYY-MM-DD). */
  visitDate: string;
  patientName: string;
  event: PaymentAuditEvent;
  method?: string;
  /** Paise. */
  amount: number;
  /** Paise returned to the patient's wallet (online payments on cancel). */
  refunded?: number;
  actor: AuditActor;
  createdAt: Date;
}

const paymentAuditSchema = new Schema<IPaymentAudit>(
  {
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true, index: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true },
    visitDate: { type: String, required: true },
    patientName: { type: String, required: true },
    event: { type: String, enum: ['RECORDED', 'UNDONE', 'CANCELLED_PAID'], required: true },
    method: { type: String },
    amount: { type: Number, required: true, min: 0 },
    refunded: { type: Number, min: 0 },
    actor: {
      kind: { type: String, enum: ['doctor', 'admin'], required: true },
      id: { type: Schema.Types.ObjectId, required: true },
      name: { type: String, required: true },
      role: { type: String },
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

paymentAuditSchema.index({ doctorId: 1, createdAt: -1 });
paymentAuditSchema.index({ createdAt: -1 });

// Guard the trail at the model level too.
const refuse = function () {
  throw new Error('Payment audit entries cannot be changed or deleted');
};
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
  paymentAuditSchema.pre(op, refuse);
}

export const PaymentAudit = mongoose.model<IPaymentAudit>('PaymentAudit', paymentAuditSchema);
