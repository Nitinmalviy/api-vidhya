/**
 * Put one doctor on a permanent 24/7 Live-OPD desk, for testing the patient
 * "connect me to a doctor" flow without waiting on the admin approval step.
 *
 *   npm run seed:opd                      # defaults to DOCTOR_EMAIL below
 *   npm run seed:opd -- doc@example.com   # or name one explicitly
 *
 * What it does:
 *   · approves opdAccess with a 24h/day budget
 *   · cancels any older desk so there's exactly one live session
 *   · opens a LIVE 00:00–23:59 session for today
 *
 * Re-run it the next day (or whenever) — it is idempotent.
 */

import 'dotenv/config';
import dns from 'dns';
import mongoose from 'mongoose';
import { Doctor } from '../models/Doctor';
import { OpdConsultation } from '../models/OpdConsultation';
import { OpdSession } from '../models/OpdSession';
import { env } from '../config/env';

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']);

const DOCTOR_EMAIL = process.argv[2] ?? 'pubghot999@gmail.com';

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('✅ MongoDB connected');

  const doctor = await Doctor.findOne({ email: DOCTOR_EMAIL.toLowerCase() });
  if (!doctor) throw new Error(`No doctor with email ${DOCTOR_EMAIL}`);

  if (doctor.kycStatus !== 'APPROVED') {
    doctor.kycStatus = 'APPROVED';
    console.log('   · KYC forced to APPROVED (required for Live-OPD)');
  }

  doctor.opdAccess = {
    ...(doctor.opdAccess ?? {}),
    status: 'APPROVED',
    requestedHoursPerDay: doctor.opdAccess?.requestedHoursPerDay ?? 24,
    approvedHoursPerDay: 24,
    preferredWindow: '24/7 (test doctor)',
    reviewedAt: new Date(),
    adminNote: 'Seeded for testing — available round the clock.',
  };
  await doctor.save();
  console.log(`✅ ${doctor.name} <${doctor.email}> approved for 24h/day of Live-OPD`);

  const today = new Date().toISOString().slice(0, 10);

  // Exactly one live desk: close anything else this doctor has open.
  const closed = await OpdSession.updateMany(
    { doctorId: doctor._id, status: { $in: ['LIVE', 'SCHEDULED'] }, date: { $ne: today } },
    { $set: { status: 'COMPLETED', endedAt: new Date() } }
  );
  if (closed.modifiedCount) console.log(`   · closed ${closed.modifiedCount} stale session(s)`);

  const existing = await OpdSession.findOne({ doctorId: doctor._id, date: today });
  let session;
  if (existing) {
    existing.startTime = '00:00';
    existing.endTime = '23:59';
    existing.status = 'LIVE';
    existing.startedAt = existing.startedAt ?? new Date();
    existing.endedAt = null;
    existing.notes = '24/7 test desk';
    await existing.save();
    session = existing;
    console.log("   · reused today's session and set it LIVE");
  } else {
    session = await OpdSession.create({
      doctorId: doctor._id,
      date: today,
      startTime: '00:00',
      endTime: '23:59',
      status: 'LIVE',
      startedAt: new Date(),
      notes: '24/7 test desk',
    });
    console.log('   · created a LIVE 00:00–23:59 session');
  }

  // Clear leftover rings so the desk starts idle.
  const cleared = await OpdConsultation.updateMany(
    { doctorId: doctor._id, status: { $in: ['WAITING', 'RINGING', 'IN_CALL'] } },
    { $set: { status: 'CANCELLED', endedAt: new Date() } }
  );
  if (cleared.modifiedCount) console.log(`   · cleared ${cleared.modifiedCount} stale consultation(s)`);

  console.log('\n🎉 Ready. Session id:', String(session._id));
  console.log('   Patient app → Live OPD → "Talk to a doctor now" should now reach this doctor.');
  console.log('   Doctor app  → Live OPD → the incoming call appears with a 2-minute countdown.');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
