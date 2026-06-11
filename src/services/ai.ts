import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export type ChatTurn = { role: 'user' | 'ai'; text: string };

const SYSTEM_PROMPT = `You are "Vidhya AI", a friendly, careful medical assistant for the VidhyaCare healthcare app in India.
Guidelines:
- Give clear, concise, easy-to-understand health guidance.
- Always remind the user this is general information, not a diagnosis, and to consult a verified doctor for serious or persistent symptoms.
- When relevant, suggest which type of specialist to consult (e.g. cardiologist, dermatologist).
- Never prescribe specific prescription medicines or dosages.
- Keep answers short (under 120 words) and supportive. Use simple language.
- If the question is an emergency (chest pain, severe bleeding, breathing trouble), tell them to seek emergency care immediately.`;

/**
 * Shown when every AI provider is down or unconfigured. Override with the
 * AI_FALLBACK_MESSAGE env var without redeploying code.
 */
const FALLBACK_MESSAGE =
  env.AI_FALLBACK_MESSAGE ??
  'Vidhya AI is taking a short break right now 😔 — our team is already on it. ' +
    'Meanwhile, you can browse verified doctors in the Doctors tab and book an appointment, ' +
    'or try asking me again in a few minutes. If this is an emergency, please call 108 or visit the nearest hospital.';

/**
 * A pluggable chat model. Providers are tried in order; the first one that is
 * configured and returns text wins. To add a new model (e.g. another Hugging
 * Face model), implement this interface and append it to PROVIDERS below.
 */
export interface AiProvider {
  name: string;
  isAvailable(): boolean;
  generate(history: ChatTurn[], userMessage: string, systemPrompt?: string): Promise<string>;
}

/* ── Provider 1: Google Gemini ── */

let geminiClient: GoogleGenerativeAI | null = null;

const gemini: AiProvider = {
  name: 'gemini',
  isAvailable: () => Boolean(env.GEMINI_API_KEY),
  async generate(history, userMessage, systemPrompt) {
    if (!geminiClient) geminiClient = new GoogleGenerativeAI(env.GEMINI_API_KEY);
    const model = geminiClient.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: systemPrompt ?? SYSTEM_PROMPT,
    });

    const contents = history.slice(-12).map((t) => ({
      role: t.role === 'ai' ? 'model' : 'user',
      parts: [{ text: t.text }],
    }));
    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    const result = await model.generateContent({ contents });
    return result.response.text().trim();
  },
};

/* ── Provider 2: Hugging Face (OpenAI-compatible router) ── */

const huggingface: AiProvider = {
  name: 'huggingface',
  isAvailable: () => Boolean(env.HUGGINGFACE_API_KEY),
  async generate(history, userMessage, systemPrompt) {
    const messages = [
      { role: 'system', content: systemPrompt ?? SYSTEM_PROMPT },
      ...history.slice(-12).map((t) => ({
        role: t.role === 'ai' ? 'assistant' : 'user',
        content: t.text,
      })),
      { role: 'user', content: userMessage },
    ];

    const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.HUGGINGFACE_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.HF_CHAT_MODEL,
        messages,
        max_tokens: 300,
        temperature: 0.6,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      throw new Error(`Hugging Face responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return (json.choices?.[0]?.message?.content ?? '').trim();
  },
};

/** Ordered fallback chain — first available provider that answers wins. */
const PROVIDERS: AiProvider[] = [gemini, huggingface];

/**
 * Generate an AI reply given the prior conversation + the new user message.
 * Tries each configured provider in order; if all fail, returns the custom
 * fallback message instead of throwing, so chat always responds.
 */
export async function generateAiReply(history: ChatTurn[], userMessage: string): Promise<string> {
  for (const provider of PROVIDERS) {
    if (!provider.isAvailable()) continue;
    try {
      const text = await provider.generate(history, userMessage);
      if (text) return text;
      logger.warn({ provider: provider.name }, 'AI provider returned empty response');
    } catch (err) {
      logger.error({ err, provider: provider.name }, 'AI provider failed, trying next');
    }
  }
  return FALLBACK_MESSAGE;
}

/* ── Health report generation ── */

const REPORT_SYSTEM_PROMPT = `You are "Vidhya AI", a careful medical assistant writing a personal health report for a patient of the VidhyaCare app in India.
You will receive the patient's details (age, gender, blood group, BMI) and their described concerns.
Write a structured plain-text report with EXACTLY these section headings, each on its own line ending with a colon, followed by the section body:

Overview:
Body Assessment:
Diet & Nutrition:
Lifestyle Recommendations:
Hair Care:
Skin Care:
When to See a Doctor:

Rules:
- Personalise every section to the patient's data (mention their BMI category, age group, and concerns).
- Include "Hair Care:" only if hair concerns were given, and "Skin Care:" only if skin concerns were given; otherwise omit those sections entirely.
- Be supportive, practical, and specific (e.g. food suggestions common in India), but NEVER diagnose or name prescription medicines/dosages.
- In "When to See a Doctor:", suggest the right specialist type for their concerns.
- No markdown symbols (no *, #, -). Use short paragraphs or sentences separated by newlines.
- Keep the whole report under 450 words.`;

export type HealthReportInput = {
  name: string;
  age: number | null;
  gender: string | null;
  bloodGroup: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
  bmiCategory: string | null;
  conditions: string[];
  allergies: string[];
  concerns: { general?: string; hair?: string; skin?: string; lifestyle?: string };
};

/**
 * Generate the AI analysis for a health report. Returns null when every
 * provider fails so the caller can build a non-AI baseline report instead.
 */
export async function generateHealthAnalysis(input: HealthReportInput): Promise<string | null> {
  const lines = [
    `Patient: ${input.name}`,
    input.age !== null ? `Age: ${input.age} years` : 'Age: not provided',
    input.gender ? `Gender: ${input.gender}` : '',
    input.bloodGroup ? `Blood group: ${input.bloodGroup}` : '',
    input.heightCm ? `Height: ${input.heightCm} cm` : '',
    input.weightKg ? `Weight: ${input.weightKg} kg` : '',
    input.bmi !== null ? `BMI: ${input.bmi} (${input.bmiCategory})` : '',
    input.conditions.length ? `Known conditions: ${input.conditions.join(', ')}` : '',
    input.allergies.length ? `Allergies: ${input.allergies.join(', ')}` : '',
    input.concerns.general ? `General health concerns: ${input.concerns.general}` : '',
    input.concerns.hair ? `Hair-related concerns: ${input.concerns.hair}` : '',
    input.concerns.skin ? `Skin-related concerns: ${input.concerns.skin}` : '',
    input.concerns.lifestyle ? `Lifestyle notes: ${input.concerns.lifestyle}` : '',
    '',
    'Write the health report now.',
  ].filter(Boolean);

  const message = lines.join('\n');

  for (const provider of PROVIDERS) {
    if (!provider.isAvailable()) continue;
    try {
      const text = await provider.generate([], message, REPORT_SYSTEM_PROMPT);
      if (text) return text;
      logger.warn({ provider: provider.name }, 'AI provider returned empty report');
    } catch (err) {
      logger.error({ err, provider: provider.name }, 'AI report generation failed, trying next');
    }
  }
  return null;
}
