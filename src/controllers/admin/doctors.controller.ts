import type { Request, Response } from 'express';
import { Doctor, type DoctorKycStatus } from '../../models/Doctor';

const VALID_STATUSES: DoctorKycStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

export const getDoctors = async (req: Request, res: Response): Promise<void> => {
  const { status, page = '1', limit = '20' } = req.query;

  const filter: Record<string, unknown> = {};
  if (status && VALID_STATUSES.includes(String(status) as DoctorKycStatus)) {
    filter.kycStatus = status as DoctorKycStatus;
  }

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(100, Math.max(1, Number(limit)));
  const skip = (pageNum - 1) * limitNum;

  const [doctors, total] = await Promise.all([
    Doctor.find(filter)
      .populate('clinicId', 'name photoUrl isVerified')
      .select('name email phone specializations licenseDetails degreeDetails workType kycStatus adminRemarks createdAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean()
      .exec(),
    Doctor.countDocuments(filter).exec(),
  ]);

  res.status(200).json({
    success: true,
    data: {
      doctors,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  });
};
