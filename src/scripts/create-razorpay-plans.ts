/**
 * Create the two monthly Razorpay plans that UPI Autopay mandates are built on.
 *
 * Run once per Razorpay account (once for test keys, once for live keys):
 *   npm run razorpay:plans
 *
 * Copy the printed ids into .env as RAZORPAY_PLAN_SINGLE / RAZORPAY_PLAN_FAMILY.
 * Razorpay plans are immutable — to change a price, create a new plan and point
 * the env var at it. Existing mandates keep charging the old plan until the user
 * re-authorises, which is exactly the behaviour the regulator expects.
 */

import 'dotenv/config';
import dns from 'dns';
import { isRazorpayConfigured, razorpay, PLAN_PRICES, PLAN_NAMES } from '../config/razorpay';

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']);

async function run() {
  if (!isRazorpayConfigured()) {
    throw new Error('Razorpay keys are missing — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env');
  }

  for (const planId of ['single', 'family'] as const) {
    const plan = await razorpay.plans.create({
      period: 'monthly',
      interval: 1,
      item: {
        name: `VidhyaCare ${PLAN_NAMES[planId]} plan`,
        amount: PLAN_PRICES[planId] * 100, // paise
        currency: 'INR',
        description:
          planId === 'single'
            ? 'Monthly VidhyaCare Single membership — Live-OPD, My Locker and more.'
            : 'Monthly VidhyaCare Family membership — covers 5 people.',
      },
      notes: { appPlanId: planId },
    });

    const envKey = planId === 'single' ? 'RAZORPAY_PLAN_SINGLE' : 'RAZORPAY_PLAN_FAMILY';
    console.log(`${envKey}=${plan.id}   (₹${PLAN_PRICES[planId]}/month)`);
  }

  console.log('\n✅ Plans created. Paste the two lines above into your .env and restart the API.');
}

run().catch((err) => {
  console.error('❌ Failed to create plans:', err?.error?.description ?? err.message);
  process.exit(1);
});
