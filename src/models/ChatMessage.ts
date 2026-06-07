import mongoose, { Schema, type Types } from 'mongoose';

export type ChatRole = 'user' | 'ai';

export interface IChatMessage {
  patientId: Types.ObjectId;
  role: ChatRole;
  text: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const chatMessageSchema = new Schema<IChatMessage>(
  {
    patientId: { type: Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    role: { type: String, enum: ['user', 'ai'], required: true },
    text: { type: String, required: true },
  },
  { timestamps: true }
);

chatMessageSchema.index({ patientId: 1, createdAt: 1 });

export const ChatMessage = mongoose.model<IChatMessage>('ChatMessage', chatMessageSchema);
