/**
 * Test SMTP configuration by sending a real OTP email.
 * Usage:  npm run test:email -- you@example.com
 */

import 'dotenv/config';
import { sendEmail, otpEmailTemplate, isEmailConfigured } from '../services/email';
import { env } from '../config/env';

async function run() {
  const to = process.argv[2] ?? env.SMTP_USER;

  console.log('SMTP configured:', isEmailConfigured());
  console.log('  Host:', env.SMTP_HOST);
  console.log('  Port:', env.SMTP_PORT);
  console.log('  User:', env.SMTP_USER);
  console.log('  Pass:', env.SMTP_PASS ? '***set***' : '!! MISSING !!');
  console.log('  From:', env.SMTP_FROM ?? env.SMTP_USER);
  console.log('  Sending test email to:', to, '\n');

  if (!isEmailConfigured()) {
    console.error('❌ SMTP not configured. Check SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env');
    process.exit(1);
  }

  const tpl = otpEmailTemplate({
    heading: 'Test OTP Email',
    intro: 'This is a test email from Vidhya.care to confirm SMTP works.',
    otp: '123456',
    expiresInMinutes: 5,
  });

  await sendEmail({
    to: String(to),
    subject: 'Vidhya.care — SMTP Test',
    text: tpl.text,
    html: tpl.html,
  });

  console.log('\n✅ Test email sent successfully! Check the inbox (and spam folder).');
  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ Failed to send test email:', err.message);
  process.exit(1);
});
