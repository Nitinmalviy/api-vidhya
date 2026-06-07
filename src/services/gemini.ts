import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const SYSTEM_PROMPT = `You are "Vidhya AI", a friendly, careful medical assistant for the Vidhya.care healthcare app in India.
Guidelines:
- Give clear, concise, easy-to-understand health guidance.
- Always remind the user this is general information, not a diagnosis, and to consult a verified doctor for serious or persistent symptoms.
- When relevant, suggest which type of specialist to consult (e.g. cardiologist, dermatologist).
- Never prescribe specific prescription medicines or dosages.
- Keep answers short (under 120 words) and supportive. Use simple language.
- If the question is an emergency (chest pain, severe bleeding, breathing trouble), tell them to seek emergency care immediately.`;

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI | null {
  if (!env.GEMINI_API_KEY) return null;
  if (!client) client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  return client;
}

export type ChatTurn = { role: 'user' | 'ai'; text: string };

/**
 * Generate an AI reply given the prior conversation + the new user message.
 * Falls back to a safe canned response if Gemini is unavailable.
 */
export async function generateAiReply(history: ChatTurn[], userMessage: string): Promise<string> {
  const c = getClient();
  if (!c) {
    return "I'm not fully connected to Vidhya's AI right now. For health concerns, please consult a verified doctor via the Doctors tab.";
  }

  try {
    const model = c.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: SYSTEM_PROMPT,
    });

    // Map prior turns into Gemini's content format (last 12 turns for context)
    const contents = history.slice(-12).map((t) => ({
      role: t.role === 'ai' ? 'model' : 'user',
      parts: [{ text: t.text }],
    }));
    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    const result = await model.generateContent({ contents });
    const text = result.response.text().trim();
    return text || "I couldn't generate a response. Please try rephrasing your question.";
  } catch (err) {
    logger.error({ err }, 'Gemini generation failed');
    return "I'm having trouble responding right now. Please try again, or consult a verified doctor via the Doctors tab.";
  }
}
