/**
 * Seed a Single-plan subscription (plus a paid SUBSCRIPTION receipt and an
 * APPOINTMENT invoice) for the demo patient, so the Subscription and
 * Billing pages both have real data — and the upgrade path is exercisable.
 * Usage:  npm run seed:subscription
 */

import 'dotenv/config';
import dns from 'dns';
import mongoose from 'mongoose';
import { Patient } from '../models/Patient';
import { Transaction } from '../models/Transaction';
import { env } from '../config/env';

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']);

const PATIENT_EMAIL = 'nitinmalviya172@gmail.com';
const PLAN_DURATION_DAYS = 30;

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('✅ MongoDB connected');

  const patient = await Patient.findOne({ email: PATIENT_EMAIL });
  if (!patient) throw new Error(`Patient ${PATIENT_EMAIL} not found — run seed:reminders first.`);

  // Started 5 days ago so there are 25 days left on the cycle.
  const startedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const planExpiresAt = new Date(startedAt.getTime() + PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000);

  patient.plan = 'PREMIUM';
  patient.planId = 'single';
  patient.planExpiresAt = planExpiresAt;
  await patient.save();

  await Transaction.deleteMany({ patientId: patient._id });

  await Transaction.create({
    patientId: patient._id,
    amount: 149,
    currency: 'INR',
    type: 'SUBSCRIPTION',
    status: 'SUCCESS',
    razorpayOrderId: `order_seed_sub_${Date.now()}`,
    razorpayPaymentId: `pay_seed_sub_${Date.now()}`,
    metadata: { planId: 'single', planName: 'Single' },
    createdAt: startedAt,
  });

  await Transaction.create({
    patientId: patient._id,
    amount: 500,
    currency: 'INR',
    type: 'APPOINTMENT',
    status: 'SUCCESS',
    razorpayOrderId: `order_seed_appt_${Date.now()}`,
    razorpayPaymentId: `pay_seed_appt_${Date.now()}`,
    metadata: {},
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
  });

  console.log('🎉 Seeded: Single plan (PREMIUM), 1 subscription receipt, 1 appointment invoice.');
  console.log(`   Plan expires: ${planExpiresAt.toDateString()}`);
  console.log('   Upgrade to Family should now be offered on the Subscription page.');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
