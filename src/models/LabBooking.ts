import mongoose, { Schema, type Types } from 'mongoose';

export type LabBookingStatus = 'BOOKED' | 'SAMPLE_COLLECTED' | 'COMPLETED' | 'CANCELLED';
export type LabPaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDED';
export type LabPaymentMethod = 'WALLET' | 'RAZORPAY' | 'AT_COLLECTION';

/**
 * A home sample-collection booking at one lab. Test names and prices are
 * copied from the lab at booking time (a snapshot), so a later price change
 * never alters what the patient agreed to pay.
 */
export interface ILabBooking {
  patientId: Types.ObjectId;
  labId: Types.ObjectId;
  labName: string;
  tests: { name: string; price: number; reportTime?: string }[];
  /** Rupees. */
  total: number;
  date: string; // YYYY-MM-DD
  slot: string; // e.g. "07:00 – 08:00 AM"
  address: { line1: string; city?: string; zip?: string; phone: string };
  status: LabBookingStatus;
  paymentStatus: LabPaymentStatus;
  paymentMethod: LabPaymentMethod;
  /** Paise actually collected online or from the wallet. */
  amountPaid?: number;
  cancelledAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const labBookingSchema = new Schema<ILabBooking>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    labId: { type: Schema.Types.ObjectId, ref: 'Lab', required: true },
    labName: { type: String, required: true },
    tests: {
      type: [{ name: String, price: Number, reportTime: String, _id: false }],
      validate: { validator: (v: unknown[]) => v.length > 0 && v.length <= 20, message: 'Pick 1–20 tests' },
    },
    total: { type: Number, required: true, min: 0 },
    date: { type: String, required: true },
    slot: { type: String, required: true },
    address: {
      line1: { type: String, required: true, trim: true, maxlength: 250 },
      city: { type: String, trim: true, maxlength: 100 },
      zip: { type: String, trim: true, maxlength: 10 },
      phone: { type: String, required: true, trim: true, maxlength: 20 },
    },
    status: { type: String, enum: ['BOOKED', 'SAMPLE_COLLECTED', 'COMPLETED', 'CANCELLED'], default: 'BOOKED' },
    paymentStatus: { type: String, enum: ['UNPAID', 'PAID', 'REFUNDED'], default: 'UNPAID' },
    paymentMethod: { type: String, enum: ['WALLET', 'RAZORPAY', 'AT_COLLECTION'], required: true },
    amountPaid: { type: Number, min: 0 },
    cancelledAt: { type: Date },
  },
  { timestamps: true }
);

labBookingSchema.index({ patientId: 1, createdAt: -1 });

export const LabBooking = mongoose.model<ILabBooking>('LabBooking', labBookingSchema);
