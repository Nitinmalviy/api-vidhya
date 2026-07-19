import type { Request, Response } from 'express';
import { Appointment } from '../../models/Appointment';
import { Prescription } from '../../models/Prescription';
import { OpdSession } from '../../models/OpdSession';

export const getDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const doctorId = (req as any).user.id;
    const today = new Date().toISOString().split('T')[0];

    const [appointmentsToday, uniquePatients, totalPrescriptions, liveOpds] = await Promise.all([
      Appointment.countDocuments({ doctorId, date: today }),
      Appointment.distinct('patientId', { doctorId }),
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
