import mongoose, { Schema, type Types } from 'mongoose';

export type AppointmentType = 'CHECKUP' | 'CONSULTATION' | 'OPD';
export type AppointmentStatus = 'BOOKED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type AppointmentPaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDED';
/**
 * WALLET / RAZORPAY: paid on the platform, so the money sits in the ledger.
 * CLINIC_*: collected by the doctor at the clinic — never touches the wallet ledger.
 */
export type AppointmentPaymentMethod = 'WALLET' | 'RAZORPAY' | 'CLINIC_CASH' | 'CLINIC_UPI' | 'CLINIC_CARD';
export const ONLINE_PAYMENT_METHODS: AppointmentPaymentMethod[] = ['WALLET', 'RAZORPAY'];
export const CLINIC_PAYMENT_METHODS = ['CLINIC_CASH', 'CLINIC_UPI', 'CLINIC_CARD'] as const;

/** ONLINE: booked by the patient in the app. OFFLINE: added by the doctor for a walk-in or phone booking. */
export type AppointmentSource = 'ONLINE' | 'OFFLINE';
/** Timeslot stored for a walk-in that didn't take a bookable slot. */
export const WALK_IN_SLOT = 'Walk-in';

export interface IAppointment {
  /** Missing for an offline booking of someone without a VidhyaCare account. */
  patientId?: Types.ObjectId;
  source: AppointmentSource;
  /** Who the offline booking is for (always set for OFFLINE). */
  guest?: { name: string; phone: string; age?: number; gender?: 'MALE' | 'FEMALE' | 'OTHER' };
  /** Clinic queue number for the day, given at check-in. */
  token?: number;
  checkedInAt?: Date;
  consultStartedAt?: Date;
  completedAt?: Date;
  doctorId: Types.ObjectId;
  type: AppointmentType;
  // Checkup plan details (when type = CHECKUP)
  planName?: string;
  price?: number;
  // Live OPD queue entry (when type = OPD)
  opdSessionId?: Types.ObjectId;
  // Schedule
  date: string; // YYYY-MM-DD
  timeSlot: string; // e.g. "10:30 AM"
  notes?: string;
  status: AppointmentStatus;
  // Payment — `amountPaid` is in paise and is what gets refunded on cancellation.
  paymentStatus: AppointmentPaymentStatus;
  paymentMethod?: AppointmentPaymentMethod;
  amountPaid?: number;
  paidAt?: Date;
}

const appointmentSchema = new Schema<IAppointment>(
  {
    patientId: {
      type: Schema.Types.ObjectId,
      ref: 'Patient',
      index: true,
      required(this: IAppointment) {
        return this.source !== 'OFFLINE';
      },
    },
    source: { type: String, enum: ['ONLINE', 'OFFLINE'], default: 'ONLINE' },
    guest: {
      type: {
        name: { type: String, trim: true, required: true, maxlength: 80 },
        phone: { type: String, trim: true, required: true, maxlength: 20 },
        age: { type: Number, min: 0, max: 120 },
        gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'] },
      },
      _id: false,
    },
    token: { type: Number, min: 1 },
    checkedInAt: { type: Date },
    consultStartedAt: { type: Date },
    completedAt: { type: Date },
    doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
    type: { type: String, enum: ['CHECKUP', 'CONSULTATION', 'OPD'], required: true },
    planName: { type: String, trim: true },
    price: { type: Number },
    opdSessionId: { type: Schema.Types.ObjectId, ref: 'OpdSession', index: true },
    date: { type: String, required: true },
    timeSlot: { type: String, required: true },
    notes: { type: String, trim: true },
    status: { type: String, enum: ['BOOKED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'], default: 'BOOKED' },
    paymentStatus: { type: String, enum: ['UNPAID', 'PAID', 'REFUNDED'], default: 'UNPAID' },
    paymentMethod: { type: String, enum: ['WALLET', 'RAZORPAY', 'CLINIC_CASH', 'CLINIC_UPI', 'CLINIC_CARD'] },
    amountPaid: { type: Number, min: 0 },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

appointmentSchema.index({ doctorId: 1, date: 1 });
appointmentSchema.index({ patientId: 1, createdAt: -1 });
// Returning walk-ins are looked up by phone within one doctor's offline bookings.
appointmentSchema.index({ doctorId: 1, 'guest.phone': 1 }, { partialFilterExpression: { source: 'OFFLINE' } });

export const Appointment = mongoose.model<IAppointment>('Appointment', appointmentSchema);
