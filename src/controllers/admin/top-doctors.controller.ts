import type { Request, Response } from 'express';
import { Doctor } from '../../models/Doctor';

export const getTopDoctors = async (_req: Request, res: Response): Promise<void> => {
  const doctors = await Doctor.find({ kycStatus: 'APPROVED' })
    .select('name specializations phone createdAt')
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

  res.status(200).json({ success: true, data: { doctors } });
};
