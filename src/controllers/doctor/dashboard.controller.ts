import type { Request, Response } from 'express';

export const getDashboard = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({
    success: true,
    message: 'Doctor dashboard (dummy)',
    data: {
      stats: {
        appointmentsToday: 6,
        pendingReports: 2,
      },
      queue: [],
    },
  });
};

