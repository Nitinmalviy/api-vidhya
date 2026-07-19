import mongoose, { Schema, type Types, type HydratedDocument } from 'mongoose';

export interface IPrescription {
  doctorId: Types.ObjectId;
  patientId: Types.ObjectId;
  opdSessionId?: Types.ObjectId;
  appointmentId?: Types.ObjectId;
  medicines: string;
  notes?: string;
  attachments: string[]; // URLs of uploaded files
  createdAt: Date;
  updatedAt: Date;
}

export type PrescriptionDocument = HydratedDocument<IPrescription>;

const prescriptionSchema = new Schema<IPrescription>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    opdSessionId: { type: Schema.Types.ObjectId, ref: 'OpdSession' },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
    medicines: { type: String, required: true },
    notes: { type: String },
    attachments: { type: [String], default: [] },
  },
  { timestamps: true }
);

export const Prescription = mongoose.model<IPrescription>('Prescription', prescriptionSchema);
