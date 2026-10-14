import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { HydratedDocument } from 'mongoose';
import { Patient, type IPatient } from '../../models/Patient';
import { smsEnabled } from '../../services/sms';
import { issuePhoneOtp, consumePhoneOtp } from '../../services/phoneOtp';
import { toIndianMobile } from '../../utils/phone';
import { parseLocationAndSource } from './profile.controller';

type PatientDoc = HydratedDocument<IPatient>;
import { sendEmail, sendCodeEmail, otpEmailTemplate } from '../../services/email';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { generateOtp, hashOtp, otpExpiresAt } from '../../utils/otp';
import { BadRequestError, ConflictError, ForbiddenError, ServiceUnavailableError, UnauthorizedError } from '../../utils/AppError';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { assertValidEmail, assertStrongPassword, assertValidPhone } from '../../utils/validation';

/**
 * New login = new session: bump the version so tokens from any previous
 * device/browser stop working (single active session per user).
 */
async function startSession(patient: PatientDoc) {
  patient.sessionVersion = (patient.sessionVersion ?? 0) + 1;
  await patient.save();

  const tokenPayload = { id: String(patient._id), role: 'user' as const, sv: patient.sessionVersion };
  return {
    user: {
      id: patient._id,
      name: patient.name,
      email: patient.email,
      phone: patient.phone,
      plan: patient.plan,
      planId: patient.planId ?? null,
      planExpiresAt: patient.planExpiresAt ?? null,
      hasAddress: (patient.addresses ?? []).length > 0,
    },
    tokens: { accessToken: signAccessToken(tokenPayload), refreshToken: signRefreshToken(tokenPayload) },
  };
}

const GENDERS = ['MALE', 'FEMALE', 'OTHER'];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function parseSignupExtras(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const blank = (v: unknown) => v === undefined || v === null || v === '';
  if (!blank(body.gender)) {
    if (!GENDERS.includes(String(body.gender))) throw new BadRequestError('Invalid gender');
    out.gender = body.gender;
  }
  if (!blank(body.dateOfBirth)) {
    const dob = new Date(String(body.dateOfBirth));
    const years = (Date.now() - dob.getTime()) / (365.25 * 86_400_000);
    if (Number.isNaN(dob.getTime()) || years < 0 || years > 120) throw new BadRequestError('Enter a valid date of birth');
    out.dateOfBirth = dob;
  }
  if (!blank(body.bloodGroup)) {
    if (!BLOOD_GROUPS.includes(String(body.bloodGroup))) throw new BadRequestError('Invalid blood group');
    out.bloodGroup = body.bloodGroup;
  }
  if (Array.isArray(body.conditions)) {
    out.conditions = [...new Set(body.conditions.map((c) => String(c).trim().slice(0, 60)).filter(Boolean))].slice(0, 15);
  }
  for (const [k, v] of Object.entries(parseLocationAndSource(body))) if (v !== null) out[k] = v;
  return out;
}

/* ─────────────────────────────────────────────
   POST /api/patient/auth/register
───────────────────────────────────────────── */
export const register = async (req: Request, res: Response): Promise<void> => {
  const { name, email, phone, password } = req.body ?? {};

  if (!name || !email || !phone || !password) {
    throw new BadRequestError('name, email, phone, and password are required');
  }
  assertStrongPassword(password);
  assertValidPhone(phone);

  const normalizedEmail = assertValidEmail(email);
  // Optional "about you" answers; skipped fields stay empty and can be filled in later.
  const extras = parseSignupExtras(req.body ?? {});

  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const expires = otpExpiresAt();

  const existing = await Patient.findOne({ email: normalizedEmail })
    .select('+password isEmailVerified')
    .exec();

  if (existing) {
    // Block only if the account is already verified.
    if (existing.isEmailVerified) {
      throw new ConflictError('An account with this email already exists');
    }

    // Unverified account from a past, incomplete signup — refresh details + OTP and resend.
    existing.name = String(name).trim();
    existing.phone = String(phone).trim();
    existing.password = String(password); // re-hashed by the pre-save hook
    existing.set(extras);
    existing.emailVerificationTokenHash = otpHash;
    existing.emailVerificationExpires = expires;
    await existing.save();
  } else {
    await Patient.create({
      name: String(name).trim(),
      email: normalizedEmail,
      phone: String(phone).trim(),
      password,
      ...extras,
      isEmailVerified: false,
      emailVerificationTokenHash: otpHash,
      emailVerificationExpires: expires,
    });
  }

  const tpl = otpEmailTemplate({
    heading: 'Verify your email',
    intro: `Hi ${String(name).trim()}, use the code below to verify your VidhyaCare account.`,
    otp,
    expiresInMinutes: env.OTP_EXPIRES_IN_MINUTES,
  });

  // Don't fail registration if the email provider hiccups — the user can resend.
  try {
    await sendEmail({
      to: normalizedEmail,
      subject: 'Your VidhyaCare verification code',
      text: tpl.text,
      html: tpl.html,
    });
  } catch (err) {
    logger.error({ err, email: normalizedEmail }, 'Patient registration: failed to send OTP email');
  }

  res.status(201).json({
    success: true,
    message: 'Account created. Please check your email for the verification OTP.',
    data: { email: normalizedEmail },
  });
};

/* ─────────────────────────────────────────────
   POST /api/patient/auth/verify-email
───────────────────────────────────────────── */
export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  const { email, otp } = req.body ?? {};
  if (!email || !otp) throw new BadRequestError('email and otp are required');

  const otpHash = hashOtp(String(otp).trim());

  const patient = await Patient.findOne({
    email: String(email).toLowerCase(),
    emailVerificationTokenHash: otpHash,
    emailVerificationExpires: { $gt: new Date() },
  })
    .select('+emailVerificationTokenHash +emailVerificationExpires')
    .exec();

  if (!patient) throw new BadRequestError('Invalid or expired OTP');

  patient.isEmailVerified = true;
  patient.emailVerificationTokenHash = undefined;
  patient.emailVerificationExpires = undefined;
  await patient.save();

  res.status(200).json({ success: true, message: 'Email verified successfully. You can now sign in.' });
};

/* ─────────────────────────────────────────────
   POST /api/patient/auth/login
───────────────────────────────────────────── */
export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (!email || !password) throw new BadRequestError('email and password are required');

  const patient = await Patient.findOne({ email: String(email).toLowerCase() })
    .select('+password')
    .exec();
  if (!patient) throw new UnauthorizedError('Invalid email or password');

  const ok = await patient.comparePassword(String(password));
  if (!ok) throw new UnauthorizedError('Invalid email or password');

  if (!patient.isEmailVerified) {
    throw new ForbiddenError('Please verify your email before signing in');
  }

  res.status(200).json({ success: true, message: 'Login successful', data: await startSession(patient) });
};

/* ─────────────────────────────────────────────
   POST /api/patient/auth/refresh  { refreshToken }
   Issues a fresh access token so users stay
   signed in until the refresh token expires —
   unless they logged in elsewhere meanwhile.
───────────────────────────────────────────── */
export const refresh = async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) throw new BadRequestError('refreshToken is required');

  const payload = verifyRefreshToken(String(refreshToken));
  if (payload.role !== 'user') throw new UnauthorizedError('Invalid refresh token');

  const patient = await Patient.findById(payload.id).select('sessionVersion').lean();
  if (!patient) throw new UnauthorizedError('Account no longer exists');
  // Tokens without a session version predate single-session support; make them sign in again
  // so they can't mint fresh tokens past a password change.
  if (payload.sv === undefined || (patient.sessionVersion ?? 0) !== payload.sv) {
    throw new UnauthorizedError('Your session has ended. Please sign in again.');
  }

  const accessToken = signAccessToken({ id: payload.id, role: 'user', sv: payload.sv });

  res.status(200).json({ success: true, data: { accessToken } });
};

/* ─────────────────────────────────────────────
   POST /api/patient/auth/forgot-password
───────────────────────────────────────────── */
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body ?? {};
  if (!email) throw new BadRequestError('email is required');

  const patient = await Patient.findOne({ email: String(email).trim().toLowerCase() })
    .select('+passwordResetTokenHash +passwordResetExpires')
    .exec();

  // Always respond the same to avoid leaking registered emails
  if (!patient) {
    res.status(200).json({ success: true, message: 'If that email is registered, a reset OTP has been sent.' });
    return;
  }

  const otp = generateOtp();
  const otpHash = hashOtp(otp);

  patient.passwordResetTokenHash = otpHash;
  patient.passwordResetExpires = otpExpiresAt();
  await patient.save();

  const tpl = otpEmailTemplate({
    heading: 'Reset your password',
    intro: 'Use the code below to reset your VidhyaCare password.',
    otp,
    expiresInMinutes: env.OTP_EXPIRES_IN_MINUTES,
  });

  await sendCodeEmail({
    to: patient.email,
    subject: 'Your VidhyaCare password reset OTP',
    text: tpl.text,
    html: tpl.html,
  });

  res.status(200).json({ success: true, message: 'If that email is registered, a reset OTP has been sent.' });
};

/* ─────────────────────────────────────────────
   POST /api/patient/auth/verify-reset-otp
   Returns a short-lived reset JWT the client
   uses to call reset-password exactly once.
───────────────────────────────────────────── */
export const verifyResetOtp = async (req: Request, res: Response): Promise<void> => {
  const { email, otp } = req.body ?? {};
  if (!email || !otp) throw new BadRequestError('email and otp are required');

  const otpHash = hashOtp(String(otp).trim());

  const patient = await Patient.findOne({
    email: String(email).toLowerCase(),
    passwordResetTokenHash: otpHash,
    passwordResetExpires: { $gt: new Date() },
  })
    .select('+passwordResetTokenHash +passwordResetExpires')
    .exec();

  if (!patient) throw new BadRequestError('Invalid or expired OTP');

  // Issue a 10-min single-use reset token (keep hash in DB until reset-password clears it)
  const resetToken = jwt.sign(
    { id: String(patient._id), purpose: 'password-reset' },
    env.JWT_SECRET,
    { expiresIn: '10m' }
  );

  res.status(200).json({
    success: true,
    message: 'OTP verified. Use the resetToken to set a new password.',
    data: { resetToken },
  });
};

/* ─────────────────────────────────────────────
   POST /api/patient/auth/reset-password
───────────────────────────────────────────── */
export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  const { resetToken, newPassword } = req.body ?? {};
  if (!resetToken || !newPassword) {
    throw new BadRequestError('resetToken and newPassword are required');
  }
  assertStrongPassword(newPassword);

  let payload: { id: string; purpose: string };
  try {
    payload = jwt.verify(String(resetToken), env.JWT_SECRET) as typeof payload;
  } catch {
    throw new BadRequestError('Invalid or expired reset token');
  }

  if (payload.purpose !== 'password-reset') {
    throw new BadRequestError('Invalid reset token');
  }

  const patient = await Patient.findById(payload.id)
    .select('+passwordResetTokenHash +passwordResetExpires')
    .exec();

  if (!patient) throw new BadRequestError('Patient not found');

  // Ensure the OTP hash is still present (not already used)
  if (!patient.passwordResetTokenHash) {
    throw new BadRequestError('Reset token already used');
  }

  patient.password = String(newPassword);
  patient.passwordResetTokenHash = undefined;
  patient.passwordResetExpires = undefined;
  // Whoever knew the old password is signed out everywhere.
  patient.sessionVersion = (patient.sessionVersion ?? 0) + 1;
  await patient.save();

  res.status(200).json({ success: true, message: 'Password reset successful. You can now sign in.' });
};

/* ─────────────────────────────────────────────
   GET /api/patient/auth/methods
   Which sign-in options the app should offer.
───────────────────────────────────────────── */
export const authMethods = async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({ success: true, data: { email: true, phoneOtp: smsEnabled() } });
};

const PHONE_SENT = 'If this number is linked to a VidhyaCare account, we have sent a code to it.';

/* ─────────────────────────────────────────────
   POST /api/patient/auth/phone/request-otp  { phone }
   Only numbers a patient has already verified can sign in, and we text only
   those, so this can't be used to spam arbitrary phones. The reply is the
   same either way so it doesn't reveal who has an account.
───────────────────────────────────────────── */
export const requestPhoneLoginOtp = async (req: Request, res: Response): Promise<void> => {
  if (!smsEnabled()) throw new ServiceUnavailableError('Phone sign-in is not available right now. Please use email.');
  const phone = toIndianMobile(req.body?.phone);

  const patient = await Patient.exists({ verifiedPhone: phone });
  if (patient) {
    await issuePhoneOtp(phone, 'LOGIN');
  }
  res.status(200).json({ success: true, message: PHONE_SENT });
};

/* ─────────────────────────────────────────────
   POST /api/patient/auth/phone/verify-otp  { phone, otp }
───────────────────────────────────────────── */
export const verifyPhoneLoginOtp = async (req: Request, res: Response): Promise<void> => {
  const phone = toIndianMobile(req.body?.phone);
  await consumePhoneOtp(phone, 'LOGIN', req.body?.otp);

  const patient = await Patient.findOne({ verifiedPhone: phone }).exec();
  if (!patient) throw new BadRequestError('Invalid or expired code');

  res.status(200).json({ success: true, message: 'Login successful', data: await startSession(patient) });
};
