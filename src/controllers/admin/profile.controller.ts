import type { Response } from 'express';
import { Admin } from '../../models/Admin';
import { AuthRequest } from '../../types';
import { NotFoundError } from '../../utils/AppError';

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await Admin.findById(req.user!.id).select('name email role createdAt').lean();
  if (!admin) throw new NotFoundError('Admin not found');
  res.status(200).json({ success: true, data: admin });
};

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  const admin = await Admin.findByIdAndUpdate(
    req.user!.id,
    { $set: { name: req.body.name } },
    { new: true, runValidators: true }
  )
    .select('name email role createdAt')
    .lean();
  if (!admin) throw new NotFoundError('Admin not found');
  res.status(200).json({ success: true, data: admin });
};
