import type { Response } from 'express';
import { Appointment } from '../../models/Appointment';
import { ChatMessage } from '../../models/ChatMessage';
import { HealthRecord, type HealthRecordType } from '../../models/HealthRecord';
import { Patient, type IPatient, type PatientGender } from '../../models/Patient';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';

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
  };
}

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

/* DELETE /api/v1/patient/profile  { password } — permanently delete account + data */
export const deleteAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { password } = req.body ?? {};
  if (!password) throw new BadRequestError('Password is required to delete your account');

  const patient = await Patient.findById(req.user.id).select('+password');
  if (!patient) throw new NotFoundError('Patient');

  const ok = await patient.comparePassword(String(password));
  if (!ok) throw new BadRequestError('Password is incorrect');

  await Promise.all([
    ChatMessage.deleteMany({ patientId: patient._id }),
    HealthRecord.deleteMany({ patientId: patient._id }),
    Appointment.deleteMany({ patientId: patient._id }),
  ]);
  await patient.deleteOne();

  res.status(200).json({ success: true, message: 'Your account and data have been deleted' });
};

/* GET /api/v1/patient/profile/records */
export const listRecords = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const records = await HealthRecord.find({ patientId: req.user.id })
    .sort({ date: -1 })
    .limit(200)
    .lean();
  res.status(200).json({ success: true, data: { records } });
};

/* POST /api/v1/patient/profile/records  { title, type, date?, notes?, fileUrl? } */
export const addRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { title, type, date, notes, fileUrl } = req.body ?? {};

  const cleanTitle = String(title ?? '').trim();
  if (!cleanTitle) throw new BadRequestError('Record title is required');
  if (type && !RECORD_TYPES.includes(type)) throw new BadRequestError('Invalid record type');

  let recordDate: Date | undefined;
  if (date) {
    recordDate = new Date(date);
    if (Number.isNaN(recordDate.getTime())) throw new BadRequestError('Invalid record date');
  }

  const record = await HealthRecord.create({
    patientId: req.user.id,
    title: cleanTitle.slice(0, 120),
    type: type ?? 'OTHER',
    ...(recordDate ? { date: recordDate } : {}),
    ...(notes ? { notes: String(notes).trim().slice(0, 1000) } : {}),
    ...(fileUrl ? { fileUrl: String(fileUrl).trim().slice(0, 500) } : {}),
  });

  res.status(201).json({ success: true, message: 'Record added', data: { record } });
};

/* DELETE /api/v1/patient/profile/records/:id */
export const deleteRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const deleted = await HealthRecord.findOneAndDelete({
    _id: req.params.id,
    patientId: req.user.id,
  });
  if (!deleted) throw new NotFoundError('Record');
  res.status(200).json({ success: true, message: 'Record deleted' });
};

/* ─────────────────────────────────────────────
   POST /api/v1/patient/profile/subscribe
   Activates a premium plan. Payment is collected client-side
   (mock checkout for now); this flips the account to PREMIUM.
───────────────────────────────────────────── */
const PLAN_IDS = ['single', 'family'] as const;

export const subscribe = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { planId } = req.body ?? {};
  if (!PLAN_IDS.includes(planId)) {
    throw new BadRequestError("planId must be 'single' or 'family'");
  }

  const patient = await Patient.findByIdAndUpdate(
    req.user.id,
    { plan: 'PREMIUM' },
    { new: true }
  )
    .select('plan')
    .lean();
  if (!patient) throw new NotFoundError('Patient');

  res.status(200).json({
    success: true,
    message: 'Subscription active',
    data: { plan: patient.plan, planId },
  });
};
