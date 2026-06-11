import type { Request, Response } from 'express';
import { ChatMessage } from '../../models/ChatMessage';
import type { AuthRequest } from '../../types';
import { AppError, BadRequestError, UnauthorizedError } from '../../utils/AppError';
import { generateAiReply, type ChatTurn } from '../../services/ai';

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

/* ── Guest chat (no auth) ─────────────────────────────────────────────
 * Guests get a small trial before the app asks them to sign up. Nothing is
 * persisted server-side; the client sends its own short history. A simple
 * in-memory per-IP bucket stops abuse of the unauthenticated endpoint.
 */
const GUEST_MAX_PER_HOUR = 20;
const guestBuckets = new Map<string, { count: number; resetAt: number }>();

function takeGuestToken(ip: string): number {
  const now = Date.now();
  const bucket = guestBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    // Opportunistic cleanup so the map doesn't grow unbounded
    if (guestBuckets.size > 10_000) guestBuckets.clear();
    guestBuckets.set(ip, { count: 1, resetAt: now + 60 * 60 * 1000 });
    return GUEST_MAX_PER_HOUR - 1;
  }
  if (bucket.count >= GUEST_MAX_PER_HOUR) return -1;
  bucket.count += 1;
  return GUEST_MAX_PER_HOUR - bucket.count;
}

/* POST /api/v1/patient/assistant/guest-message  { text, history? } */
export const guestMessage = async (req: Request, res: Response): Promise<void> => {
  const remaining = takeGuestToken(req.ip ?? 'unknown');
  if (remaining < 0) {
    throw new AppError('Guest limit reached. Create a free account to keep chatting.', 429);
  }

  const { text, history } = req.body ?? {};
  if (!text || !String(text).trim()) throw new BadRequestError('Message text is required');
  const userText = String(text).trim().slice(0, 2000);

  // Client-held history: validate shape, keep it short
  const turns: ChatTurn[] = Array.isArray(history)
    ? history
        .filter(
          (t): t is { role: string; text: string } =>
            t && (t.role === 'user' || t.role === 'ai') && typeof t.text === 'string'
        )
        .slice(-12)
        .map((t) => ({ role: t.role as 'user' | 'ai', text: t.text.slice(0, 2000) }))
    : [];

  const reply = await generateAiReply(turns, userText);

  res.status(200).json({ success: true, data: { reply, remaining } });
};
