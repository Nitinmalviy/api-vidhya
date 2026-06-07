import mongoose, { Schema, type Types } from 'mongoose';

export type AppointmentType = 'CHECKUP' | 'CONSULTATION';
export type AppointmentStatus = 'BOOKED' | 'COMPLETED' | 'CANCELLED';

export interface IAppointment {
  patientId: Types.ObjectId;
  doctorId: Types.ObjectId;
  type: AppointmentType;
  // Checkup plan details (when type = CHECKUP)
  planName?: string;
  price?: number;
  // Schedule
  date: string; // YYYY-MM-DD
  timeSlot: string; // e.g. "10:30 AM"
  notes?: string;
  status: AppointmentStatus;
}

const appointmentSchema = new Schema<IAppointment>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
    type: { type: String, enum: ['CHECKUP', 'CONSULTATION'], required: true },
    planName: { type: String, trim: true },
    price: { type: Number },
    date: { type: String, required: true },
    timeSlot: { type: String, required: true },
    notes: { type: String, trim: true },
    status: { type: String, enum: ['BOOKED', 'COMPLETED', 'CANCELLED'], default: 'BOOKED' },
  },
  { timestamps: true }
);

appointmentSchema.index({ doctorId: 1, date: 1 });
appointmentSchema.index({ patientId: 1, createdAt: -1 });

export const Appointment = mongoose.model<IAppointment>('Appointment', appointmentSchema);
