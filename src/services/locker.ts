import mongoose, { type Types } from 'mongoose';
import { entitlementFor, type LockerEntitlement } from '../config/locker';
import { HealthRecord, NOT_DELETED } from '../models/HealthRecord';
import { LockerMember } from '../models/LockerMember';
import { Patient } from '../models/Patient';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/AppError';

const UPGRADE_MSG =
  'My Locker is a premium feature — subscribe to a plan to upload your health reports.';

export type LockerAccess = {
  patientId: string;
  plan: 'FREE' | 'PREMIUM';
  planId: string | null;
  planExpiresAt: Date | null;
  /** A paid cycle is live right now. */
  isActive: boolean;
  entitlement: LockerEntitlement;
};

/**
 * Read the patient's locker entitlement. Never throws for FREE patients —
 * they get `isActive: false` so read-only views still work.
 */
export async function getLockerAccess(patientId: string): Promise<LockerAccess> {
  const patient = await Patient.findById(patientId).select('plan planId planExpiresAt').lean();
  if (!patient) throw new NotFoundError('Patient');

  const isActive =
    patient.plan === 'PREMIUM' && !!patient.planExpiresAt && patient.planExpiresAt > new Date();

  return {
    patientId,
    plan: patient.plan,
    planId: patient.planId ?? null,
    planExpiresAt: patient.planExpiresAt ?? null,
    isActive,
    entitlement: isActive ? entitlementFor(patient.planId) : entitlementFor(null),
  };
}

/** Same as `getLockerAccess`, but rejects anyone who can't write to the locker. */
export async function requireLockerAccess(patientId: string): Promise<LockerAccess> {
  const access = await getLockerAccess(patientId);
  if (!access.isActive || access.entitlement.maxMembers === 0) {
    throw new ForbiddenError(UPGRADE_MSG);
  }
  return access;
}

/**
 * The account holder always has a locker member of their own, created lazily on
 * first locker access so existing patients don't need a migration.
 */
export async function ensureSelfMember(patientId: string) {
  const existing = await LockerMember.findOne({ patientId, isSelf: true });
  if (existing) {
    await adoptOrphanRecords(patientId, existing._id);
    return existing;
  }

  const patient = await Patient.findById(patientId).select('name gender dateOfBirth bloodGroup').lean();
  if (!patient) throw new NotFoundError('Patient');

  try {
    const created = await LockerMember.create({
      patientId,
      name: patient.name,
      relation: 'SELF',
      isSelf: true,
      ...(patient.gender ? { gender: patient.gender } : {}),
      ...(patient.dateOfBirth ? { dateOfBirth: patient.dateOfBirth } : {}),
      ...(patient.bloodGroup ? { bloodGroup: patient.bloodGroup } : {}),
    });
    await adoptOrphanRecords(patientId, created._id);
    return created;
  } catch (err) {
    // Unique index tripped by a concurrent request — reuse the winner.
    const raced = await LockerMember.findOne({ patientId, isSelf: true });
    if (raced) return raced;
    throw err;
  }
}

/**
 * Records created before My Locker existed have no `memberId`. File them under
 * the account holder so they show up on a card and count towards a quota
 * instead of floating as "unassigned".
 */
async function adoptOrphanRecords(patientId: string, memberId: Types.ObjectId): Promise<void> {
  await HealthRecord.updateMany(
    { patientId, memberId: { $exists: false } },
    { $set: { memberId } }
  );
}

/** Live (non-deleted) report count per member, keyed by member id string. */
export async function reportCounts(patientId: string): Promise<Record<string, number>> {
  const rows = await HealthRecord.aggregate<{ _id: Types.ObjectId | null; count: number }>([
    { $match: { patientId: toObjectId(patientId), ...NOT_DELETED } },
    { $group: { _id: '$memberId', count: { $sum: 1 } } },
  ]);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row._id) counts[String(row._id)] = row.count;
  }
  return counts;
}

/**
 * Resolve the member a report is being filed under, and make sure they still
 * have room. `memberId` omitted → the account holder's own member.
 */
export async function resolveUploadTarget(patientId: string, memberId?: unknown) {
  const access = await requireLockerAccess(patientId);

  const member = memberId
    ? await LockerMember.findOne({ _id: String(memberId), patientId })
    : await ensureSelfMember(patientId);
  if (!member) throw new NotFoundError('Locker member');

  const used = await HealthRecord.countDocuments({ patientId, memberId: member._id, ...NOT_DELETED });
  const limit = access.entitlement.reportsPerMember;
  if (used >= limit) {
    throw new BadRequestError(
      `${member.name} already has ${limit} reports in the locker — delete one of them to upload a new report.`
    );
  }

  return { access, member, used, limit, remaining: limit - used };
}

/** Guard for adding a person to the locker. */
export async function assertCanAddMember(patientId: string, access: LockerAccess): Promise<void> {
  const count = await LockerMember.countDocuments({ patientId });
  if (count >= access.entitlement.maxMembers) {
    throw new BadRequestError(
      access.entitlement.maxMembers === 1
        ? 'Your plan covers one person only — upgrade to the Family plan to add your family.'
        : `Your plan covers up to ${access.entitlement.maxMembers} people in the locker.`
    );
  }
}

function toObjectId(id: string): Types.ObjectId {
  return new mongoose.Types.ObjectId(id);
}
