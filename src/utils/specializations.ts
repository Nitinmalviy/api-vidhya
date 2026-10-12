/** Escapes user text so it is matched literally inside a MongoDB $regex. */
export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MAX_LENGTH = 60;
const MAX_COUNT = 10;

/**
 * Cleans the specializations a doctor sends: strings only, whitespace
 * collapsed, 2–60 chars, at most 10, no case-insensitive duplicates.
 * Doctors may type a specialization that isn't in the app's list, so this
 * validates shape rather than checking against a fixed set.
 */
export function sanitizeSpecializations(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const s = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
    if (s.length < 2 || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length === MAX_COUNT) break;
  }
  return out;
}
