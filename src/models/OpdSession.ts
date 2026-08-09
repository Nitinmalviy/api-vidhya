import mongoose, { Schema, type Types, type HydratedDocument } from 'mongoose';

export type OpdSessionStatus = 'SCHEDULED' | 'LIVE' | 'COMPLETED' | 'CANCELLED';

export interface IOpdSession {
  doctorId: Types.ObjectId;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm (24-hour format)
  endTime: string; // HH:mm
  status: OpdSessionStatus;
  notes?: string;
  /** When the doctor actually went live / closed the desk. */
  startedAt?: Date | null;
  endedAt?: Date | null;
  /** Patients seen in this session — cheap counter for the doctor's summary. */
  consultationsDone: number;
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
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    consultationsDone: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Patient routing asks "who is LIVE right now" on every consult request.
opdSessionSchema.index({ status: 1, date: 1 });

export const OpdSession = mongoose.model<IOpdSession>('OpdSession', opdSessionSchema);
