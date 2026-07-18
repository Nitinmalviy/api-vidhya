import mongoose, { Schema, type Types } from 'mongoose';

export type TicketRole = 'Doctor' | 'Patient' | 'Clinic';
export type TicketStatus = 'Open' | 'Resolved';

export interface ISupportTicket {
  subject: string;
  fromId: Types.ObjectId;
  fromName: string;
  role: TicketRole;
  status: TicketStatus;
  message: string;
  replies: string[];
}

const supportTicketSchema = new Schema<ISupportTicket>(
  {
    subject: { type: String, required: true, trim: true },
    fromId: { type: Schema.Types.ObjectId, required: true, index: true },
    fromName: { type: String, required: true, trim: true },
    role: { type: String, enum: ['Doctor', 'Patient', 'Clinic'], required: true },
    status: { type: String, enum: ['Open', 'Resolved'], default: 'Open' },
    message: { type: String, required: true },
    replies: { type: [String], default: [] },
  },
  { timestamps: true }
);

export const SupportTicket = mongoose.model<ISupportTicket>('SupportTicket', supportTicketSchema);
