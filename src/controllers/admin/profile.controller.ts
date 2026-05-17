import type { Request, Response } from 'express';

export const getProfile = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({
    success: true,
    message: 'Admin profile (dummy)',
    data: {
      id: 'admin_dummy_id',
      name: 'Admin User',
      email: 'admin@example.com',
    },
  });
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  res.status(200).json({
    success: true,
    message: 'Admin profile updated (dummy)',
    data: {
      ...req.body,
    },
  });
};

