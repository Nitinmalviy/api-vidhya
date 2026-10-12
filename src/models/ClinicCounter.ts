import mongoose, { Schema } from 'mongoose';

/** Next clinic token per doctor per day. `_id` is "<doctorId>:<YYYY-MM-DD>". */
const clinicCounterSchema = new Schema<{ _id: string; seq: number; expiresAt: Date }>(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
    // Counters are only needed for the day they number; Mongo drops them afterwards.
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { versionKey: false }
);

export const ClinicCounter = mongoose.model('ClinicCounter', clinicCounterSchema);
