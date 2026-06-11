import type { Request, Response } from 'express';
import crypto from 'crypto';
import { Doctor } from '../../models/Doctor';
import { Clinic } from '../../models/Clinic';
import { uploadBase64ToCloudinary } from '../../services/cloudinaryUpload';
import { sendEmail, otpEmailTemplate } from '../../services/email';
import { signAccessToken, signRefreshToken } from '../../utils/jwt';
import { generateRandomToken } from '../../utils/tokens';
import { generateOtp, hashOtp, otpExpiresAt } from '../../utils/otp';
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError } from '../../utils/AppError';
import { createNotification } from '../../services/notification';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export const register = async (req: Request, res: Response): Promise<void> => {
  const {
    name,
    email,
    password,
    phone,
    workType,
    clinicId,
    clinicName,
    specializations,
    degreeName,
    university,
    passingYear,
    degreeFile,
    licenseNumber,
    expiryDate,
    licenseFile,
    clinicPhotoFile,
  } = req.body ?? {};

  // ── Validate everything BEFORE creating records / uploading files ──
  if (!name || !email || !password || !phone || !workType) {
    throw new BadRequestError('name, email, password, phone, and workType are required');
  }
  if (workType !== 'OWN_CLINIC' && workType !== 'EMPLOYEE') {
    throw new BadRequestError("workType must be 'OWN_CLINIC' or 'EMPLOYEE'");
  }
  if (String(password).length < 8) {
    throw new BadRequestError('Password must be at least 8 characters');
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = await Doctor.findOne({ email: normalizedEmail }).lean().exec();
  if (existing) throw new ConflictError('An account with this email already exists');

  // 6-digit OTP for email verification
  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const emailVerificationExpires = otpExpiresAt();

  const [degreeUrl, licenseUrl, clinicPhotoUrl] = await Promise.all([
    degreeFile ? uploadBase64ToCloudinary(degreeFile, 'doctor-kyc') : Promise.resolve(undefined),
    licenseFile ? uploadBase64ToCloudinary(licenseFile, 'doctor-kyc') : Promise.resolve(undefined),
    clinicPhotoFile ? uploadBase64ToCloudinary(clinicPhotoFile, 'clinic') : Promise.resolve(undefined),
  ]);

  const doctor = await Doctor.create({
    name: String(name).trim(),
    email: normalizedEmail,
    password,
    phone: String(phone).trim(),
    workType,
    clinicId: clinicId || undefined,
    specializations: Array.isArray(specializations) ? specializations : [],
    kycStatus: 'PENDING',
    isEmailVerified: false,
    emailVerificationTokenHash: otpHash,
    emailVerificationExpires,
    degreeDetails:
      degreeName && degreeUrl
        ? {
            degreeName,
            university: university || 'N/A',
            passingYear: passingYear ? Number(passingYear) : new Date().getFullYear(),
            documentUrl: degreeUrl,
          }
        : undefined,
    licenseDetails:
      licenseNumber && licenseUrl
        ? {
            licenseNumber,
            expiryDate: expiryDate ? new Date(expiryDate) : new Date(Date.now() + 1000 * 60 * 60 * 24 * 365 * 5),
            documentUrl: licenseUrl,
          }
        : undefined,
  });

  // Own-clinic doctors get a clinic record; employees can add a clinic later.
  if (workType === 'OWN_CLINIC') {
    const clinic = await Clinic.create({
      name: clinicName,
      photoUrl: clinicPhotoUrl,
      doctorId: doctor._id,
      isVerified: false,
    });
    doctor.clinicId = clinic._id;
    await doctor.save();
  }

  // Send 6-digit verification OTP (don't fail registration if email hiccups)
  const tpl = otpEmailTemplate({
    heading: 'Verify your email',
    intro: `Hi ${String(name).trim()}, use the code below to verify your VidhyaCare doctor account.`,
    otp,
    expiresInMinutes: env.OTP_EXPIRES_IN_MINUTES,
  });
  try {
    await sendEmail({
      to: doctor.email,
      subject: 'Your VidhyaCare verification code',
      text: tpl.text,
      html: tpl.html,
    });
  } catch (err) {
    logger.error({ err, email: doctor.email }, 'Doctor registration: failed to send verification email');
  }

  // Acknowledge KYC submission (in-app — shown after they verify & log in)
  await createNotification({
    userId: doctor._id,
    role: 'doctor',
    type: 'KYC_SUBMITTED',
    title: 'KYC Details Received',
    message: 'We have received your KYC details. Our admin team will review them and notify you once approved.',
  });

  res.status(201).json({
    success: true,
    message: 'Doctor registered. Please verify your email.',
    data: {
      id: doctor._id,
      email: doctor.email,
      kycStatus: doctor.kycStatus,
      clinicId: doctor.clinicId,
      isEmailVerified: doctor.isEmailVerified,
    },
  });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (!email || !password) throw new BadRequestError('email and password are required');

  const doctor = await Doctor.findOne({ email: String(email).toLowerCase() })
    .select('+password')
    .exec();
  if (!doctor) throw new UnauthorizedError('Invalid credentials');

  const ok = await doctor.comparePassword(String(password));
  if (!ok) throw new UnauthorizedError('Invalid credentials');

  if (!doctor.isEmailVerified) throw new ForbiddenError('Email not verified');
  if (doctor.kycStatus !== 'APPROVED') throw new ForbiddenError('Doctor not approved yet');

  const accessToken = signAccessToken({ id: String(doctor._id), role: 'doctor' });
  const refreshToken = signRefreshToken({ id: String(doctor._id), role: 'doctor' });

  res.status(200).json({
    success: true,
    message: 'Doctor login successful',
    data: {
      user: { id: doctor._id, email: doctor.email, role: 'doctor' },
      tokens: { accessToken, refreshToken },
    },
  });
};

export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  const { email, code } = req.body ?? {};
  if (!email || !code) throw new BadRequestError('email and code are required');

  const tokenHash = crypto.createHash('sha256').update(String(code)).digest('hex');
  const doctor = await Doctor.findOne({
    email: String(email).toLowerCase(),
    emailVerificationTokenHash: tokenHash,
    emailVerificationExpires: { $gt: new Date() },
  })
    .select('+emailVerificationTokenHash +emailVerificationExpires')
    .exec();

  if (!doctor) throw new BadRequestError('Invalid or expired verification code');

  doctor.isEmailVerified = true;
  doctor.emailVerificationTokenHash = undefined;
  doctor.emailVerificationExpires = undefined;
  await doctor.save();

  res.status(200).json({ success: true, message: 'Email verified' });
};

export const resendVerification = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body ?? {};
  if (!email) throw new BadRequestError('email is required');

  const doctor = await Doctor.findOne({ email: String(email).toLowerCase() })
    .select('+emailVerificationTokenHash +emailVerificationExpires')
    .exec();

  // Don't leak which emails exist / are already verified
  if (!doctor || doctor.isEmailVerified) {
    res.status(200).json({ success: true, message: 'If the account exists, a new code was sent' });
    return;
  }

  const otp = generateOtp();
  doctor.emailVerificationTokenHash = hashOtp(otp);
  doctor.emailVerificationExpires = otpExpiresAt();
  await doctor.save();

  const tpl = otpEmailTemplate({
    heading: 'Your new verification code',
    intro: `Hi ${doctor.name}, here is a fresh code to verify your VidhyaCare doctor account.`,
    otp,
    expiresInMinutes: env.OTP_EXPIRES_IN_MINUTES,
  });
  try {
    await sendEmail({ to: doctor.email, subject: 'Your VidhyaCare verification code', text: tpl.text, html: tpl.html });
  } catch (err) {
    logger.error({ err, email: doctor.email }, 'Doctor resend verification: email failed');
  }

  res.status(200).json({ success: true, message: 'If the account exists, a new code was sent' });
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body ?? {};
  if (!email) throw new BadRequestError('email is required');

  const doctor = await Doctor.findOne({ email: String(email).toLowerCase() })
    .select('+passwordResetTokenHash +passwordResetExpires')
    .exec();
  if (!doctor) {
    // Avoid leaking emails
    res.status(200).json({ success: true, message: 'If the email exists, a reset code was sent' });
    return;
  }

  const { token, tokenHash } = generateRandomToken();
  doctor.passwordResetTokenHash = tokenHash;
  doctor.passwordResetExpires = new Date(Date.now() + 1000 * 60 * 15); // 15 minutes
  await doctor.save();

  await sendEmail({
    to: doctor.email,
    subject: 'Doctor password reset',
    text: `Your password reset code: ${token}`,
  });

  res.status(200).json({ success: true, message: 'If the email exists, a reset code was sent' });
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  const { email, code, newPassword } = req.body ?? {};
  if (!email || !code || !newPassword) {
    throw new BadRequestError('email, code, and newPassword are required');
  }

  const tokenHash = crypto.createHash('sha256').update(String(code)).digest('hex');
  const doctor = await Doctor.findOne({
    email: String(email).toLowerCase(),
    passwordResetTokenHash: tokenHash,
    passwordResetExpires: { $gt: new Date() },
  })
    .select('+passwordResetTokenHash +passwordResetExpires')
    .exec();

  if (!doctor) throw new BadRequestError('Invalid or expired reset code');

  doctor.password = String(newPassword);
  doctor.passwordResetTokenHash = undefined;
  doctor.passwordResetExpires = undefined;
  await doctor.save();

  res.status(200).json({ success: true, message: 'Password reset successful' });
};

