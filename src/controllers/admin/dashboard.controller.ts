import type { Request, Response } from 'express';

export const getDashboard = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({
    success: true,
    message: 'Admin dashboard (dummy)',
    data: {
      stats: {
        totalDoctors: 12,
        totalPatients: 340,
        totalAppointmentsToday: 18,
      },
      recentActivity: [],
    },
  });
};

