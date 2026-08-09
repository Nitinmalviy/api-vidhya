import type { Response } from 'express';
import {
  HealthRecord,
  HEALTH_CATEGORIES,
  NOT_DELETED,
  type HealthCategory,
  type HealthRecordType,
} from '../../models/HealthRecord';
import { Patient, type IPatient, type PatientGender } from '../../models/Patient';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { uploadBase64ToS3 } from '../../services/s3Upload';
import { signFieldsArray } from '../../services/presignedUrl';
import { resolveUploadTarget } from '../../services/locker';

const GENDERS: PatientGender[] = ['MALE', 'FEMALE', 'OTHER'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const RECORD_TYPES: HealthRecordType[] = ['LAB_REPORT', 'PRESCRIPTION', 'SCAN', 'VACCINATION', 'OTHER'];

function serializeProfile(p: IPatient & { _id: unknown; createdAt?: Date }) {
  return {
    id: String(p._id),
    name: p.name,
    email: p.email,
    phone: p.phone,
    plan: p.plan,
    planId: p.planId ?? null,
    planExpiresAt: p.planExpiresAt ?? null,
    addresses: p.addresses ?? [],
    hasAddress: (p.addresses ?? []).length > 0,
    bloodGroup: p.bloodGroup ?? null,
    gender: p.gender ?? null,
    dateOfBirth: p.dateOfBirth ?? null,
    heightCm: p.heightCm ?? null,
    weightKg: p.weightKg ?? null,
    conditions: p.conditions ?? [],
    allergies: p.allergies ?? [],
    address: p.address ?? null,
    emergencyContact: p.emergencyContact ?? null,
    memberSince: p.createdAt ?? null,
    deletionScheduledAt: p.deletionScheduledAt ?? null,
  };
}

/** Grace period between "delete my account" and the data actually being erased. */
const DELETION_GRACE_DAYS = 14;

/** Normalize a tag list: strings, trimmed, deduped, capped. */
function cleanTags(value: unknown, max = 20): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new BadRequestError('Expected a list of strings');
  const tags = value
    .map((v) => String(v).trim().slice(0, 60))
    .filter(Boolean);
  return [...new Set(tags)].slice(0, max);
}

/* GET /api/v1/patient/profile */
export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const patient = await Patient.findById(req.user.id).lean();
  if (!patient) throw new NotFoundError('Patient');
  res.status(200).json({ success: true, data: { profile: serializeProfile(patient) } });
};

/* PUT /api/v1/patient/profile */
export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const body = req.body ?? {};

  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (name.length < 2 || name.length > 80) throw new BadRequestError('Name must be 2–80 characters');
    update.name = name;
  }
  if (body.phone !== undefined) {
    const phone = String(body.phone).trim();
    if (!/^[+\d][\d\s-]{7,15}$/.test(phone)) throw new BadRequestError('Enter a valid phone number');
    update.phone = phone;
  }
  if (body.gender !== undefined) {
    if (body.gender !== null && !GENDERS.includes(body.gender)) throw new BadRequestError('Invalid gender');
    update.gender = body.gender;
  }
  if (body.bloodGroup !== undefined) {
    if (body.bloodGroup !== null && !BLOOD_GROUPS.includes(body.bloodGroup))
      throw new BadRequestError('Invalid blood group');
    update.bloodGroup = body.bloodGroup;
  }
  if (body.dateOfBirth !== undefined) {
    if (body.dateOfBirth === null) {
      update.dateOfBirth = null;
    } else {
      const dob = new Date(body.dateOfBirth);
      if (Number.isNaN(dob.getTime()) || dob > new Date()) throw new BadRequestError('Invalid date of birth');
      update.dateOfBirth = dob;
    }
  }
  if (body.heightCm !== undefined) {
    const h = body.heightCm === null ? null : Number(body.heightCm);
    if (h !== null && (Number.isNaN(h) || h < 30 || h > 272)) throw new BadRequestError('Invalid height');
    update.heightCm = h;
  }
  if (body.weightKg !== undefined) {
    const w = body.weightKg === null ? null : Number(body.weightKg);
    if (w !== null && (Number.isNaN(w) || w < 1 || w > 500)) throw new BadRequestError('Invalid weight');
    update.weightKg = w;
  }
  const conditions = cleanTags(body.conditions);
  if (conditions !== undefined) update.conditions = conditions;
  const allergies = cleanTags(body.allergies);
  if (allergies !== undefined) update.allergies = allergies;
  if (body.address !== undefined) {
    update.address = body.address === null ? null : String(body.address).trim().slice(0, 300);
  }
  if (body.emergencyContact !== undefined) {
    if (body.emergencyContact === null) {
      update.emergencyContact = null;
    } else {
      const name = String(body.emergencyContact.name ?? '').trim().slice(0, 80);
      const phone = String(body.emergencyContact.phone ?? '').trim().slice(0, 20);
      if (!name || !phone) throw new BadRequestError('Emergency contact needs a name and phone');
      update.emergencyContact = { name, phone };
    }
  }

  if (Object.keys(update).length === 0) throw new BadRequestError('Nothing to update');

  const patient = await Patient.findByIdAndUpdate(req.user.id, update, {
    new: true,
    runValidators: true,
  }).lean();
  if (!patient) throw new NotFoundError('Patient');

  res.status(200).json({
    success: true,
    message: 'Profile updated',
    data: { profile: serializeProfile(patient) },
  });
};

/* PUT /api/v1/patient/profile/password  { currentPassword, newPassword } */
export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) throw new BadRequestError('Both current and new password are required');
  if (String(newPassword).length < 8) throw new BadRequestError('New password must be at least 8 characters');

  const patient = await Patient.findById(req.user.id).select('+password');
  if (!patient) throw new NotFoundError('Patient');

  const ok = await patient.comparePassword(String(currentPassword));
  if (!ok) throw new BadRequestError('Current password is incorrect');

  patient.password = String(newPassword);
  await patient.save();

  res.status(200).json({ success: true, message: 'Password changed successfully' });
};

/* DELETE /api/v1/patient/profile  { password }
   Schedules deletion 14 days out instead of erasing immediately, so an
   accidental or regretted deletion can be undone. The purge job
   (`npm run purge:accounts`) does the real erase once the date passes. */
export const deleteAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { password } = req.body ?? {};
  if (!password) throw new BadRequestError('Password is required to delete your account');

  const patient = await Patient.findById(req.user.id).select('+password');
  if (!patient) throw new NotFoundError('Patient');

  const ok = await patient.comparePassword(String(password));
  if (!ok) throw new BadRequestError('Password is incorrect');

  // Re-requesting doesn't extend an existing countdown.
  if (patient.deletionScheduledAt && patient.deletionScheduledAt > new Date()) {
    res.status(200).json({
      success: true,
      message: `Your account is already scheduled for deletion on ${formatDate(patient.deletionScheduledAt)}.`,
      data: { deletionScheduledAt: patient.deletionScheduledAt },
    });
    return;
  }

  const now = new Date();
  patient.deletionRequestedAt = now;
  patient.deletionScheduledAt = new Date(now.getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
  await patient.save();

  res.status(200).json({
    success: true,
    message: `Your account will be deleted after ${DELETION_GRACE_DAYS} days, on ${formatDate(
      patient.deletionScheduledAt
    )}. Sign in again before that date and cancel if you change your mind.`,
    data: { deletionScheduledAt: patient.deletionScheduledAt },
  });
};

/* POST /api/v1/patient/profile/cancel-deletion — stop a pending deletion */
export const cancelAccountDeletion = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const patient = await Patient.findById(req.user.id).select('deletionScheduledAt');
  if (!patient) throw new NotFoundError('Patient');
  if (!patient.deletionScheduledAt) throw new BadRequestError('Your account is not scheduled for deletion');

  patient.deletionRequestedAt = null;
  patient.deletionScheduledAt = null;
  await patient.save();

  res.status(200).json({ success: true, message: 'Account deletion cancelled — welcome back.' });
};

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* GET /api/v1/patient/profile/records */
export const listRecords = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const records = await HealthRecord.find({ patientId: req.user.id, ...NOT_DELETED })
    .sort({ date: -1 })
    .limit(200)
    .lean();

  // Sign S3-key fields with presigned URLs
  await signFieldsArray(records, ['fileUrl']);

  res.status(200).json({ success: true, data: { records } });
};

/* POST /api/v1/patient/profile/records  { title, type, healthCategory?, date?, notes?, file? }
   Legacy entry point — files under the account holder's locker profile and is
   subject to the same plan gating and per-person quota as /patient/locker. */
export const addRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { title, type, healthCategory, date, notes, file, fileUrl: legacyFileUrl } = req.body ?? {};

  const cleanTitle = String(title ?? '').trim();
  if (!cleanTitle) throw new BadRequestError('Record title is required');
  if (type && !RECORD_TYPES.includes(type)) throw new BadRequestError('Invalid record type');
  if (healthCategory && !HEALTH_CATEGORIES.includes(healthCategory as HealthCategory)) {
    throw new BadRequestError('Invalid health category');
  }

  let recordDate: Date | undefined;
  if (date) {
    recordDate = new Date(date);
    if (Number.isNaN(recordDate.getTime())) throw new BadRequestError('Invalid record date');
  }

  const { member } = await resolveUploadTarget(req.user.id);

  // Upload file to S3 if provided as base64
  let s3Key: string | undefined;
  if (file) {
    s3Key = await uploadBase64ToS3(file, 'health-records');
    if (!s3Key) throw new BadRequestError('File upload failed — check file type and size (max 10MB images, 25MB PDFs)');
  }

  const record = await HealthRecord.create({
    patientId: req.user.id,
    memberId: member._id,
    title: cleanTitle.slice(0, 120),
    type: type ?? 'OTHER',
    healthCategory: healthCategory ?? 'GENERAL',
    ...(recordDate ? { date: recordDate } : {}),
    ...(notes ? { notes: String(notes).trim().slice(0, 1000) } : {}),
    ...(s3Key ? { fileUrl: s3Key } : legacyFileUrl ? { fileUrl: String(legacyFileUrl).trim().slice(0, 500) } : {}),
  });

  // Return the record with a signed URL
  const recordObj = record.toObject();
  await signFieldsArray([recordObj], ['fileUrl']);

  res.status(201).json({ success: true, message: 'Record added', data: { record: recordObj } });
};

/* DELETE /api/v1/patient/profile/records/:id — soft delete, same as the locker
   endpoint: the file stays in S3, the report just leaves the patient's view. */
export const deleteRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const deleted = await HealthRecord.findOneAndUpdate(
    { _id: req.params.id, patientId: req.user.id, ...NOT_DELETED },
    { $set: { deletedAt: new Date() } }
  );
  if (!deleted) throw new NotFoundError('Record');

  res.status(200).json({ success: true, message: 'Record deleted' });
};

/* ─────────────────────────────────────────────
   POST /api/v1/patient/profile/subscribe
   Activates (or upgrades) a premium plan. Payment is collected
   client-side (mock checkout for now); this flips the account to PREMIUM.
───────────────────────────────────────────── */
const PLAN_IDS = ['single', 'family'] as const;
type PlanId = (typeof PLAN_IDS)[number];

/** One subscription cycle. Kept in sync with payment.controller.ts. */
const PLAN_DURATION_DAYS = 30;

/** Plan rank — a higher rank can be upgraded *to*, never down. */
const PLAN_RANK: Record<PlanId, number> = { single: 1, family: 2 };

export const subscribe = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { planId } = req.body ?? {};
  if (!PLAN_IDS.includes(planId)) {
    throw new BadRequestError("planId must be 'single' or 'family'");
  }
  const nextPlan = planId as PlanId;

  const current = await Patient.findById(req.user.id).select('plan planId planExpiresAt').lean();
  if (!current) throw new NotFoundError('Patient');

  // Block no-op/downgrade requests while the current plan is still live, so
  // the UI can't accidentally charge someone to move Family → Single.
  const stillActive =
    current.plan === 'PREMIUM' && !!current.planExpiresAt && current.planExpiresAt > new Date();
  if (stillActive && current.planId) {
    const currentRank = PLAN_RANK[current.planId as PlanId] ?? 0;
    if (PLAN_RANK[nextPlan] < currentRank) {
      throw new BadRequestError('You cannot downgrade while your current plan is active');
    }
    if (PLAN_RANK[nextPlan] === currentRank) {
      throw new BadRequestError('You are already on this plan');
    }
  }

  const planExpiresAt = new Date(Date.now() + PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000);
  const patient = await Patient.findByIdAndUpdate(
    req.user.id,
    { plan: 'PREMIUM', planId: nextPlan, planExpiresAt },
    { new: true }
  )
    .select('plan planId planExpiresAt')
    .lean();
  if (!patient) throw new NotFoundError('Patient');

  res.status(200).json({
    success: true,
    message: stillActive ? 'Subscription upgraded' : 'Subscription active',
    data: { plan: patient.plan, planId: patient.planId, planExpiresAt: patient.planExpiresAt },
  });
};
