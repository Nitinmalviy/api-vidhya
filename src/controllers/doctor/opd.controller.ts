import type { Response } from 'express';
import { OpdSession } from '../../models/OpdSession';
import type { AuthRequest } from '../../types';
import { BadRequestError, UnauthorizedError, NotFoundError } from '../../utils/AppError';

export const createOpdSession = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { date, startTime, endTime, notes } = req.body;

  if (!date || !startTime || !endTime) {
    throw new BadRequestError('Date, startTime, and endTime are required');
  }

  const session = await OpdSession.create({
    doctorId: req.user.id,
    date,
    startTime,
    endTime,
    notes,
    status: 'SCHEDULED',
  });

  res.status(201).json({ success: true, data: { session } });
};

export const getOpdSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const sessions = await OpdSession.find({ doctorId: req.user.id })
    .sort({ date: 1, startTime: 1 })
    .lean();

  res.status(200).json({ success: true, data: { sessions } });
};

export const updateOpdSessionStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { id } = req.params;
  const { status } = req.body;

  if (!['SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED'].includes(status)) {
    throw new BadRequestError('Invalid status');
  }

  const session = await OpdSession.findOneAndUpdate(
    { _id: id, doctorId: req.user.id },
    { status },
    { new: true }
  );

  if (!session) throw new NotFoundError('Session not found');

  res.status(200).json({ success: true, data: { session } });
};
