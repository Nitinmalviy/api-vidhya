import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export const isEmailConfigured = (): boolean =>
  Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS);

// Reuse a single transporter across requests
let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465, // true for 465, false for 587 (STARTTLS)
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });
  return transporter;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  if (!isEmailConfigured()) {
    logger.warn(
      { to: params.to, subject: params.subject, text: params.text },
      'SMTP not configured — email skipped (see logged OTP/text above)'
    );
    return;
  }

  try {
    const info = await getTransporter().sendMail({
      from: env.SMTP_FROM ?? env.SMTP_USER,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    });
    logger.info({ to: params.to, messageId: info.messageId, subject: params.subject }, 'Email sent');
  } catch (err) {
    logger.error({ err, to: params.to, subject: params.subject }, 'Failed to send email');
    throw err;
  }
}

/**
 * Branded OTP email template.
 */
export function otpEmailTemplate(opts: {
  heading: string;
  intro: string;
  otp: string;
  expiresInMinutes: number;
}): { text: string; html: string } {
  const { heading, intro, otp, expiresInMinutes } = opts;

  const text = `${heading}\n\n${intro}\n\nYour OTP: ${otp}\n\nThis code expires in ${expiresInMinutes} minutes.\n\nIf you did not request this, please ignore this email.\n\n— Vidhya.care`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:48px;height:48px;line-height:48px;border-radius:12px;background:#2563eb;color:#fff;font-size:24px;font-weight:800;">V</div>
      <h1 style="margin:12px 0 0;font-size:20px;color:#0f172a;">Vidhya<span style="color:#2563eb;">.care</span></h1>
    </div>
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0;">
      <h2 style="margin:0 0 8px;font-size:18px;color:#0f172a;">${heading}</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">${intro}</p>
      <div style="text-align:center;margin:0 0 24px;">
        <div style="display:inline-block;font-size:34px;font-weight:800;letter-spacing:8px;color:#2563eb;background:#eff6ff;padding:14px 24px;border-radius:12px;">${otp}</div>
      </div>
      <p style="margin:0;font-size:13px;color:#94a3b8;text-align:center;">This code expires in <strong>${expiresInMinutes} minutes</strong>.</p>
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">
      If you did not request this, you can safely ignore this email.<br/>© ${new Date().getFullYear()} Vidhya.care
    </p>
  </div>`;

  return { text, html };
}
