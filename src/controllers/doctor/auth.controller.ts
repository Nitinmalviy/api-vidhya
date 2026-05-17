import type { Request, Response } from 'express';
import crypto from 'crypto';
import { Doctor } from '../../models/Doctor';
import { Clinic } from '../../models/Clinic';
import { uploadBase64ToCloudinary } from '../../services/cloudinaryUpload';
import { sendEmail } from '../../services/email';
import { signAccessToken, signRefreshToken } from '../../utils/jwt';
import { generateRandomToken } from '../../utils/tokens';
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError } from '../../utils/AppError';

export const register = async (req: Request, res: Response): Promise<void> => {
  const {
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

  if (!email || !password || !phone || !workType) {
    throw new BadRequestError('email, password, phone, and workType are required');
  }

  const existing = await Doctor.findOne({ email }).lean().exec();
  if (existing) throw new ConflictError('Doctor already exists');

  const { token, tokenHash } = generateRandomToken();
  const emailVerificationExpires = new Date(Date.now() + 1000 * 60 * 30);

  const [degreeUrl, licenseUrl, clinicPhotoUrl] = await Promise.all([
    degreeFile ? uploadBase64ToCloudinary(degreeFile, 'doctor-kyc') : Promise.resolve(undefined),
    licenseFile ? uploadBase64ToCloudinary(licenseFile, 'doctor-kyc') : Promise.resolve(undefined),
    clinicPhotoFile ? uploadBase64ToCloudinary(clinicPhotoFile, 'clinic') : Promise.resolve(undefined),
  ]);

  const doctor = await Doctor.create({
    email,
    password,
    phone,
    workType,
    clinicId: clinicId || undefined,
    specializations: Array.isArray(specializations) ? specializations : [],
    kycStatus: 'PENDING',
    isEmailVerified: false,
    emailVerificationTokenHash: tokenHash,
    emailVerificationExpires,
    degreeDetails:
      degreeName && university && passingYear && degreeUrl
        ? { degreeName, university, passingYear: Number(passingYear), documentUrl: degreeUrl }
        : undefined,
    licenseDetails:
      licenseNumber && expiryDate && licenseUrl
        ? { licenseNumber, expiryDate: new Date(expiryDate), documentUrl: licenseUrl }
        : undefined,
  });

  if (workType === 'OWN_CLINIC') {
    const clinic = await Clinic.create({
      name: clinicName,
      photoUrl: clinicPhotoUrl,
      doctorId: doctor._id,
      isVerified: false,
    });

    doctor.clinicId = clinic._id;
    await doctor.save();
  } else if (workType === 'EMPLOYEE' && !clinicId) {
    throw new BadRequestError('clinicId is required when workType is EMPLOYEE');
  } else if (workType !== 'OWN_CLINIC' && workType !== 'EMPLOYEE') {
    throw new BadRequestError("workType must be 'OWN_CLINIC' or 'EMPLOYEE'");
  }

  await sendEmail({
    to: doctor.email,
    subject: 'Verify your doctor email',
    text: `Your verification code: ${token}`,
  });

  res.status(201).json({
    success: true,
    message: 'Doctor registered. Verify email and wait for KYC approval.',
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

