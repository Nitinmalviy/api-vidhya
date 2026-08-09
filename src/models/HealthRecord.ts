import mongoose, { Schema, type Types } from 'mongoose';

export type HealthRecordType = 'LAB_REPORT' | 'PRESCRIPTION' | 'SCAN' | 'VACCINATION' | 'OTHER';

/**
 * What the report is *about* — a locker member can keep reports for several
 * conditions at once (sugar, BP, thyroid…), so this is separate from `type`,
 * which describes the document format.
 */
export type HealthCategory =
  | 'DIABETES'
  | 'BLOOD_PRESSURE'
  | 'THYROID'
  | 'HEART'
  | 'KIDNEY'
  | 'LIVER'
  | 'CHOLESTEROL'
  | 'GENERAL'
  | 'OTHER';

export const HEALTH_CATEGORIES: HealthCategory[] = [
  'DIABETES',
  'BLOOD_PRESSURE',
  'THYROID',
  'HEART',
  'KIDNEY',
  'LIVER',
  'CHOLESTEROL',
  'GENERAL',
  'OTHER',
];

export interface IHealthRecord {
  patientId: Types.ObjectId;
  /** Locker member the report belongs to. Absent on records created before My Locker. */
  memberId?: Types.ObjectId;
  title: string;
  type: HealthRecordType;
  healthCategory: HealthCategory;
  date: Date;
  notes?: string;
  fileUrl?: string;
  /**
   * Soft-delete marker. A deleted report disappears from the patient's locker
   * and stops counting against their quota, but the row and its S3 object are
   * kept — nothing is erased from storage.
   */
  deletedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Reuse this on every locker read so soft-deleted rows never leak. */
export const NOT_DELETED = { deletedAt: null } as const;

const healthRecordSchema = new Schema<IHealthRecord>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'LockerMember', index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    type: {
      type: String,
      enum: ['LAB_REPORT', 'PRESCRIPTION', 'SCAN', 'VACCINATION', 'OTHER'],
      default: 'OTHER',
    },
    healthCategory: { type: String, enum: HEALTH_CATEGORIES, default: 'GENERAL' },
    date: { type: Date, default: Date.now },
    notes: { type: String, trim: true, maxlength: 1000 },
    fileUrl: { type: String, trim: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Per-member quota counting hits this on every upload.
healthRecordSchema.index({ patientId: 1, memberId: 1, deletedAt: 1 });

export const HealthRecord = mongoose.model<IHealthRecord>('HealthRecord', healthRecordSchema);
