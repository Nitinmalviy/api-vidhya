import { BadRequestError } from './AppError';

/**
 * Shared input validation used by patient + doctor + admin auth flows so the
 * server enforces the same rules the web and mobile clients show inline.
 */

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** Frequent misspellings of popular mail providers → the domain the user meant. */
const DOMAIN_TYPOS: Record<string, string> = {
  'gmail.con': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gmali.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'gmaill.com': 'gmail.com',
  'yahooo.com': 'yahoo.com',
  'yaho.com': 'yahoo.com',
  'yahoo.con': 'yahoo.com',
  'hotmial.com': 'hotmail.com',
  'hotmall.com': 'hotmail.com',
  'hotmail.con': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'outloook.com': 'outlook.com',
  'outlook.con': 'outlook.com',
  'iclould.com': 'icloud.com',
  'icloud.co': 'icloud.com',
  'rediffmail.con': 'rediffmail.com',
};

/**
 * Validates and normalizes an email address.
 * Throws BadRequestError on bad format or an obvious provider typo
 * (e.g. gmail.con) so users don't lock themselves out of OTP emails.
 */
export function assertValidEmail(raw: unknown): string {
  const email = String(raw ?? '')
    .toLowerCase()
    .trim();
  if (!email || !EMAIL_RE.test(email)) {
    throw new BadRequestError('Enter a valid email address');
  }
  const domain = email.slice(email.indexOf('@') + 1);
  const suggestion = DOMAIN_TYPOS[domain];
  if (suggestion) {
    throw new BadRequestError(
      `That email domain looks misspelled — did you mean @${suggestion}?`
    );
  }
  return email;
}

/** Password policy: at least 8 chars with an uppercase, lowercase, and digit. */
export function assertStrongPassword(raw: unknown): string {
  const password = String(raw ?? '');
  if (password.length < 8) {
    throw new BadRequestError('Password must be at least 8 characters');
  }
  if (!/[A-Z]/.test(password)) {
    throw new BadRequestError('Password must include an uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    throw new BadRequestError('Password must include a lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    throw new BadRequestError('Password must include a number');
  }
  return password;
}

/** Basic phone sanity: 6–15 digits, optional leading +, spaces/dashes allowed. */
export function assertValidPhone(raw: unknown): string {
  const phone = String(raw ?? '').trim();
  const digits = phone.replace(/[^0-9]/g, '');
  if (!/^\+?[0-9][0-9\s-]*$/.test(phone) || digits.length < 6 || digits.length > 15) {
    throw new BadRequestError('Enter a valid phone number');
  }
  return phone;
}
