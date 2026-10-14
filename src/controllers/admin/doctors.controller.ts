import { Types } from 'mongoose';
import { removeDoctorAccount } from '../../services/doctorRemoval';
import { BadRequestError, NotFoundError } from '../../utils/AppError';
import type { Request, Response } from 'express';
import { Doctor, type DoctorKycStatus } from '../../models/Doctor';
import { getPresignedUrl, signFieldsArray } from '../../services/presignedUrl';

const VALID_STATUSES: DoctorKycStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];

const DOCTOR_URL_FIELDS = [
  'degreeDetails.documentUrl',
  'licenseDetails.documentUrl',
  'identityProofUrl',
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

/* ─────────────────────────────────────────────
   POST /api/v1/admin/doctors/:id/remove  { reason }
   For test/demo accounts. Deletes a doctor with no history; otherwise
   deactivates (hidden, signed out, upcoming bookings cancelled + refunded).
───────────────────────────────────────────── */
export const removeDoctor = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  if (!Types.ObjectId.isValid(id)) throw new NotFoundError('Doctor');
  const reason = String(req.body?.reason ?? '').trim().slice(0, 300) || 'removed by admin';
  const doctor = await Doctor.findById(id).select('_id removedAt').lean();
  if (!doctor) throw new NotFoundError('Doctor');
  if (doctor.removedAt) throw new BadRequestError('This doctor was already removed');

  const mode = await removeDoctorAccount(id, reason);
  res.status(200).json({
    success: true,
    message:
      mode === 'deleted'
        ? 'Doctor deleted — they had no bookings or records.'
        : 'Doctor deactivated and hidden. Upcoming bookings were cancelled and paid ones refunded.',
    data: { mode },
  });
};
