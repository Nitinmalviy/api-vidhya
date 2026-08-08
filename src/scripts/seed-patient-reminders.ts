/**
 * Seed a demo patient + medicine reminders (with some doses already marked
 * taken) so the Medicine Reminders UI has real data to look at.
 * Usage:  npx tsx src/scripts/seed-patient-reminders.ts
 */

import 'dotenv/config';
import dns from 'dns';
import mongoose from 'mongoose';
import { Patient } from '../models/Patient';
import { MedicineReminder } from '../models/MedicineReminder';
import { MedicineDoseLog } from '../models/MedicineDoseLog';
import { env } from '../config/env';

// Same DNS override as src/app.ts — the sandbox's default resolver can't
// do the SRV lookup Atlas connection strings need.
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']);

const PATIENT_EMAIL = 'nitinmalviya172@gmail.com';
const PATIENT_PASSWORD = 'Nitin@123';
const PATIENT_NAME = 'Nitin Malviya';
const PATIENT_PHONE = '9876543210';

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('✅ MongoDB connected');

  let patient = await Patient.findOne({ email: PATIENT_EMAIL });
  if (!patient) {
    patient = await Patient.create({
      name: PATIENT_NAME,
      email: PATIENT_EMAIL,
      password: PATIENT_PASSWORD,
      phone: PATIENT_PHONE,
      plan: 'FREE',
      isEmailVerified: true,
    });
    console.log(`🎉 Patient created: ${PATIENT_EMAIL} / ${PATIENT_PASSWORD}`);
  } else {
    console.log(`ℹ️  Patient already exists: ${PATIENT_EMAIL}`);
  }

  // Clean slate for repeatable seeding.
  await MedicineReminder.deleteMany({ patientId: patient._id });
  await MedicineDoseLog.deleteMany({ patientId: patient._id });

  const reminders = await MedicineReminder.insertMany([
    {
      patientId: patient._id,
      medicineName: 'Metformin',
      dosage: '500mg · 1 tablet',
      times: ['08:00', '20:00'],
      daysOfWeek: [],
      startDate: isoDaysFromNow(-5),
      notes: 'Take after food',
      active: true,
    },
    {
      patientId: patient._id,
      medicineName: 'Vitamin D3',
      dosage: '1 tablet',
      times: ['09:00'],
      daysOfWeek: [],
      startDate: isoDaysFromNow(-10),
      endDate: isoDaysFromNow(1), // ends tomorrow → triggers "ending soon"
      active: true,
    },
    {
      patientId: patient._id,
      medicineName: 'Amoxicillin',
      dosage: '250mg capsule',
      times: ['08:00', '14:00', '20:00'],
      daysOfWeek: [],
      startDate: isoDaysFromNow(-2),
      endDate: isoDaysFromNow(5),
      notes: '5-day antibiotic course — complete the full course',
      active: true,
    },
    {
      patientId: patient._id,
      medicineName: 'Calcium + D3',
      dosage: '1 tablet',
      times: ['21:00'],
      daysOfWeek: [],
      startDate: isoDaysFromNow(-3),
      active: false, // paused
    },
  ]);

  const [metformin, , amoxicillin] = reminders;

  // Mark a few past doses as taken so the tracker shows filled slots.
  const doseLogs: { patientId: any; reminderId: any; date: string; time: string }[] = [];
  for (const daysAgo of [4, 3, 2, 1]) {
    doseLogs.push({ patientId: patient._id, reminderId: metformin._id, date: isoDaysFromNow(-daysAgo), time: '08:00' });
    doseLogs.push({ patientId: patient._id, reminderId: metformin._id, date: isoDaysFromNow(-daysAgo), time: '20:00' });
  }
  for (const daysAgo of [2, 1]) {
    doseLogs.push({ patientId: patient._id, reminderId: amoxicillin._id, date: isoDaysFromNow(-daysAgo), time: '08:00' });
    doseLogs.push({ patientId: patient._id, reminderId: amoxicillin._id, date: isoDaysFromNow(-daysAgo), time: '14:00' });
  }
  // Today's morning dose too, so "today" isn't empty.
  doseLogs.push({ patientId: patient._id, reminderId: metformin._id, date: isoDaysFromNow(0), time: '08:00' });

  await MedicineDoseLog.insertMany(doseLogs);

  console.log(`🎉 Seeded ${reminders.length} reminders and ${doseLogs.length} taken doses.`);
  console.log(`   Login    : ${PATIENT_EMAIL}`);
  console.log(`   Password : ${PATIENT_PASSWORD} (only used if the account was just created)`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
