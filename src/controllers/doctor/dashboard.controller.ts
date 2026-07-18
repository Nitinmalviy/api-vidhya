import type { Request, Response } from 'express';
import { Appointment } from '../../models/Appointment';

export const getDashboard = async (req: Request, res: Response): Promise<void> => {
  try {
    const doctorId = (req as any).user.id;
    const today = new Date().toISOString().split('T')[0];

    const appointmentsToday = await Appointment.countDocuments({
      doctorId,
      date: today,
    });

    const uniquePatients = await Appointment.distinct('patientId', { doctorId });
    const totalPatients = uniquePatients.length;

    // Prescriptions and OPD sessions are currently mocked as there are no direct models linking them to doctors in the current schema
    res.status(200).json({
      success: true,
      data: {
        stats: {
          appointmentsToday,
          totalPatients,
          totalPrescriptions: 312,
          liveOpds: 1,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error fetching dashboard' });
  }
};

