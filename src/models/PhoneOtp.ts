import mongoose, { Schema, Types } from 'mongoose';

export type PhoneOtpPurpose = 'LOGIN' | 'VERIFY';

/**
 * A code texted to a phone. One live code per (phone, purpose): asking again
 * replaces it. After MAX_ATTEMPTS wrong guesses the code is burned.
 */
export interface IPhoneOtp {
  phone: string;
  purpose: PhoneOtpPurpose;
  /** For VERIFY: the signed-in patient adding this number. */
  patientId?: Types.ObjectId;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
}

export const PHONE_OTP_MAX_ATTEMPTS = 5;

const phoneOtpSchema = new Schema<IPhoneOtp>(
  {
    phone: { type: String, required: true },
    purpose: { type: String, enum: ['LOGIN', 'VERIFY'], required: true },
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient' },
    codeHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

phoneOtpSchema.index({ phone: 1, purpose: 1 }, { unique: true });

export const PhoneOtp = mongoose.model<IPhoneOtp>('PhoneOtp', phoneOtpSchema);
