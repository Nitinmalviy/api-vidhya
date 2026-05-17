import nodemailer from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export const isEmailConfigured = (): boolean =>
  Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS);

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  if (!isEmailConfigured()) {
    logger.warn({ to: params.to, subject: params.subject, text: params.text }, 'SMTP not configured');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from: env.SMTP_FROM ?? env.SMTP_USER,
    to: params.to,
    subject: params.subject,
    text: params.text,
  });
}

