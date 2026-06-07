import type { Types } from 'mongoose';
import { Notification, type NotificationType, type NotificationRole } from '../models/Notification';
import { logger } from '../utils/logger';

/**
 * Create an in-app notification. Never throws — logs and continues
 * so a notification failure can't break the main request.
 */
export async function createNotification(params: {
  userId: Types.ObjectId | string;
  role: NotificationRole;
  type: NotificationType;
  title: string;
  message: string;
}): Promise<void> {
  try {
    await Notification.create({
      userId: params.userId,
      role: params.role,
      type: params.type,
      title: params.title,
      message: params.message,
      isRead: false,
    });
  } catch (err) {
    logger.error({ err, userId: params.userId }, 'Failed to create notification');
  }
}
