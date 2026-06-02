import crypto from 'crypto';
import { env } from '../config/env';

export const generateOtp = (): string =>
  Math.floor(100000 + Math.random() * 900000).toString();

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
 