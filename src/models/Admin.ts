import bcrypt from 'bcryptjs';
import mongoose, { type HydratedDocument, Schema } from 'mongoose';

export type AdminRole = 'SUPER_ADMIN' | 'MODERATOR';

export interface IAdmin {
  name: string;
  email: string;
  password?: string;
  role: AdminRole;
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
      enum: ['SUPER_ADMIN', 'MODERATOR'],
      required: true,
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

