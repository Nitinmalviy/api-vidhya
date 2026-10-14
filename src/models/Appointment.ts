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
  /**
   * True when this booking occupies a bookable time slot (app or clinic slot
   * bookings). Walk-ins and Live OPD calls don't. The unique index below lets
   * only one BOOKED slot-holder exist per doctor, date and time.
   */
  holdsSlot?: boolean;
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
  /** Who entered a desk (CLINIC_*) payment. The full history is in PaymentAudit. */
  paymentRecordedBy?: { kind: 'doctor' | 'admin'; id: Types.ObjectId; name: string; role?: string };
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
    holdsSlot: { type: Boolean },
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
    paymentRecordedBy: {
      type: new Schema(
        {
          kind: { type: String, enum: ['doctor', 'admin'], required: true },
          id: { type: Schema.Types.ObjectId, required: true },
          name: { type: String, required: true },
          role: { type: String },
        },
        { _id: false }
      ),
      required: false,
    },
  },
  { timestamps: true }
);

appointmentSchema.index({ doctorId: 1, date: 1 });
// The database itself refuses a second active booking for the same slot, whether it
// came from the app or the clinic desk, so two people booking at the same moment can't
// both win. Cancelling, completing or a no-show takes the booking out of the index and
// frees the slot; restoring it re-checks.
appointmentSchema.index(
  { doctorId: 1, date: 1, timeSlot: 1 },
  { name: 'one_active_booking_per_slot', unique: true, partialFilterExpression: { status: 'BOOKED', holdsSlot: true } }
);

appointmentSchema.pre('validate', function (next) {
  if (this.holdsSlot === undefined) this.holdsSlot = this.type !== 'OPD' && this.timeSlot !== WALK_IN_SLOT;
  next();
});

/** True when a write failed because another active booking already holds that slot. */
export function isSlotTaken(err: unknown): boolean {
  const e = err as { code?: unknown; keyPattern?: Record<string, unknown>; message?: string };
  return Number(e?.code) === 11000 && (!!e.keyPattern?.timeSlot || String(e.message ?? '').includes('one_active_booking_per_slot'));
}
appointmentSchema.index({ patientId: 1, createdAt: -1 });
// Returning walk-ins are looked up by phone within one doctor's offline bookings.
appointmentSchema.index({ doctorId: 1, 'guest.phone': 1 }, { partialFilterExpression: { source: 'OFFLINE' } });

export const Appointment = mongoose.model<IAppointment>('Appointment', appointmentSchema);
