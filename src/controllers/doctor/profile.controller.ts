import type { Request, Response } from 'express';

export const getProfile = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({
    success: true,
    message: 'Doctor profile (dummy)',
    data: {
      id: 'doctor_dummy_id',
      name: 'Doctor User',
      email: 'doctor@example.com',
      specialization: 'General Medicine',
    },
  });
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({
    success: true,
    message: 'Doctor profile updated (dummy)',
    data: {
      ...req.body,
    },
  });
};

