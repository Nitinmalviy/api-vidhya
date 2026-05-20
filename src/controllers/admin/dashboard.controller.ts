import type { Request, Response } from 'express';
import { Doctor } from '../../models/Doctor';
import { Patient } from '../../models/Patient';

export const getDashboard = async (_req: Request, res: Response): Promise<void> => {
  const [totalDoctors, totalPatients, pendingKyc, approvedDoctors, rejectedDoctors] =
    await Promise.all([
      Doctor.countDocuments(),
      Patient.countDocuments(),
      Doctor.countDocuments({ kycStatus: 'PENDING' }),
      Doctor.countDocuments({ kycStatus: 'APPROVED' }),
      Doctor.countDocuments({ kycStatus: 'REJECTED' }),
    ]);

  res.status(200).json({
    success: true,
    data: {
      totalDoctors,
      totalPatients,
      pendingKyc,
      approvedDoctors,
      rejectedDoctors,
      liveOpds: 0,
      revenue: 0,
    },
  });
};

