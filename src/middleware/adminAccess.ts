import type { NextFunction, Response } from 'express';
import type { Types } from 'mongoose';
import { Admin, type AdminRole } from '../models/Admin';
import { Clinic } from '../models/Clinic';
import { Doctor } from '../models/Doctor';
import type { AuthRequest } from '../types';
import { ForbiddenError, UnauthorizedError } from '../utils/AppError';
import { verifyAccessToken } from '../utils/jwt';

export type AdminAccess = { id: string; name: string; role: AdminRole; clinicIds: string[] };
export type AdminRequest = AuthRequest & { admin?: AdminAccess };

/** What a front-desk account may open. Everything else in the admin API is off limits. */
const FRONT_DESK_PATHS = /^\/(walkins|profile)(\/|$)/;

/**
 * Runs in front of every admin route. Admin tokens only say "admin", so the
 * account is looked up on each request: a removed admin is signed out at once,
 * and role or clinic changes apply without a new login.
 * Requests without a valid admin token pass through untouched — the route's own
 * `authenticate` still rejects them.
 */
export const adminAccess = async (req: AdminRequest, _res: Response, next: NextFunction): Promise<void> => {
  if (req.path === '/health' || req.path.startsWith('/auth/login') || req.path.startsWith('/auth/verify') || req.path.startsWith('/auth/resend')) {
    return next();
  }
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  let payload;
  try {
    payload = verifyAccessToken(header.split(' ')[1]);
  } catch {
    return next();
  }
  if (payload.role !== 'admin') return next();

  const admin = await Admin.findById(payload.id).select('name role clinicIds').lean();
  if (!admin) throw new UnauthorizedError('This admin account no longer exists');

  req.admin = { id: String(admin._id), name: admin.name, role: admin.role, clinicIds: (admin.clinicIds ?? []).map(String) };
  if (admin.role === 'FRONT_DESK' && !FRONT_DESK_PATHS.test(req.path)) {
    throw new ForbiddenError('Front desk accounts can only use the walk-in desk');
  }
  next();
};

export const requireSuperAdmin = (req: AdminRequest, _res: Response, next: NextFunction): void => {
  if (req.admin?.role !== 'SUPER_ADMIN') throw new ForbiddenError('Only a super admin can do this');
  next();
};

/** Doctors who work at any of these clinics: its owner and the doctors linked to it. */
export async function doctorIdsForClinics(clinicIds: (string | Types.ObjectId)[]): Promise<string[]> {
  if (!clinicIds.length) return [];
  const [owners, staff] = await Promise.all([
    Clinic.find({ _id: { $in: clinicIds } }).select('doctorId').lean(),
    Doctor.find({ clinicId: { $in: clinicIds } }).select('_id').lean(),
  ]);
  return [...new Set([...owners.map((c) => String(c.doctorId)), ...staff.map((d) => String(d._id))])];
}

/**
 * Doctors this admin may run the desk for: `null` means every doctor
 * (super admin / moderator), otherwise the doctors of their clinics.
 */
export async function deskScope(req: AdminRequest): Promise<string[] | null> {
  const admin = req.admin;
  if (!admin) throw new UnauthorizedError();
  if (admin.role !== 'FRONT_DESK') return null;
  return doctorIdsForClinics(admin.clinicIds);
}
