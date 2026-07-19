import mongoose, { Schema, type Types, type HydratedDocument } from 'mongoose';

export type OpdSessionStatus = 'SCHEDULED' | 'LIVE' | 'COMPLETED' | 'CANCELLED';

export interface IOpdSession {
  doctorId: Types.ObjectId;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm (24-hour format)
  endTime: string; // HH:mm
  status: OpdSessionStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type OpdSessionDocument = HydratedDocument<IOpdSession>;

const opdSessionSchema = new Schema<IOpdSession>(
  {
    doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
    date: { type: String, required: true, index: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    status: { type: String, enum: ['SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED'], default: 'SCHEDULED' },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

export const OpdSession = mongoose.model<IOpdSession>('OpdSession', opdSessionSchema);
