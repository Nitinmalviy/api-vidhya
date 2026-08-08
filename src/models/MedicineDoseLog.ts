import mongoose, { Schema, type Types } from 'mongoose';

/**
 * One row per dose the patient has actually marked as taken — this is what
 * fills in a slot on the "seat map" dose tracker in the UI. Pending/missed
 * slots are derived on the fly from the reminder's schedule, not stored.
 */
export interface IMedicineDoseLog {
  patientId: Types.ObjectId;
  reminderId: Types.ObjectId;
  date: string; // YYYY-MM-DD — the scheduled day
  time: string; // HH:mm — the scheduled time slot
  takenAt: Date;
}

const medicineDoseLogSchema = new Schema<IMedicineDoseLog>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    reminderId: { type: Schema.Types.ObjectId, ref: 'MedicineReminder', required: true, index: true },
    date: { type: String, required: true },
    time: { type: String, required: true },
    takenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// One log per dose slot — marking the same slot twice just no-ops.
medicineDoseLogSchema.index({ reminderId: 1, date: 1, time: 1 }, { unique: true });

export const MedicineDoseLog = mongoose.model<IMedicineDoseLog>('MedicineDoseLog', medicineDoseLogSchema);
