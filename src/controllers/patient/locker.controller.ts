import type { Response } from 'express';
import {
  HealthRecord,
  HEALTH_CATEGORIES,
  NOT_DELETED,
  type HealthCategory,
  type HealthRecordType,
} from '../../models/HealthRecord';
import { LockerMember, LOCKER_RELATIONS, type LockerRelation } from '../../models/LockerMember';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { uploadBase64ToS3 } from '../../services/s3Upload';
import { signFieldsArray } from '../../services/presignedUrl';
import {
  assertCanAddMember,
  ensureSelfMember,
  getLockerAccess,
  reportCounts,
  requireLockerAccess,
  resolveUploadTarget,
} from '../../services/locker';

const RECORD_TYPES: HealthRecordType[] = ['LAB_REPORT', 'PRESCRIPTION', 'SCAN', 'VACCINATION', 'OTHER'];
const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;

/* ─────────────────────────────────────────────
   GET /api/v1/patient/locker
   Everything the My Locker screen needs in one shot: what the plan allows,
   who is in the locker, and how much room each person has left.
───────────────────────────────────────────── */
export const getLockerOverview = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const access = await getLockerAccess(req.user.id);

  // Only provision the self member for patients who actually have a locker;
  // a FREE patient shouldn't get rows written on a read.
  if (access.isActive) await ensureSelfMember(req.user.id);

  const [members, counts] = await Promise.all([
    LockerMember.find({ patientId: req.user.id }).sort({ isSelf: -1, createdAt: 1 }).lean(),
    reportCounts(req.user.id),
  ]);

  const limit = access.entitlement.reportsPerMember;

  res.status(200).json({
    success: true,
    data: {
      locker: {
        plan: access.plan,
        planId: access.planId,
        planExpiresAt: access.planExpiresAt,
        canUpload: access.isActive && access.entitlement.maxMembers > 0,
        maxMembers: access.entitlement.maxMembers,
        reportsPerMember: limit,
        memberCount: members.length,
        canAddMember: access.isActive && members.length < access.entitlement.maxMembers,
      },
      members: members.map((m) => {
        const used = counts[String(m._id)] ?? 0;
        return {
          ...m,
          reportCount: used,
          reportLimit: limit,
          remaining: Math.max(0, limit - used),
        };
      }),
    },
  });
};

/* ─────────────────────────────────────────────
   Members
───────────────────────────────────────────── */

/* POST /api/v1/patient/locker/members  { name, relation, gender?, dateOfBirth?, bloodGroup? } */
export const addLockerMember = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const access = await requireLockerAccess(req.user.id);

  // Make sure the account holder occupies their slot before counting.
  await ensureSelfMember(req.user.id);
  await assertCanAddMember(req.user.id, access);

  const { name, relation, gender, dateOfBirth, bloodGroup } = req.body ?? {};

  const cleanName = String(name ?? '').trim();
  if (cleanName.length < 2 || cleanName.length > 80) {
    throw new BadRequestError('Member name must be 2–80 characters');
  }
  if (relation !== undefined && !LOCKER_RELATIONS.includes(relation as LockerRelation)) {
    throw new BadRequestError('Invalid relation');
  }
  if (relation === 'SELF') {
    throw new BadRequestError('Your own locker profile already exists');
  }
  if (gender !== undefined && gender !== null && !GENDERS.includes(gender)) {
    throw new BadRequestError('Invalid gender');
  }

  let dob: Date | undefined;
  if (dateOfBirth) {
    dob = new Date(dateOfBirth);
    if (Number.isNaN(dob.getTime()) || dob > new Date()) throw new BadRequestError('Invalid date of birth');
  }

  const member = await LockerMember.create({
    patientId: req.user.id,
    name: cleanName,
    relation: (relation as LockerRelation) ?? 'OTHER',
    isSelf: false,
    ...(gender ? { gender } : {}),
    ...(dob ? { dateOfBirth: dob } : {}),
    ...(bloodGroup ? { bloodGroup: String(bloodGroup).trim().slice(0, 5) } : {}),
  });

  res.status(201).json({
    success: true,
    message: 'Member added to your locker',
    data: {
      member: {
        ...member.toObject(),
        reportCount: 0,
        reportLimit: access.entitlement.reportsPerMember,
        remaining: access.entitlement.reportsPerMember,
      },
    },
  });
};

/* PUT /api/v1/patient/locker/members/:id */
export const updateLockerMember = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  await requireLockerAccess(req.user.id);

  const { name, relation, gender, dateOfBirth, bloodGroup } = req.body ?? {};
  const update: Record<string, unknown> = {};

  if (name !== undefined) {
    const cleanName = String(name).trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      throw new BadRequestError('Member name must be 2–80 characters');
    }
    update.name = cleanName;
  }
  if (relation !== undefined) {
    if (!LOCKER_RELATIONS.includes(relation as LockerRelation)) throw new BadRequestError('Invalid relation');
    update.relation = relation;
  }
  if (gender !== undefined) {
    if (gender !== null && !GENDERS.includes(gender)) throw new BadRequestError('Invalid gender');
    update.gender = gender;
  }
  if (dateOfBirth !== undefined) {
    if (dateOfBirth === null) {
      update.dateOfBirth = null;
    } else {
      const dob = new Date(dateOfBirth);
      if (Number.isNaN(dob.getTime()) || dob > new Date()) throw new BadRequestError('Invalid date of birth');
      update.dateOfBirth = dob;
    }
  }
  if (bloodGroup !== undefined) {
    update.bloodGroup = bloodGroup === null ? null : String(bloodGroup).trim().slice(0, 5);
  }

  if (Object.keys(update).length === 0) throw new BadRequestError('Nothing to update');

  const member = await LockerMember.findOne({ _id: req.params.id, patientId: req.user.id });
  if (!member) throw new NotFoundError('Locker member');
  // The self profile keeps its relation — it always represents the account holder.
  if (member.isSelf && update.relation && update.relation !== 'SELF') {
    throw new BadRequestError('Your own locker profile must stay marked as "Self"');
  }

  member.set(update);
  await member.save();

  res.status(200).json({ success: true, message: 'Member updated', data: { member: member.toObject() } });
};

/* DELETE /api/v1/patient/locker/members/:id — removes the person; their reports
   are soft-deleted, so the stored files themselves are never destroyed. */
export const deleteLockerMember = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  await requireLockerAccess(req.user.id);

  const member = await LockerMember.findOne({ _id: req.params.id, patientId: req.user.id });
  if (!member) throw new NotFoundError('Locker member');
  if (member.isSelf) throw new BadRequestError('You cannot remove your own locker profile');

  const { modifiedCount } = await HealthRecord.updateMany(
    { patientId: req.user.id, memberId: member._id, ...NOT_DELETED },
    { $set: { deletedAt: new Date() } }
  );
  await member.deleteOne();

  res.status(200).json({
    success: true,
    message: `${member.name} and their ${modifiedCount} report(s) were removed from your locker`,
  });
};

/* ─────────────────────────────────────────────
   Reports
───────────────────────────────────────────── */

/* GET /api/v1/patient/locker/records?memberId=&category=&type= */
export const listLockerRecords = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const filter: Record<string, unknown> = { patientId: req.user.id, ...NOT_DELETED };

  if (req.query.memberId) {
    const member = await LockerMember.findOne({
      _id: String(req.query.memberId),
      patientId: req.user.id,
    }).select('_id');
    if (!member) throw new NotFoundError('Locker member');
    filter.memberId = member._id;
  }
  if (req.query.category) {
    const category = String(req.query.category) as HealthCategory;
    if (!HEALTH_CATEGORIES.includes(category)) throw new BadRequestError('Invalid health category');
    filter.healthCategory = category;
  }
  if (req.query.type) {
    const type = String(req.query.type) as HealthRecordType;
    if (!RECORD_TYPES.includes(type)) throw new BadRequestError('Invalid record type');
    filter.type = type;
  }

  const records = await HealthRecord.find(filter).sort({ date: -1 }).limit(200).lean();
  await signFieldsArray(records, ['fileUrl']);

  res.status(200).json({ success: true, data: { records } });
};

/* POST /api/v1/patient/locker/records
   { memberId?, title, type?, healthCategory?, date?, notes?, file? } */
export const addLockerRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { memberId, title, type, healthCategory, date, notes, file } = req.body ?? {};

  // Validate everything cheap before spending an S3 round-trip.
  const cleanTitle = String(title ?? '').trim();
  if (!cleanTitle) throw new BadRequestError('Report title is required');
  // Every locker report is a stored document — no link-only entries.
  if (!file) throw new BadRequestError('Please attach the report file (PDF, JPG or PNG)');
  if (type && !RECORD_TYPES.includes(type)) throw new BadRequestError('Invalid record type');
  if (healthCategory && !HEALTH_CATEGORIES.includes(healthCategory)) {
    throw new BadRequestError('Invalid health category');
  }

  let recordDate: Date | undefined;
  if (date) {
    recordDate = new Date(date);
    if (Number.isNaN(recordDate.getTime())) throw new BadRequestError('Invalid report date');
  }

  const { member, limit, remaining } = await resolveUploadTarget(req.user.id, memberId);

  const s3Key = await uploadBase64ToS3(file, 'health-records');
  if (!s3Key) {
    throw new BadRequestError('File upload failed — check file type and size (max 10MB images, 25MB PDFs)');
  }

  const record = await HealthRecord.create({
    patientId: req.user.id,
    memberId: member._id,
    title: cleanTitle.slice(0, 120),
    type: type ?? 'OTHER',
    healthCategory: healthCategory ?? 'GENERAL',
    fileUrl: s3Key,
    ...(recordDate ? { date: recordDate } : {}),
    ...(notes ? { notes: String(notes).trim().slice(0, 1000) } : {}),
  });

  const recordObj = record.toObject();
  await signFieldsArray([recordObj], ['fileUrl']);

  res.status(201).json({
    success: true,
    message: 'Report saved to your locker',
    data: {
      record: recordObj,
      usage: { memberId: String(member._id), used: limit - remaining + 1, limit },
    },
  });
};

/* DELETE /api/v1/patient/locker/records/:id
   Soft delete: the report leaves the patient's locker and frees up one of their
   5 slots, but the row and the S3 object stay put. */
export const deleteLockerRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const deleted = await HealthRecord.findOneAndUpdate(
    { _id: req.params.id, patientId: req.user.id, ...NOT_DELETED },
    { $set: { deletedAt: new Date() } },
    { new: true }
  );
  if (!deleted) throw new NotFoundError('Report');

  res.status(200).json({ success: true, message: 'Report removed from your locker' });
};
