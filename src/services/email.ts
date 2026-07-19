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
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
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
      attachments: params.attachments,
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

  const text = `${heading}\n\n${intro}\n\nYour OTP: ${otp}\n\nThis code expires in ${expiresInMinutes} minutes.\n\nIf you did not request this, please ignore this email.\n\n— VidhyaCare`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:48px;height:48px;line-height:48px;border-radius:12px;background:#2563eb;color:#fff;font-size:24px;font-weight:800;">V</div>
      <h1 style="margin:12px 0 0;font-size:20px;color:#0f172a;">Vidhya<span style="color:#2563eb;">Care</span></h1>
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
      If you did not request this, you can safely ignore this email.<br/>© ${new Date().getFullYear()} VidhyaCare
    </p>
  </div>`;

  return { text, html };
}

/**
 * Branded info/status email template (KYC received / approved / rejected, etc.)
 */
export function infoEmailTemplate(opts: {
  heading: string;
  body: string;
  accent?: 'blue' | 'green' | 'red' | 'amber';
  note?: string;
}): { text: string; html: string } {
  const { heading, body, accent = 'blue', note } = opts;

  const colors: Record<string, string> = {
    blue: '#2563eb',
    green: '#059669',
    red: '#dc2626',
    amber: '#d97706',
  };
  const c = colors[accent];

  const text = `${heading}\n\n${body}${note ? `\n\n${note}` : ''}\n\n— VidhyaCare`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:48px;height:48px;line-height:48px;border-radius:12px;background:#2563eb;color:#fff;font-size:24px;font-weight:800;">V</div>
      <h1 style="margin:12px 0 0;font-size:20px;color:#0f172a;">Vidhya<span style="color:#2563eb;">Care</span></h1>
    </div>
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0;border-top:4px solid ${c};">
      <h2 style="margin:0 0 12px;font-size:18px;color:#0f172a;">${heading}</h2>
      <p style="margin:0;font-size:14px;color:#475569;line-height:1.7;">${body}</p>
      ${note ? `<div style="margin-top:18px;padding:12px 16px;background:#f1f5f9;border-radius:10px;font-size:13px;color:#64748b;line-height:1.6;">${note}</div>` : ''}
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">
      © ${new Date().getFullYear()} VidhyaCare
    </p>
  </div>`;

  return { text, html };
}

/** Renders a small label/value detail table used inside transactional emails. */
function detailRows(rows: { label: string; value: string }[]): string {
  return rows
    .map(
      (r) =>
        `<tr>
          <td style="padding:8px 0;font-size:13px;color:#64748b;">${r.label}</td>
          <td style="padding:8px 0;font-size:13px;color:#0f172a;font-weight:600;text-align:right;">${r.value}</td>
        </tr>`
    )
    .join('');
}

/**
 * Appointment booking confirmation email (sent to both patient and doctor).
 * `audience` tweaks the greeting/intro so each party gets relevant copy.
 */
export function appointmentEmailTemplate(opts: {
  audience: 'patient' | 'doctor';
  doctorName: string;
  patientName: string;
  date: string;
  timeSlot: string;
  amount: number;
  bookingId: string;
}): { subject: string; text: string; html: string } {
  const { audience, doctorName, patientName, date, timeSlot, amount, bookingId } = opts;

  const heading = audience === 'patient' ? 'Appointment Confirmed' : 'New Appointment Booked';
  const intro =
    audience === 'patient'
      ? `Your consultation with ${doctorName} is confirmed. Details are below.`
      : `${patientName} has booked a consultation with you. Details are below.`;

  const rows = [
    { label: 'Doctor', value: doctorName },
    { label: 'Patient', value: patientName },
    { label: 'Date', value: date },
    { label: 'Time', value: timeSlot },
    { label: 'Amount', value: `Rs. ${amount}` },
    { label: 'Booking ID', value: bookingId },
  ];

  const text = `${heading}\n\n${intro}\n\nDoctor: ${doctorName}\nPatient: ${patientName}\nDate: ${date}\nTime: ${timeSlot}\nAmount: Rs. ${amount}\nBooking ID: ${bookingId}\n\n— VidhyaCare`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:48px;height:48px;line-height:48px;border-radius:12px;background:#2563eb;color:#fff;font-size:24px;font-weight:800;">V</div>
      <h1 style="margin:12px 0 0;font-size:20px;color:#0f172a;">Vidhya<span style="color:#2563eb;">Care</span></h1>
    </div>
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0;border-top:4px solid #2563eb;">
      <h2 style="margin:0 0 8px;font-size:18px;color:#0f172a;">${heading}</h2>
      <p style="margin:0 0 18px;font-size:14px;color:#475569;line-height:1.7;">${intro}</p>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;">${detailRows(rows)}</table>
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">
      © ${new Date().getFullYear()} VidhyaCare
    </p>
  </div>`;

  return { subject: `${heading} · ${date} ${timeSlot}`, text, html };
}

/**
 * Subscription receipt email — sent after a successful plan payment.
 */
export function subscriptionReceiptEmailTemplate(opts: {
  patientName: string;
  planName: string;
  amount: number;
  invoiceNo: string;
  startsOn: string;
  expiresOn: string;
}): { subject: string; text: string; html: string } {
  const { patientName, planName, amount, invoiceNo, startsOn, expiresOn } = opts;

  const rows = [
    { label: 'Plan', value: `${planName} (1 month)` },
    { label: 'Amount paid', value: `Rs. ${amount}` },
    { label: 'Valid from', value: startsOn },
    { label: 'Valid until', value: expiresOn },
    { label: 'Receipt No.', value: invoiceNo },
  ];

  const text = `Payment Received\n\nHi ${patientName}, thank you for subscribing to VidhyaCare ${planName}.\n\nPlan: ${planName} (1 month)\nAmount paid: Rs. ${amount}\nValid from: ${startsOn}\nValid until: ${expiresOn}\nReceipt No.: ${invoiceNo}\n\n— VidhyaCare`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:16px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:48px;height:48px;line-height:48px;border-radius:12px;background:#2563eb;color:#fff;font-size:24px;font-weight:800;">V</div>
      <h1 style="margin:12px 0 0;font-size:20px;color:#0f172a;">Vidhya<span style="color:#2563eb;">Care</span></h1>
    </div>
    <div style="background:#fff;border-radius:12px;padding:28px;border:1px solid #e2e8f0;border-top:4px solid #059669;">
      <h2 style="margin:0 0 8px;font-size:18px;color:#0f172a;">Payment Received</h2>
      <p style="margin:0 0 18px;font-size:14px;color:#475569;line-height:1.7;">Hi ${patientName}, thank you for subscribing to VidhyaCare <strong>${planName}</strong>. Your premium features are now active.</p>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;">${detailRows(rows)}</table>
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;text-align:center;line-height:1.6;">
      A tax receipt is attached / downloadable in the app.<br/>© ${new Date().getFullYear()} VidhyaCare
    </p>
  </div>`;

  return { subject: `Your VidhyaCare ${planName} receipt — ${invoiceNo}`, text, html };
}
