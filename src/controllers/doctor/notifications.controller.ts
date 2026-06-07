import type { Response } from 'express';
import { Notification } from '../../models/Notification';
import type { AuthRequest } from '../../types';
import { UnauthorizedError } from '../../utils/AppError';

/* GET /api/v1/doctor/notifications */
export const getNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const [notifications, unreadCount] = await Promise.all([
    Notification.find({ userId: req.user.id, role: 'doctor' })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()
      .exec(),
    Notification.countDocuments({ userId: req.user.id, role: 'doctor', isRead: false }),
  ]);

  res.status(200).json({ success: true, data: { notifications, unreadCount } });
};

/* PATCH /api/v1/doctor/notifications/:id/read */
export const markRead = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  await Notification.updateOne(
    { _id: req.params.id, userId: req.user.id, role: 'doctor' },
    { isRead: true }
  ).exec();
  res.status(200).json({ success: true, message: 'Marked as read' });
};

/* PATCH /api/v1/doctor/notifications/read-all */
export const markAllRead = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  await Notification.updateMany(
    { userId: req.user.id, role: 'doctor', isRead: false },
    { isRead: true }
  ).exec();
  res.status(200).json({ success: true, message: 'All marked as read' });
};
