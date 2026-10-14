import type { Request, Response } from 'express';
import { sanitizeSpecializations } from '../../utils/specializations';
import crypto from 'crypto';
import { Doctor } from '../../models/Doctor';
import { Clinic } from '../../models/Clinic';
import { deleteFromS3, uploadBase64ToS3Detailed, type S3Folder, type S3UploadResult } from '../../services/s3Upload';
import { sendEmail, sendCodeEmail, otpEmailTemplate } from '../../services/email';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { generateOtp, hashOtp, otpExpiresAt } from '../../utils/otp';
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError } from '../../utils/AppError';
import { assertValidEmail, assertStrongPassword, assertValidPhone } from '../../utils/validation';
import { createNotification } from '../../services/notification';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export const checkEmail = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;
  if (!email) {
    throw new BadRequestError('Email is required');
  }

  const existing = await Doctor.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    res.status(200).json({ success: true, exists: true });
    return;
  }
  
  res.status(200).json({ success: true, exists: false });
};

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
    identityProofFile,
    consultationFee,
    yearsExperience,
    gender,
  } = req.body ?? {};

  // ── Validate everything BEFORE creating records / uploading files ──
  if (!name || !email || !password || !phone || !workType) {
    throw new BadRequestError('name, email, password, phone, and workType are required');
  }
  if (workType !== 'OWN_CLINIC' && workType !== 'EMPLOYEE') {
    throw new BadRequestError("workType must be 'OWN_CLINIC' or 'EMPLOYEE'");
  }
  assertStrongPassword(password);
  assertValidPhone(phone);

  const normalizedEmail = assertValidEmail(email);
  const existing = await Doctor.findOne({ email: normalizedEmail }).lean().exec();
  if (existing) throw new ConflictError('An account with this email already exists');

  // 6-digit OTP for email verification
  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const emailVerificationExpires = otpExpiresAt();

  // Upload KYC files BEFORE creating any records. If a file was sent but
  // can't be stored (bad format, too large, S3 error), reject the whole
  // registration so we never create a doctor missing documents they submitted.
  const kycFiles: Array<{ file: unknown; folder: S3Folder; label: string }> = [
    { file: degreeFile, folder: 'doctor-kyc', label: 'degree certificate' },
    { file: licenseFile, folder: 'doctor-kyc', label: 'medical license' },
    { file: clinicPhotoFile, folder: 'clinic', label: 'clinic photo' },
    { file: identityProofFile, folder: 'doctor-kyc', label: 'ID proof' },
  ];
  const uploads: Array<S3UploadResult | undefined> = await Promise.all(
    kycFiles.map(({ file, folder }) => (file ? uploadBase64ToS3Detailed(file, folder) : Promise.resolve(undefined))),
  );

  const failedIndex = uploads.findIndex(
    (r) =>
      r !== undefined &&
      (!r.ok ||
        // S3 missing in production would silently drop the documents.
        (r.skipped === 'not_configured' && env.NODE_ENV === 'production')),
  );
  if (failedIndex !== -1) {
    // Don't leave orphaned files behind for the uploads that did succeed.
    await Promise.all(uploads.map((r) => (r?.ok && r.key ? deleteFromS3(r.key) : Promise.resolve())));
    const failed = uploads[failedIndex]!;
    const { label } = kycFiles[failedIndex];
    logger.warn(
      { email: normalizedEmail, document: label, reason: failed.ok ? 'not_configured' : failed.reason },
      'Doctor registration rejected: KYC document could not be saved',
    );
    const hint = failed.ok
      ? ''
      : failed.reason === 'too_large'
        ? ' The file is too large — please use a smaller photo or PDF.'
        : failed.reason === 'unsupported_type' || failed.reason === 'invalid_format'
          ? ' Please use a JPG or PNG photo, or a PDF.'
          : '';
    throw new BadRequestError(`We couldn't save your ${label} — please upload it again.${hint}`);
  }

  const [degreeUrl, licenseUrl, clinicPhotoUrl, identityProofUrl] = uploads.map((r) => (r?.ok ? r.key : undefined));

  const doctor = await Doctor.create({
    name: String(name).trim(),
    email: normalizedEmail,
    password,
    phone: String(phone).trim(),
    workType,
    clinicId: clinicId || undefined,
    specializations: sanitizeSpecializations(specializations),
    gender: gender === 'FEMALE' || gender === 'MALE' || gender === 'OTHER' ? gender : undefined,
    consultationFee: Number.isFinite(Number(consultationFee)) ? Math.max(0, Number(consultationFee)) : undefined,
    yearsExperience: Number.isFinite(Number(yearsExperience)) ? Math.max(0, Number(yearsExperience)) : undefined,
    kycStatus: 'PENDING',
    identityProofUrl,
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

  // New login = new session: invalidates tokens on any other device/browser.
  doctor.sessionVersion = (doctor.sessionVersion ?? 0) + 1;
  await doctor.save();

  const tokenPayload = { id: String(doctor._id), role: 'doctor' as const, sv: doctor.sessionVersion };
  const accessToken = signAccessToken(tokenPayload);
  const refreshToken = signRefreshToken(tokenPayload);

  res.status(200).json({
    success: true,
    message: 'Doctor login successful',
    data: {
      user: { id: doctor._id, email: doctor.email, role: 'doctor' },
      tokens: { accessToken, refreshToken },
    },
  });
};

/* POST /api/v1/doctor/auth/refresh  { refreshToken } */
export const refresh = async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) throw new BadRequestError('refreshToken is required');

  const payload = verifyRefreshToken(String(refreshToken));
  if (payload.role !== 'doctor') throw new UnauthorizedError('Invalid refresh token');

  const doctor = await Doctor.findById(payload.id).select('sessionVersion').lean();
  if (!doctor) throw new UnauthorizedError('Account no longer exists');
  // Tokens without a session version predate single-session support; make them sign in again
  // so they can't mint fresh tokens past a password change.
  if (payload.sv === undefined || (doctor.sessionVersion ?? 0) !== payload.sv) {
    throw new UnauthorizedError('Your session has ended. Please sign in again.');
  }

  const accessToken = signAccessToken({ id: payload.id, role: 'doctor', sv: payload.sv });

  res.status(200).json({ success: true, data: { accessToken } });
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
  await sendCodeEmail({ to: doctor.email, subject: 'Your VidhyaCare verification code', text: tpl.text, html: tpl.html });

  res.status(200).json({ success: true, message: 'If the account exists, a new code was sent' });
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body ?? {};
  if (!email) throw new BadRequestError('email is required');

  const doctor = await Doctor.findOne({ email: String(email).trim().toLowerCase() })
    .select('+passwordResetTokenHash +passwordResetExpires')
    .exec();
  if (!doctor) {
    // Avoid leaking emails
    res.status(200).json({ success: true, message: 'If the email exists, a reset code was sent' });
    return;
  }

  const otp = generateOtp();
  doctor.passwordResetTokenHash = hashOtp(otp); // sha256(otp) — matches reset-password
  doctor.passwordResetExpires = otpExpiresAt();
  await doctor.save();

  const tpl = otpEmailTemplate({
    heading: 'Reset your password',
    intro: `Hi ${doctor.name}, use the code below to reset your VidhyaCare doctor account password.`,
    otp,
    expiresInMinutes: env.OTP_EXPIRES_IN_MINUTES,
  });
  await sendCodeEmail({
    to: doctor.email,
    subject: 'Your VidhyaCare password reset code',
    text: tpl.text,
    html: tpl.html,
  });

  res.status(200).json({ success: true, message: 'If the email exists, a reset code was sent' });
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  const { email, code, newPassword } = req.body ?? {};
  if (!email || !code || !newPassword) {
    throw new BadRequestError('email, code, and newPassword are required');
  }

  const tokenHash = crypto.createHash('sha256').update(String(code).trim()).digest('hex');
  const doctor = await Doctor.findOne({
    email: String(email).trim().toLowerCase(),
    passwordResetTokenHash: tokenHash,
    passwordResetExpires: { $gt: new Date() },
  })
    .select('+passwordResetTokenHash +passwordResetExpires')
    .exec();

  if (!doctor) throw new BadRequestError('Invalid or expired reset code');

  assertStrongPassword(newPassword);
  doctor.password = String(newPassword);
  doctor.passwordResetTokenHash = undefined;
  doctor.passwordResetExpires = undefined;
  // Whoever knew the old password is signed out everywhere.
  doctor.sessionVersion = (doctor.sessionVersion ?? 0) + 1;
  await doctor.save();

  res.status(200).json({ success: true, message: 'Password reset successful' });
};

