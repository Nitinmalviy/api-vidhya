import crypto from 'crypto';
import type { Types } from 'mongoose';
import { PhoneOtp, PHONE_OTP_MAX_ATTEMPTS, type PhoneOtpPurpose } from '../models/PhoneOtp';
import { generateOtp, hashOtp, otpExpiresAt } from '../utils/otp';
import { BadRequestError } from '../utils/AppError';
import { sendOtpSms } from './sms';

/** Creates (or replaces) the live code for this phone + purpose and texts it. */
export async function issuePhoneOtp(phone: string, purpose: PhoneOtpPurpose, patientId?: Types.ObjectId | string) {
  const otp = generateOtp();
  await PhoneOtp.findOneAndUpdate(
    { phone, purpose },
    { $set: { codeHash: hashOtp(otp), attempts: 0, expiresAt: otpExpiresAt(), patientId } },
    { upsert: true }
  );
  try {
    await sendOtpSms(phone, otp);
  } catch (err) {
    // A code nobody received shouldn't stay guessable.
    await PhoneOtp.deleteOne({ phone, purpose });
    throw err;
  }
}

const INVALID = 'Invalid or expired code';

/** Consumes the code if it matches. Wrong guesses count toward a per-code limit. */
export async function consumePhoneOtp(
  phone: string,
  purpose: PhoneOtpPurpose,
  code: unknown,
  patientId?: Types.ObjectId | string
): Promise<void> {
  const clean = String(code ?? '').trim();
  if (!/^\d{6}$/.test(clean)) throw new BadRequestError('Enter the 6-digit code');

  const doc = await PhoneOtp.findOne({ phone, purpose, expiresAt: { $gt: new Date() } }).lean();
  if (!doc || (patientId && String(doc.patientId) !== String(patientId))) throw new BadRequestError(INVALID);

  const given = Buffer.from(hashOtp(clean), 'hex');
  const stored = Buffer.from(doc.codeHash, 'hex');
  const match = given.length === stored.length && crypto.timingSafeEqual(given, stored);

  if (!match) {
    const after = await PhoneOtp.findOneAndUpdate({ _id: doc._id }, { $inc: { attempts: 1 } }, { new: true }).lean();
    if (!after || after.attempts >= PHONE_OTP_MAX_ATTEMPTS) {
      await PhoneOtp.deleteOne({ _id: doc._id });
      throw new BadRequestError('Too many wrong codes. Please request a new one.');
    }
    throw new BadRequestError(INVALID);
  }

  // Delete keyed on the exact hash so two simultaneous correct submissions can't both win.
  const used = await PhoneOtp.findOneAndDelete({ _id: doc._id, codeHash: doc.codeHash });
  if (!used) throw new BadRequestError(INVALID);
}
