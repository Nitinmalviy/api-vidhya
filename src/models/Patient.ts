import bcrypt from 'bcryptjs';
import mongoose, { type HydratedDocument, Schema } from 'mongoose';

export type PatientPlan = 'FREE' | 'PREMIUM';
export type PatientGender = 'MALE' | 'FEMALE' | 'OTHER';

export interface IPatient {
  name: string;
  email: string;
  password?: string;
  phone: string;
  plan: PatientPlan;
  planId?: string;
  planExpiresAt?: Date;
  bloodGroup?: string;
  gender?: PatientGender;
  dateOfBirth?: Date;
  heightCm?: number;
  weightKg?: number;
  conditions: string[];
  allergies: string[];
  address?: string;
  emergencyContact?: { name: string; phone: string };
  sessionVersion: number;
  isEmailVerified: boolean;
  emailVerificationTokenHash?: string;
  emailVerificationExpires?: Date;
  passwordResetTokenHash?: string;
  passwordResetExpires?: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

type PatientDocument = HydratedDocument<IPatient>;

const patientSchema = new Schema<IPatient>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    phone: { type: String, required: true, trim: true },
    plan: { type: String, enum: ['FREE', 'PREMIUM'], default: 'FREE' },
    planId: { type: String, trim: true },
    planExpiresAt: { type: Date },
    bloodGroup: { type: String, trim: true },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'] },
    dateOfBirth: { type: Date },
    heightCm: { type: Number, min: 30, max: 272 },
    weightKg: { type: Number, min: 1, max: 500 },
    conditions: { type: [String], default: [] },
    allergies: { type: [String], default: [] },
    address: { type: String, trim: true, maxlength: 300 },
    emergencyContact: {
      type: { name: { type: String, trim: true }, phone: { type: String, trim: true } },
      _id: false,
    },
    sessionVersion: { type: Number, default: 0 },
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationExpires: { type: Date, select: false },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  { timestamps: true }
);

patientSchema.pre<PatientDocument>('save', async function (next) {
  try {
    if (!this.isModified('password')) return next();
    if (!this.password) return next(new Error('Password is required'));
    this.password = await bcrypt.hash(this.password, 12);
    next();
  } catch (err) {
    next(err as Error);
  }
});

patientSchema.methods.comparePassword = async function (
  this: PatientDocument,
  candidatePassword: string
): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

export const Patient = mongoose.model<IPatient>('Patient', patientSchema);
