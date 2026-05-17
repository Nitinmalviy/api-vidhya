import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../types';
import { Doctor } from '../models/Doctor';
import { ForbiddenError, UnauthorizedError } from '../utils/AppError';

export const isApprovedDoctor = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  if (req.user.role !== 'doctor') throw new ForbiddenError('Doctor access only');

  const doctor = await Doctor.findById(req.user.id).select('kycStatus').lean().exec();
  if (!doctor) throw new UnauthorizedError();
  if (doctor.kycStatus !== 'APPROVED') throw new ForbiddenError('Doctor KYC not approved');

  next();
};

