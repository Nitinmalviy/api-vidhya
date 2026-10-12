import { env } from '../config/env';
import { logger } from '../utils/logger';
import { ServiceUnavailableError } from '../utils/AppError';

type Provider = 'msg91' | 'twilio';

function provider(): Provider | null {
  const msg91 = !!(env.MSG91_AUTH_KEY && env.MSG91_OTP_TEMPLATE_ID);
  const twilio = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_PHONE_NUMBER);
  if (env.SMS_PROVIDER === 'msg91') return msg91 ? 'msg91' : null;
  if (env.SMS_PROVIDER === 'twilio') return twilio ? 'twilio' : null;
  return msg91 ? 'msg91' : twilio ? 'twilio' : null;
}

/** Local machine only: codes are logged instead of texted. Never on Vercel, whatever NODE_ENV says. */
const localDev = () => env.NODE_ENV === 'development' && !process.env.VERCEL;

/** True when OTPs can actually reach a phone (or are logged on a local dev machine). */
export function smsEnabled(): boolean {
  return provider() !== null || localDev();
}

async function viaMsg91(e164: string, otp: string) {
  // Flow API with a DLT-approved template. MSG91 wants the number without "+".
  const res = await fetch('https://control.msg91.com/api/v5/flow', {
    method: 'POST',
    headers: { authkey: env.MSG91_AUTH_KEY!, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      template_id: env.MSG91_OTP_TEMPLATE_ID,
      short_url: '0',
      recipients: [{ mobiles: e164.replace(/^\+/, ''), [env.MSG91_OTP_VAR]: otp }],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
  if (!res.ok || body.type === 'error') throw new Error(`MSG91 ${res.status}: ${body.message ?? 'send failed'}`);
}

async function viaTwilio(e164: string, otp: string) {
  const sid = env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      To: e164,
      From: env.TWILIO_PHONE_NUMBER!,
      Body: `${otp} is your VidhyaCare verification code. It expires in ${env.OTP_EXPIRES_IN_MINUTES} minutes. Do not share it with anyone.`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(`Twilio ${res.status}: ${body.message ?? 'send failed'}`);
  }
}

/** Texts a one-time code. Throws ServiceUnavailableError if no gateway is set up or the gateway fails. */
export async function sendOtpSms(e164: string, otp: string): Promise<void> {
  const p = provider();
  if (!p) {
    if (localDev()) {
      logger.info({ phone: e164, otp }, 'DEV SMS OTP (no SMS gateway configured)');
      return;
    }
    throw new ServiceUnavailableError('Phone sign-in is not available right now. Please use email.');
  }
  try {
    await (p === 'msg91' ? viaMsg91(e164, otp) : viaTwilio(e164, otp));
  } catch (err) {
    // Log the last 4 digits only.
    logger.error({ err, provider: p, phone: `******${e164.slice(-4)}` }, 'SMS OTP send failed');
    throw new ServiceUnavailableError('We could not send the SMS. Please try again in a minute.');
  }
}
