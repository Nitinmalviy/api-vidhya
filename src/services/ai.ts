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

/* ────────────────────────────────────────────────────────────────────
   Helpers
──────────────────────────────────────────────────────────────────── */

/** Split a comma/space/newline-separated env value into a clean list. */
function parseList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Show only the last 4 chars of a secret in logs. */
function maskKey(key: string): string {
  return key.length <= 4 ? '****' : `…${key.slice(-4)}`;
}

/** Classify an error so the console clearly says WHY a provider failed. */
function classify(err: unknown): { tag: string; detail: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('429') || lower.includes('quota') || lower.includes('resource_exhausted') || lower.includes('rate limit')) {
    return { tag: 'RATE-LIMIT/QUOTA', detail: msg.slice(0, 160) };
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('permission') || lower.includes('invalid api key')) {
    return { tag: 'BAD-KEY/AUTH', detail: msg.slice(0, 160) };
  }
  if (lower.includes('timeout') || lower.includes('aborted')) {
    return { tag: 'TIMEOUT', detail: msg.slice(0, 160) };
  }
  if (lower.includes('404') || lower.includes('not found') || lower.includes('does not exist')) {
    return { tag: 'MODEL-NOT-FOUND', detail: msg.slice(0, 160) };
  }
  return { tag: 'ERROR', detail: msg.slice(0, 200) };
}

/* ────────────────────────────────────────────────────────────────────
   Attempts — one entry per (provider × key × model).
   The chain tries them in order until one returns text.
──────────────────────────────────────────────────────────────────── */

type Attempt = {
  provider: string;
  /** Human label for logs, e.g. "gemini-1.5-flash · key …a1b2" */
  label: string;
  run: (history: ChatTurn[], userMessage: string, systemPrompt: string) => Promise<string>;
};

// Cache one Gemini client per API key.
const geminiClients = new Map<string, GoogleGenerativeAI>();
function geminiClient(key: string): GoogleGenerativeAI {
  let c = geminiClients.get(key);
  if (!c) {
    c = new GoogleGenerativeAI(key);
    geminiClients.set(key, c);
  }
  return c;
}

function buildAttempts(): Attempt[] {
  const attempts: Attempt[] = [];

  // ── Gemini: every key × every model ──
  const geminiKeys = parseList(env.GEMINI_API_KEY);
  const geminiModels = parseList(env.GEMINI_CHAT_MODEL);
  for (const key of geminiKeys) {
    for (const modelName of geminiModels) {
      attempts.push({
        provider: 'gemini',
        label: `${modelName} · key ${maskKey(key)}`,
        run: async (history, userMessage, systemPrompt) => {
          const model = geminiClient(key).getGenerativeModel({
            model: modelName,
            systemInstruction: systemPrompt,
          });
          const contents = history.slice(-12).map((t) => ({
            role: t.role === 'ai' ? 'model' : 'user',
            parts: [{ text: t.text }],
          }));
          contents.push({ role: 'user', parts: [{ text: userMessage }] });
          const result = await model.generateContent({ contents });
          return result.response.text().trim();
        },
      });
    }
  }

  // ── Hugging Face: every key × every model (OpenAI-compatible router) ──
  const hfKeys = parseList(env.HUGGINGFACE_API_KEY);
  const hfModels = parseList(env.HF_CHAT_MODEL);
  for (const key of hfKeys) {
    for (const modelName of hfModels) {
      attempts.push({
        provider: 'huggingface',
        label: `${modelName} · key ${maskKey(key)}`,
        run: async (history, userMessage, systemPrompt) => {
          const messages = [
            { role: 'system', content: systemPrompt },
            ...history.slice(-12).map((t) => ({
              role: t.role === 'ai' ? 'assistant' : 'user',
              content: t.text,
            })),
            { role: 'user', content: userMessage },
          ];
          const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model: modelName, messages, max_tokens: 300, temperature: 0.6 }),
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          }
          const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
          return (json.choices?.[0]?.message?.content ?? '').trim();
        },
      });
    }
  }

  return attempts;
}

const ATTEMPTS = buildAttempts();

// Log the configuration once at startup so you can see what's wired up.
logger.info(
  `[VidhyaAI] Configured ${ATTEMPTS.length} model attempt(s): ${
    ATTEMPTS.map((a) => `${a.provider}(${a.label})`).join(' → ') || 'NONE — check GEMINI_API_KEY / HUGGINGFACE_API_KEY in .env'
  }`
);

/* ────────────────────────────────────────────────────────────────────
   Core chain — tries each attempt in order, logging every step.
──────────────────────────────────────────────────────────────────── */

async function runChain(
  purpose: string,
  history: ChatTurn[],
  userMessage: string,
  systemPrompt: string
): Promise<string | null> {
  logger.info(
    `[VidhyaAI] ▶ (${purpose}) request received | msg="${userMessage.slice(0, 60)}${
      userMessage.length > 60 ? '…' : ''
    }" | history=${history.length} turn(s) | ${ATTEMPTS.length} provider attempt(s) available`
  );

  if (ATTEMPTS.length === 0) {
    logger.error('[VidhyaAI] ✗ No providers configured — set GEMINI_API_KEY (and optionally HUGGINGFACE_API_KEY) in .env');
    return null;
  }

  for (let i = 0; i < ATTEMPTS.length; i++) {
    const a = ATTEMPTS[i];
    const step = `${i + 1}/${ATTEMPTS.length}`;
    const t0 = Date.now();
    logger.info(`[VidhyaAI] → [${step}] trying ${a.provider} | ${a.label}`);
    try {
      const text = (await a.run(history, userMessage, systemPrompt)).trim();
      const ms = Date.now() - t0;
      if (text) {
        logger.info(`[VidhyaAI] ✓ [${step}] ${a.provider} replied in ${ms}ms (${text.length} chars) — using this`);
        return text;
      }
      logger.warn(`[VidhyaAI] ⚠ [${step}] ${a.provider} returned EMPTY in ${ms}ms — trying next`);
    } catch (err) {
      const ms = Date.now() - t0;
      const { tag, detail } = classify(err);
      logger.error(`[VidhyaAI] ✗ [${step}] ${a.provider} FAILED in ${ms}ms [${tag}]: ${detail} — trying next`);
    }
  }

  logger.error(`[VidhyaAI] ✗ (${purpose}) ALL ${ATTEMPTS.length} attempt(s) failed — using fallback`);
  return null;
}

/**
 * Generate an AI reply for chat. Always resolves to a string: the custom
 * fallback message is returned if every provider fails.
 */
export async function generateAiReply(history: ChatTurn[], userMessage: string): Promise<string> {
  const text = await runChain('chat', history, userMessage, SYSTEM_PROMPT);
  return text ?? FALLBACK_MESSAGE;
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

  return runChain('health-report', [], lines.join('\n'), REPORT_SYSTEM_PROMPT);
}
