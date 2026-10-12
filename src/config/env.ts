import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(5000),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  MONGO_URI: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  OTP_EXPIRES_IN_MINUTES: z.coerce.number().default(5),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  /** Which SMS gateway sends OTPs. Auto-picks whichever has credentials when unset. */
  SMS_PROVIDER: z.enum(['msg91', 'twilio']).optional(),
  /** MSG91 (DLT-registered OTP template; the template must contain the ##otp## variable). */
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  MSG91_OTP_VAR: z.string().default('otp'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_S3_BUCKET_NAME: z.string().optional(),
  // Razorpay. `Test_Key_*` are the older names still present in .env; either works.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  Test_Key_ID: z.string().optional(),
  Test_Key_Secret: z.string().optional(),
  /** Secret configured on the Razorpay webhook — required to trust auto-debit events. */
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  /** Razorpay plan ids for UPI Autopay mandates (create once via `npm run razorpay:plans`). */
  RAZORPAY_PLAN_SINGLE: z.string().optional(),
  RAZORPAY_PLAN_FAMILY: z.string().optional(),
  /** RazorpayX business account number that doctor withdrawals are paid out from. */
  RAZORPAYX_ACCOUNT_NUMBER: z.string().optional(),
  /** Secret on the RazorpayX (payouts) webhook, if it differs from RAZORPAY_WEBHOOK_SECRET. */
  RAZORPAYX_WEBHOOK_SECRET: z.string().optional(),
  // Legal identity on receipts/invoices. GSTIN is printed only when set.
  COMPANY_LEGAL_NAME: z.string().optional(),
  COMPANY_GSTIN: z
    .string()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'COMPANY_GSTIN is not a valid GSTIN')
    .optional(),
  COMPANY_ADDRESS: z.string().optional(),
  // LiveKit — powers the 1:1 Live-OPD video calls.
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;