import mongoose, { Schema, type Types } from 'mongoose';

/** How a locker member relates to the account holder. */
export type LockerRelation = 'SELF' | 'SPOUSE' | 'CHILD' | 'PARENT' | 'SIBLING' | 'OTHER';

export const LOCKER_RELATIONS: LockerRelation[] = [
  'SELF',
  'SPOUSE',
  'CHILD',
  'PARENT',
  'SIBLING',
  'OTHER',
];

export interface ILockerMember {
  /** Account holder who owns this locker. */
  patientId: Types.ObjectId;
  name: string;
  relation: LockerRelation;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  dateOfBirth?: Date;
  bloodGroup?: string;
  /** True for the single auto-created member that represents the account holder. */
  isSelf: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const lockerMemberSchema = new Schema<ILockerMember>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    relation: { type: String, enum: LOCKER_RELATIONS, default: 'OTHER' },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER'] },
    dateOfBirth: { type: Date },
    bloodGroup: { type: String, trim: true, maxlength: 5 },
    isSelf: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One "self" member per patient — guards against a double-tap creating two.
lockerMemberSchema.index({ patientId: 1, isSelf: 1 }, { unique: true, partialFilterExpression: { isSelf: true } });

export const LockerMember = mongoose.model<ILockerMember>('LockerMember', lockerMemberSchema);
