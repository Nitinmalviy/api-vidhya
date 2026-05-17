import bcrypt from 'bcryptjs';
import mongoose, { type HydratedDocument, Schema, type Types } from 'mongoose';

export type DoctorWorkType = 'OWN_CLINIC' | 'EMPLOYEE';
export type DoctorKycStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface IDegreeDetails {
  degreeName: string;
  university: string;
  passingYear: number;
  documentUrl: string;
}

export interface ILicenseDetails {
  licenseNumber: string;
  expiryDate: Date;
  documentUrl: string;
}

export interface IDoctor {
  // Auth fields
  email: string;
  password?: string;
  phone: string;
  isEmailVerified: boolean;
  emailVerificationTokenHash?: string;
  emailVerificationExpires?: Date;
  passwordResetTokenHash?: string;
  passwordResetExpires?: Date;

  // KYC details
  degreeDetails?: IDegreeDetails;
  licenseDetails?: ILicenseDetails;
  specializations: string[];

  // Employment
  workType: DoctorWorkType;
  clinicId?: Types.ObjectId;

  // Verification status
  kycStatus: DoctorKycStatus;
  adminRemarks?: string;

  comparePassword(candidatePassword: string): Promise<boolean>;
}

type DoctorDocument = HydratedDocument<IDoctor>;

const degreeDetailsSchema = new Schema<IDegreeDetails>(
  {
    degreeName: { type: String, required: true, trim: true },
    university: { type: String, required: true, trim: true },
    passingYear: { type: Number, required: true },
    documentUrl: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const licenseDetailsSchema = new Schema<ILicenseDetails>(
  {
    licenseNumber: { type: String, required: true, trim: true },
    expiryDate: { type: Date, required: true },
    documentUrl: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const doctorSchema = new Schema<IDoctor>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    degreeDetails: {
      type: degreeDetailsSchema,
      required: false,
    },
    licenseDetails: {
      type: licenseDetailsSchema,
      required: false,
    },
    specializations: {
      type: [String],
      default: [],
    },
    workType: {
      type: String,
      enum: ['OWN_CLINIC', 'EMPLOYEE'],
      required: true,
    },
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: 'Clinic',
      required: false,
    },
    kycStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
    },
    adminRemarks: {
      type: String,
      required: false,
      trim: true,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationTokenHash: {
      type: String,
      select: false,
      required: false,
    },
    emailVerificationExpires: {
      type: Date,
      select: false,
      required: false,
    },
    passwordResetTokenHash: {
      type: String,
      select: false,
      required: false,
    },
    passwordResetExpires: {
      type: Date,
      select: false,
      required: false,
    },
  },
  { timestamps: true }
);

doctorSchema.pre<DoctorDocument>('save', async function (next) {
  try {
    if (!this.isModified('password')) return next();
    if (!this.password) return next(new Error('Password is required'));

    const saltRounds = 12;
    this.password = await bcrypt.hash(this.password, saltRounds);
    next();
  } catch (err) {
    next(err as Error);
  }
});

doctorSchema.methods.comparePassword = async function (
  this: DoctorDocument,
  candidatePassword: string
): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

export const Doctor = mongoose.model<IDoctor>('Doctor', doctorSchema);

