import mongoose, { Schema, type Types } from 'mongoose';

export type NotificationType = 'KYC_SUBMITTED' | 'KYC_APPROVED' | 'KYC_REJECTED' | 'GENERAL';
export type NotificationRole = 'doctor' | 'patient' | 'admin';

export interface INotification {
  userId: Types.ObjectId;
  role: NotificationRole;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    role: { type: String, enum: ['doctor', 'patient', 'admin'], required: true },
    type: {
      type: String,
      enum: ['KYC_SUBMITTED', 'KYC_APPROVED', 'KYC_REJECTED', 'GENERAL'],
      default: 'GENERAL',
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);
