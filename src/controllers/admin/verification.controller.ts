import type { Request, Response } from 'express';
import { Doctor } from '../../models/Doctor';
import { Clinic } from '../../models/Clinic';
import { BadRequestError, NotFoundError } from '../../utils/AppError';

export const verifyDoctor = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { status, adminRemarks } = req.body ?? {};

  if (status !== 'APPROVED' && status !== 'REJECTED') {
    throw new BadRequestError("status must be 'APPROVED' or 'REJECTED'");
  }
  if (status === 'REJECTED' && !adminRemarks?.trim()) {
    throw new BadRequestError('adminRemarks are required when rejecting');
  }

  const doctor = await Doctor.findById(id).exec();
  if (!doctor) throw new NotFoundError('Doctor');

  doctor.kycStatus = status;
  doctor.adminRemarks = adminRemarks ?? undefined;
  await doctor.save();

  if (status === 'APPROVED' && doctor.clinicId) {
    await Clinic.findByIdAndUpdate(doctor.clinicId, { isVerified: true }).exec();
  }

  res.status(200).json({
    success: true,
    message: status === 'APPROVED' ? 'Doctor approved' : 'Doctor rejected',
    data: { id: doctor._id, kycStatus: doctor.kycStatus },
  });
};

