import type { Request, Response } from 'express';
import { Doctor } from '../../models/Doctor';
import { Clinic } from '../../models/Clinic';
import { BadRequestError, NotFoundError } from '../../utils/AppError';

export const verifyDoctor = async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { status, adminRemarks } = req.body ?? {};

  if (status !== 'APPROVED') {
    throw new BadRequestError("status must be 'APPROVED'");
  }

  const doctor = await Doctor.findById(id).exec();
  if (!doctor) throw new NotFoundError('Doctor');

  doctor.kycStatus = 'APPROVED';
  doctor.adminRemarks = adminRemarks;
  await doctor.save();

  if (doctor.clinicId) {
    await Clinic.findByIdAndUpdate(doctor.clinicId, { isVerified: true }).exec();
  }

  res.status(200).json({
    success: true,
    message: 'Doctor approved',
    data: { id: doctor._id, kycStatus: doctor.kycStatus, clinicId: doctor.clinicId },
  });
};

