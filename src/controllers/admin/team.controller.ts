import type { Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { Admin, ADMIN_ROLES } from '../../models/Admin';
import { Clinic } from '../../models/Clinic';
import type { AdminRequest } from '../../middleware/adminAccess';
import { BadRequestError, ConflictError, NotFoundError } from '../../utils/AppError';
import { assertStrongPassword } from '../../utils/validation';

/* ─────────────────────────────────────────────
   Admin team (super admin only): who can sign in to the console, with what
   role, and — for front-desk staff — which clinics they work at.
───────────────────────────────────────────── */

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), 'Invalid clinic');

export const createMemberSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  role: z.enum(ADMIN_ROLES as [string, ...string[]]).default('FRONT_DESK'),
  clinicIds: z.array(objectId).max(50).default([]),
});

export const updateMemberSchema = z.object({
  role: z.enum(ADMIN_ROLES as [string, ...string[]]).optional(),
  clinicIds: z.array(objectId).max(50).optional(),
});

type MemberRow = {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: string;
  clinicIds?: ({ _id: Types.ObjectId; name?: string } | Types.ObjectId)[];
  createdAt?: Date;
};

const serializeMember = (a: MemberRow) => ({
  id: String(a._id),
  name: a.name,
  email: a.email,
  role: a.role,
  clinics: (a.clinicIds ?? [])
    .filter((c): c is { _id: Types.ObjectId; name?: string } => !!c && !(c instanceof Types.ObjectId))
    .map((c) => ({ id: String(c._id), name: c.name?.trim() || 'Clinic' })),
  createdAt: a.createdAt ?? null,
});

/** Front-desk staff must be tied to at least one real clinic; others carry none. */
async function checkClinics(role: string, clinicIds: string[]): Promise<string[]> {
  if (role !== 'FRONT_DESK') return [];
  const unique = [...new Set(clinicIds)];
  if (!unique.length) throw new BadRequestError('Pick at least one clinic for front desk staff');
  const found = await Clinic.countDocuments({ _id: { $in: unique } });
  if (found !== unique.length) throw new BadRequestError('One of the clinics no longer exists');
  return unique;
}

/** Never leave the console without a super admin. */
async function assertNotLastSuperAdmin(id: string) {
  const others = await Admin.countDocuments({ role: 'SUPER_ADMIN', _id: { $ne: id } });
  if (!others) throw new BadRequestError('There must always be at least one super admin');
}

/* GET /api/v1/admin/team */
export const listTeam = async (_req: AdminRequest, res: Response): Promise<void> => {
  const members = await Admin.find().select('name email role clinicIds createdAt').populate('clinicIds', 'name').sort({ createdAt: 1 }).lean();
  res.status(200).json({ success: true, data: { members: members.map((m) => serializeMember(m as never)) } });
};

/**
 * POST /api/v1/admin/team — the super admin sets a starting password and shares it.
 * The account is usable straight away; the member can change their name in Settings.
 */
export const createMember = async (req: AdminRequest, res: Response): Promise<void> => {
  const body = req.body as z.infer<typeof createMemberSchema>;
  assertStrongPassword(body.password);
  if (await Admin.exists({ email: body.email })) throw new ConflictError('An admin with this email already exists');

  const clinicIds = await checkClinics(body.role, body.clinicIds);
  const admin = await Admin.create({
    name: body.name,
    email: body.email,
    password: body.password,
    role: body.role,
    clinicIds,
    isEmailVerified: true,
  });
  const saved = await Admin.findById(admin._id).select('name email role clinicIds createdAt').populate('clinicIds', 'name').lean();
  res.status(201).json({ success: true, message: `${body.name} can now sign in`, data: { member: serializeMember(saved as never) } });
};

/* PATCH /api/v1/admin/team/:id  { role?, clinicIds? } — applies on their next request. */
export const updateMember = async (req: AdminRequest, res: Response): Promise<void> => {
  if (!Types.ObjectId.isValid(req.params.id)) throw new NotFoundError('Admin');
  const body = req.body as z.infer<typeof updateMemberSchema>;
  const current = await Admin.findById(req.params.id).select('role clinicIds').lean();
  if (!current) throw new NotFoundError('Admin');

  const role = body.role ?? current.role;
  if (current.role === 'SUPER_ADMIN' && role !== 'SUPER_ADMIN') {
    if (req.params.id === req.admin!.id) throw new BadRequestError("You can't change your own role");
    await assertNotLastSuperAdmin(req.params.id);
  }
  const clinicIds = await checkClinics(role, body.clinicIds ?? (current.clinicIds ?? []).map(String));

  const updated = await Admin.findByIdAndUpdate(req.params.id, { $set: { role, clinicIds } }, { new: true, runValidators: true })
    .select('name email role clinicIds createdAt')
    .populate('clinicIds', 'name')
    .lean();
  res.status(200).json({ success: true, message: 'Access updated', data: { member: serializeMember(updated as never) } });
};

/* DELETE /api/v1/admin/team/:id — signs them out everywhere at once. */
export const removeMember = async (req: AdminRequest, res: Response): Promise<void> => {
  if (!Types.ObjectId.isValid(req.params.id)) throw new NotFoundError('Admin');
  if (req.params.id === req.admin!.id) throw new BadRequestError("You can't remove your own account");
  const current = await Admin.findById(req.params.id).select('role').lean();
  if (!current) throw new NotFoundError('Admin');
  if (current.role === 'SUPER_ADMIN') await assertNotLastSuperAdmin(req.params.id);

  await Admin.deleteOne({ _id: req.params.id });
  res.status(200).json({ success: true, message: 'Admin removed' });
};
