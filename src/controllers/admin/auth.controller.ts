import type { Request, Response } from 'express';
import crypto from 'crypto';
import { Admin } from '../../models/Admin';
import { ConflictError, BadRequestError, UnauthorizedError, ForbiddenError } from '../../utils/AppError';
import { signAccessToken, signRefreshToken } from '../../utils/jwt';
import { generateRandomToken } from '../../utils/tokens';
import { sendEmail } from '../../services/email';

export const register = async (req: Request, res: Response): Promise<void> => {
  const { name, email, password, role, permissions } = req.body ?? {};
  if (!name || !email || !password) throw new BadRequestError('name, email, password are required');

  const existing = await Admin.findOne({ email: String(email).toLowerCase() }).lean().exec();
  if (existing) throw new ConflictError('Admin already exists');

  const { token, tokenHash } = generateRandomToken();
  const expires = new Date(Date.now() + 1000 * 60 * 30); // 30 minutes

  const admin = await Admin.create({
    name,
    email,
    password,
    role: role ?? 'MODERATOR',
    permissions: Array.isArray(permissions) ? permissions : [],
    isEmailVerified: false,
    emailVerificationTokenHash: tokenHash,
    emailVerificationExpires: expires,
  });

  await sendEmail({
    to: admin.email,
    subject: 'Verify your admin email',
    text: `Your verification code: ${token}`,
  });

  res.status(201).json({
    success: true,
    message: 'Admin registered. Please verify email.',
    data: { id: admin._id, email: admin.email, isEmailVerified: admin.isEmailVerified },
  });
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body ?? {};
  if (!email || !password) throw new BadRequestError('email and password are required');

  const admin = await Admin.findOne({ email: String(email).toLowerCase() }).select('+password').exec();
  if (!admin) throw new UnauthorizedError('Invalid credentials');

  const ok = await admin.comparePassword(String(password));
  if (!ok) throw new UnauthorizedError('Invalid credentials');

  if (!admin.isEmailVerified) throw new ForbiddenError('Email not verified');

  const accessToken = signAccessToken({ id: String(admin._id), role: 'admin' });
  const refreshToken = signRefreshToken({ id: String(admin._id), role: 'admin' });

  res.status(200).json({
    success: true,
    message: 'Admin login successful',
    data: {
      user: { id: admin._id, email: admin.email, role: 'admin' },
      tokens: { accessToken, refreshToken },
    },
  });
};

export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  const { email, code } = req.body ?? {};
  if (!email || !code) throw new BadRequestError('email and code are required');

  const tokenHash = crypto.createHash('sha256').update(String(code)).digest('hex');
  const admin = await Admin.findOne({
    email: String(email).toLowerCase(),
    emailVerificationTokenHash: tokenHash,
    emailVerificationExpires: { $gt: new Date() },
  })
    .select('+emailVerificationTokenHash +emailVerificationExpires')
    .exec();

  if (!admin) throw new BadRequestError('Invalid or expired verification code');

  admin.isEmailVerified = true;
  admin.emailVerificationTokenHash = undefined;
  admin.emailVerificationExpires = undefined;
  await admin.save();

  res.status(200).json({ success: true, message: 'Email verified' });
};

export const resendVerification = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body ?? {};
  if (!email) throw new BadRequestError('email is required');

  const admin = await Admin.findOne({ email: String(email).toLowerCase() })
    .select('+emailVerificationTokenHash +emailVerificationExpires')
    .exec();
  if (!admin) throw new BadRequestError('Invalid email');
  if (admin.isEmailVerified) throw new BadRequestError('Email already verified');

  const { token, tokenHash } = generateRandomToken();
  admin.emailVerificationTokenHash = tokenHash;
  admin.emailVerificationExpires = new Date(Date.now() + 1000 * 60 * 30);
  await admin.save();

  await sendEmail({
    to: admin.email,
    subject: 'Verify your admin email',
    text: `Your verification code: ${token}`,
  });

  res.status(200).json({ success: true, message: 'Verification email sent' });
};

