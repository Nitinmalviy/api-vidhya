import type { Request, Response } from 'express';
import { Doctor } from '../../models/Doctor';
import { Clinic } from '../../models/Clinic';

export const getDashboard = async (_req: Request, res: Response): Promise<void> => {
  try {
    const [activeDoctors, pendingKyc, activeClinics, pendingDoctorsData] = await Promise.all([
      Doctor.countDocuments({ kycStatus: 'APPROVED' }),
      Doctor.countDocuments({ kycStatus: 'PENDING' }),
      Clinic.countDocuments({ isVerified: true }),
      Doctor.find({ kycStatus: 'PENDING' })
        .sort({ createdAt: -1 })
        .limit(6)
        .select('name specializations createdAt'),
    ]);

    const kycQueue = pendingDoctorsData.map((doc) => ({
      id: doc._id.toString(),
      name: doc.name,
      specialization: doc.specializations?.[0] || 'General',
      submittedAt: ((doc as { createdAt?: Date }).createdAt ?? new Date()).toISOString(),
    }));

    // Mock revenue data for now
    const stats = {
      activeDoctors,
      pendingKyc,
      activeClinics,
      mtdRevenue: 840000,
      kycQueue,
      revenueByStream: {
        subscriptions: 510000,
        doctorAppointments: 220000,
        clinicServices: 110000,
      },
    };

    res.status(200).json({
      success: true,
      data: { stats },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

