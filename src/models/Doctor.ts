import bcrypt from 'bcryptjs';
import mongoose, { type HydratedDocument, Schema, type Types } from 'mongoose';

export type DoctorWorkType = 'OWN_CLINIC' | 'EMPLOYEE';
export type DoctorKycStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * Live-OPD is not open to every doctor. A doctor asks admin for access, saying
 * how many hours a day they can be online; admin approves an hour budget (or
 * suspends it later). Only APPROVED doctors can run OPD sessions.
 */
export type OpdAccessStatus = 'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export const OPD_ACCESS_STATUSES: OpdAccessStatus[] = [
  'NOT_REQUESTED',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
];

export interface IOpdAccess {
  status: OpdAccessStatus;
  /** Hours per day the doctor says they can be available. */
  requestedHoursPerDay?: number;
  /** Hours per day admin actually allows. Session length is checked against this. */
  approvedHoursPerDay?: number;
  /** Free-text window the doctor prefers, e.g. "7pm–11pm, and weekends". */
  preferredWindow?: string;
  /** Doctor's note with the request. */
  requestNote?: string;
  requestedAt?: Date | null;
  reviewedAt?: Date | null;
  reviewedBy?: Types.ObjectId;
  /** Admin's reason on reject/suspend — shown to the doctor. */
  adminNote?: string;
}

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
  name: string;
  email: string;
  password?: string;
  phone: string;
  sessionVersion: number;
  isEmailVerified: boolean;
  emailVerificationTokenHash?: string;
  emailVerificationExpires?: Date;
  passwordResetTokenHash?: string;
  passwordResetExpires?: Date;

  // KYC details
  degreeDetails?: IDegreeDetails;
  licenseDetails?: ILicenseDetails;
  specializations: string[];

  // Public profile
  consultationFee?: number;
  photoUrl?: string;
  yearsExperience?: number;
  bio?: string;

  // Employment
  workType: DoctorWorkType;
  clinicId?: Types.ObjectId;

  // Clinic location (for nearby-doctor search)
  clinicAddress?: {
    line1?: string;
    city?: string;
    state?: string;
    country?: string;
    zip?: string;
  };
  location?: { type: 'Point'; coordinates: [number, number] }; // [lng, lat]

  // Verification status
  kycStatus: DoctorKycStatus;
  adminRemarks?: string;

  // Live-OPD access, granted by admin
  opdAccess: IOpdAccess;

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

const clinicAddressSchema = new Schema(
  {
    line1: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    country: { type: String, trim: true },
    zip: { type: String, trim: true },
  },
  { _id: false }
);

// GeoJSON Point — only set when the doctor pins a clinic location.
const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  { _id: false }
);

const opdAccessSchema = new Schema<IOpdAccess>(
  {
    status: { type: String, enum: OPD_ACCESS_STATUSES, default: 'NOT_REQUESTED' },
    requestedHoursPerDay: { type: Number, min: 1, max: 24 },
    approvedHoursPerDay: { type: Number, min: 1, max: 24 },
    preferredWindow: { type: String, trim: true, maxlength: 200 },
    requestNote: { type: String, trim: true, maxlength: 1000 },
    requestedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
    adminNote: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false }
);

const doctorSchema = new Schema<IDoctor>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
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
    consultationFee: {
      type: Number,
      required: false,
      min: 0,
    },
    photoUrl: {
      type: String,
      required: false,
      trim: true,
    },
    yearsExperience: {
      type: Number,
      required: false,
      min: 0,
      max: 60,
    },
    bio: {
      type: String,
      required: false,
      trim: true,
      maxlength: 1000,
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
    clinicAddress: { type: clinicAddressSchema, required: false },
    location: { type: pointSchema, required: false },
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
    opdAccess: {
      type: opdAccessSchema,
      default: () => ({ status: 'NOT_REQUESTED' }),
    },
    sessionVersion: {
      type: Number,
      default: 0,
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

// Geospatial index for nearby-doctor ($geoNear) queries.
doctorSchema.index({ location: '2dsphere' });

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

