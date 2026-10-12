import type { Request, Response } from 'express';
import { Appointment } from '../../models/Appointment';
import { Prescription } from '../../models/Prescription';
import { OpdSession } from '../../models/OpdSession';
import { nowInIndia } from '../../utils/availability';

export const getDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const doctorId = (req as any).user.id;
    // India date — the server runs in UTC, so toISOString() would roll over at 5:30 AM IST.
    const today = nowInIndia().date;

    const [appointmentsToday, uniquePatients, totalPrescriptions, liveOpds] = await Promise.all([
      Appointment.countDocuments({ doctorId, date: today, status: { $ne: 'CANCELLED' } }),
      Appointment.distinct('patientId', { doctorId, patientId: { $ne: null } }),
      Prescription.countDocuments({ doctorId }),
      OpdSession.countDocuments({ doctorId, status: 'LIVE' }),
    ]);

    const totalPatients = uniquePatients.length;

    res.status(200).json({
      success: true,
      data: {
        stats: {
          appointmentsToday,
          totalPatients,
          totalPrescriptions,
          liveOpds,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error fetching dashboard' });
  }
};
