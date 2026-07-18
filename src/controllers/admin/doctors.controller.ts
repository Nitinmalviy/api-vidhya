import type { Request, Response } from 'express';
import { Doctor, type DoctorKycStatus } from '../../models/Doctor';
import { getPresignedUrl, signFieldsArray } from '../../services/presignedUrl';

const VALID_STATUSES: DoctorKycStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

const DOCTOR_URL_FIELDS = [
  'degreeDetails.documentUrl',
  'licenseDetails.documentUrl',
  'photoUrl',
];

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

  await signFieldsArray(doctors, DOCTOR_URL_FIELDS);

  for (const doc of doctors) {
    const clinic = (doc as any).clinicId;
    if (clinic && typeof clinic === 'object' && clinic.photoUrl) {
      const signed = await getPresignedUrl(clinic.photoUrl);
      if (signed) clinic.photoUrl = signed;
    }
  }

  res.status(200).json({
    success: true,
    data: { doctors, total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
  });
};
