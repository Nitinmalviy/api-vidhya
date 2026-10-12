import crypto from 'crypto';
import { env } from '../config/env';

/** 6-digit code from a CSPRNG — Math.random() is predictable and must not guard logins or resets. */
export const generateOtp = (): string => crypto.randomInt(100000, 1000000).toString();

export const hashOtp = (otp: string): string =>
  crypto.createHash('sha256').update(String(otp)).digest('hex');

export const otpExpiresAt = (): Date => {
  const date = new Date();
  date.setMinutes(date.getMinutes() + env.OTP_EXPIRES_IN_MINUTES);
  return date;
};

export const isOtpExpired = (expiresAt: Date): boolean => new Date() > expiresAt;

export const sendOtp = async (mobile: string, otp: string): Promise<void> => {
  if (env.NODE_ENV === 'development') {
    console.log(`OTP for ${mobile}: ${otp}`);
    return;
  }
};

export const sendEmailOtp = async (email: string, otp: string): Promise<void> => {
  if (env.NODE_ENV === 'development') {
    console.log(`OTP for ${email}: ${otp}`);
    return;
  }
};
 