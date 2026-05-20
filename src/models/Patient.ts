import bcrypt from 'bcryptjs';
import mongoose, { type HydratedDocument, Schema } from 'mongoose';

export type PatientPlan = 'FREE' | 'PREMIUM';

export interface IPatient {
  name: string;
  email: string;
  password?: string;
  phone: string;
  plan: PatientPlan;
  bloodGroup?: string;
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
    bloodGroup: { type: String, trim: true },
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
