import { BadRequestError } from './AppError';

/**
 * Indian mobile numbers only (OTP is sent over Indian SMS routes).
 * Accepts "98765 43210", "098765-43210", "+91 98765 43210", "919876543210"
 * and returns "+919876543210".
 */
export function toIndianMobile(raw: unknown): string {
  let digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(digits)) throw new BadRequestError('Enter a valid 10-digit Indian mobile number');
  return `+91${digits}`;
}

/** "+919876543210" → "+91 ••••• •3210" for messages and UI. */
export const maskMobile = (e164: string) => `+91 ••••• •${e164.slice(-4)}`;
