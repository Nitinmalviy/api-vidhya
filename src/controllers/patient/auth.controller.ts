import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Patient } from '../../models/Patient';
import { sendEmail, otpEmailTemplate } from '../../services/email';
import { signAccessToken, signRefreshToken } from '../../utils/jwt';
import { generateOtp, hashOtp, otpExpiresAt } from '../../utils/otp';
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError } from '../../utils/AppError';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

/* ─────────────────────────────────────────────
   POST /api/patient/auth/register
───────────────────────────────────────────── */
export const register = async (req: Request, res: Response): Promise<void> => {
  const { name, email, phone, password } = req.body ?? {};

  if (!name || !email || !phone || !password) {
    throw new BadRequestError('name, email, phone, and password are required');
  }
  if (String(password).length < 8) {
    throw new BadRequestError('Password must be at least 8 characters');
  }

  const normalizedEmail = String(email).toLowerCase().trim();

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
    existing.emailVerificationTokenHash = otpHash;
    existing.emailVerificationExpires = expires;
    await existing.save();
  } else {
    await Patient.create({
      name: String(name).trim(),
      email: normalizedEmail,
      phone: String(phone).trim(),
      password,
      isEmailVerified: false,
      emailVerificationTokenHash: otpHash,
      emailVerificationExpires: expires,
    });
  }

  const tpl = otpEmailTemplate({
    heading: 'Verify your email',
    intro: `Hi ${String(name).trim()}, use the code below to verify your Vidhya.care account.`,
    otp,
    expiresInMinutes: env.OTP_EXPIRES_IN_MINUTES,
  });

  // Don't fail registration if the email provider hiccups — the user can resend.
  try {
    await sendEmail({
      to: normalizedEmail,
      subject: 'Your Vidhya.care verification code',
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

  const accessToken = signAccessToken({ id: String(patient._id), role: 'user' });
  const refreshToken = signRefreshToken({ id: String(patient._id), role: 'user' });

  res.status(200).json({
    success: true,
    message: 'Login successful',
    data: {
      user: {
        id: patient._id,
        name: patient.name,
        email: patient.email,
        phone: patient.phone,
        plan: patient.plan,
      },
      tokens: { accessToken, refreshToken },
    },
  });
};

/* ─────────────────────────────────────────────
   POST /api/patient/auth/forgot-password
───────────────────────────────────────────── */
export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body ?? {};
  if (!email) throw new BadRequestError('email is required');

  const patient = await Patient.findOne({ email: String(email).toLowerCase() })
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
    intro: 'Use the code below to reset your Vidhya.care password.',
    otp,
    expiresInMinutes: env.OTP_EXPIRES_IN_MINUTES,
  });

  try {
    await sendEmail({
      to: patient.email,
      subject: 'Your Vidhya.care password reset OTP',
      text: tpl.text,
      html: tpl.html,
    });
  } catch (err) {
    logger.error({ err, email: patient.email }, 'Patient forgot-password: failed to send OTP email');
  }

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
  if (String(newPassword).length < 8) {
    throw new BadRequestError('Password must be at least 8 characters');
  }

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
  await patient.save();

  res.status(200).json({ success: true, message: 'Password reset successful. You can now sign in.' });
};
