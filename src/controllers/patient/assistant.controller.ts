import type { Response } from 'express';
import { ChatMessage } from '../../models/ChatMessage';
import type { AuthRequest } from '../../types';
import { BadRequestError, UnauthorizedError } from '../../utils/AppError';
import { generateAiReply, type ChatTurn } from '../../services/gemini';

/* GET /api/v1/patient/assistant/history */
export const getHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const messages = await ChatMessage.find({ patientId: req.user.id })
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();

  res.status(200).json({
    success: true,
    data: {
      messages: messages.map((m) => ({ role: m.role, text: m.text, createdAt: m.createdAt })),
    },
  });
};

/* POST /api/v1/patient/assistant/message  { text } */
export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { text } = req.body ?? {};
  if (!text || !String(text).trim()) throw new BadRequestError('Message text is required');

  const userText = String(text).trim().slice(0, 2000);

  // Load recent history for context
  const prior = await ChatMessage.find({ patientId: req.user.id })
    .sort({ createdAt: 1 })
    .limit(50)
    .lean();
  const history: ChatTurn[] = prior.map((m) => ({ role: m.role, text: m.text }));

  // Persist the user's message
  await ChatMessage.create({ patientId: req.user.id, role: 'user', text: userText });

  // Generate + persist AI reply
  const reply = await generateAiReply(history, userText);
  const aiMsg = await ChatMessage.create({ patientId: req.user.id, role: 'ai', text: reply });

  res.status(200).json({
    success: true,
    data: { reply, createdAt: aiMsg.createdAt },
  });
};

/* DELETE /api/v1/patient/assistant/history */
export const clearHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  await ChatMessage.deleteMany({ patientId: req.user.id });
  res.status(200).json({ success: true, message: 'Chat history cleared' });
};
