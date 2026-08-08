import mongoose, { Schema, type Types } from 'mongoose';

export interface IMedicineReminder {
  patientId: Types.ObjectId;
  medicineName: string;
  dosage?: string;
  /** "HH:mm" (24-hour), one entry per dose time in the day. */
  times: string[];
  /** 0 (Sun) – 6 (Sat). Empty array means every day. */
  daysOfWeek: number[];
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD, open-ended if omitted
  notes?: string;
  active: boolean;
  /** Set once we've fired the "course ending soon" notification, so it isn't repeated. */
  endingSoonNotifiedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const medicineReminderSchema = new Schema<IMedicineReminder>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    medicineName: { type: String, required: true, trim: true, maxlength: 120 },
    dosage: { type: String, trim: true, maxlength: 60 },
    times: {
      type: [String],
      required: true,
      validate: {
        validator: (v: string[]) => v.length > 0 && v.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)),
        message: 'times must be a non-empty list of "HH:mm" values',
      },
    },
    daysOfWeek: {
      type: [Number],
      default: [],
      validate: {
        validator: (v: number[]) => v.every((d) => d >= 0 && d <= 6),
        message: 'daysOfWeek must contain values 0-6',
      },
    },
    startDate: { type: String, required: true },
    endDate: { type: String },
    notes: { type: String, trim: true, maxlength: 500 },
    active: { type: Boolean, default: true },
    endingSoonNotifiedAt: { type: Date },
  },
  { timestamps: true }
);

medicineReminderSchema.index({ patientId: 1, active: 1 });

export const MedicineReminder = mongoose.model<IMedicineReminder>('MedicineReminder', medicineReminderSchema);
