import bcrypt from 'bcryptjs';
import mongoose, { type HydratedDocument, Schema, type Types } from 'mongoose';

/**
 * SUPER_ADMIN — everything, including managing admins.
 * MODERATOR   — the whole console, every clinic.
 * FRONT_DESK  — only the walk-in desk, and only for the clinics in `clinicIds`.
 */
export type AdminRole = 'SUPER_ADMIN' | 'MODERATOR' | 'FRONT_DESK';
export const ADMIN_ROLES: readonly AdminRole[] = ['SUPER_ADMIN', 'MODERATOR', 'FRONT_DESK'];

export interface IAdmin {
  name: string;
  email: string;
  password?: string;
  role: AdminRole;
  /** Clinics a FRONT_DESK account works for. Ignored for other roles. */
  clinicIds: Types.ObjectId[];
  permissions: string[];
  isEmailVerified: boolean;
  emailVerificationTokenHash?: string;
  emailVerificationExpires?: Date;

  comparePassword(candidatePassword: string): Promise<boolean>;
}

type AdminDocument = HydratedDocument<IAdmin>;

const adminSchema = new Schema<IAdmin>(
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
    role: {
      type: String,
      enum: ADMIN_ROLES,
      required: true,
    },
    clinicIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Clinic' }],
      default: [],
    },
    permissions: {
      type: [String],
      default: [],
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
  },
  { timestamps: true }
);

adminSchema.pre<AdminDocument>('save', async function (next) {
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

adminSchema.methods.comparePassword = async function (
  this: AdminDocument,
  candidatePassword: string
): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

export const Admin = mongoose.model<IAdmin>('Admin', adminSchema);

