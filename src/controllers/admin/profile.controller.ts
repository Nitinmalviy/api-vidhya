import type { Response } from 'express';
import { Admin } from '../../models/Admin';
import { AuthRequest } from '../../types';
import { NotFoundError } from '../../utils/AppError';

/** The console uses `role` and `clinics` to decide which pages to show. */
function withClinics(admin: { clinicIds?: unknown[] } & Record<string, unknown>) {
  const { clinicIds, ...rest } = admin;
  const clinics = ((clinicIds ?? []) as { _id?: unknown; name?: string }[])
    .filter((c) => c && c._id)
    .map((c) => ({ id: String(c._id), name: c.name?.trim() || 'Clinic' }));
  return { ...rest, clinics };
}

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await Admin.findById(req.user!.id).select('name email role clinicIds createdAt').populate('clinicIds', 'name').lean();
  if (!admin) throw new NotFoundError('Admin not found');
  res.status(200).json({ success: true, data: withClinics(admin) });
};

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await Admin.findByIdAndUpdate(
    req.user!.id,
    { $set: { name: req.body.name } },
    { new: true, runValidators: true }
  )
    .select('name email role clinicIds createdAt')
    .populate('clinicIds', 'name')
    .lean();
  if (!admin) throw new NotFoundError('Admin not found');
  res.status(200).json({ success: true, data: withClinics(admin) });
};
