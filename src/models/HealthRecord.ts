import mongoose, { Schema, type Types } from 'mongoose';

export type HealthRecordType = 'LAB_REPORT' | 'PRESCRIPTION' | 'SCAN' | 'VACCINATION' | 'OTHER';

export interface IHealthRecord {
  patientId: Types.ObjectId;
  title: string;
  type: HealthRecordType;
  date: Date;
  notes?: string;
  fileUrl?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const healthRecordSchema = new Schema<IHealthRecord>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    type: {
      type: String,
      enum: ['LAB_REPORT', 'PRESCRIPTION', 'SCAN', 'VACCINATION', 'OTHER'],
      default: 'OTHER',
    },
    date: { type: Date, default: Date.now },
    notes: { type: String, trim: true, maxlength: 1000 },
    fileUrl: { type: String, trim: true },
  },
  { timestamps: true }
);

export const HealthRecord = mongoose.model<IHealthRecord>('HealthRecord', healthRecordSchema);
