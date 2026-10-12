import mongoose, { Schema, type Types } from 'mongoose';

export type AppointmentType = 'CHECKUP' | 'CONSULTATION' | 'OPD';
export type AppointmentStatus = 'BOOKED' | 'COMPLETED' | 'CANCELLED';
export type AppointmentPaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDED';
export type AppointmentPaymentMethod = 'WALLET' | 'RAZORPAY';

export interface IAppointment {
  patientId: Types.ObjectId;
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
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
    type: { type: String, enum: ['CHECKUP', 'CONSULTATION', 'OPD'], required: true },
    planName: { type: String, trim: true },
    price: { type: Number },
    opdSessionId: { type: Schema.Types.ObjectId, ref: 'OpdSession', index: true },
    date: { type: String, required: true },
    timeSlot: { type: String, required: true },
    notes: { type: String, trim: true },
    status: { type: String, enum: ['BOOKED', 'COMPLETED', 'CANCELLED'], default: 'BOOKED' },
    paymentStatus: { type: String, enum: ['UNPAID', 'PAID', 'REFUNDED'], default: 'UNPAID' },
    paymentMethod: { type: String, enum: ['WALLET', 'RAZORPAY'] },
    amountPaid: { type: Number, min: 0 },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

appointmentSchema.index({ doctorId: 1, date: 1 });
appointmentSchema.index({ patientId: 1, createdAt: -1 });

export const Appointment = mongoose.model<IAppointment>('Appointment', appointmentSchema);
