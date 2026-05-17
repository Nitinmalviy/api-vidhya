import mongoose, { Schema, type Types } from 'mongoose';

export interface IClinic {
  name?: string;
  photoUrl?: string;
  isVerified: boolean;
  doctorId: Types.ObjectId;
}

const clinicSchema = new Schema<IClinic>(
  {
    name: { type: String, required: false, trim: true },
    photoUrl: { type: String, required: false, trim: true },
    isVerified: { type: Boolean, default: false },
    doctorId: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
  },
  { timestamps: true }
);

export const Clinic = mongoose.model<IClinic>('Clinic', clinicSchema);

