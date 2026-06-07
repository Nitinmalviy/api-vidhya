/**
 * Seed 20 mock patients with full details.
 * Usage:  npm run seed:patients
 * Idempotent — skips emails that already exist.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { Patient } from '../models/Patient';
import { env } from '../config/env';

const PATIENTS = [
  { name: 'Aarav Sharma',    email: 'aarav.sharma@yopmail.com',    phone: '+919876543201', plan: 'FREE',    bloodGroup: 'A+' },
  { name: 'Ananya Singh',    email: 'ananya.singh@yopmail.com',    phone: '+919876543202', plan: 'PREMIUM', bloodGroup: 'B+' },
  { name: 'Rohan Mehta',     email: 'rohan.mehta@yopmail.com',     phone: '+919876543203', plan: 'FREE',    bloodGroup: 'O+' },
  { name: 'Priya Nair',      email: 'priya.nair@yopmail.com',      phone: '+919876543204', plan: 'PREMIUM', bloodGroup: 'AB+' },
  { name: 'Karan Kapoor',    email: 'karan.kapoor@yopmail.com',    phone: '+919876543205', plan: 'FREE',    bloodGroup: 'A-' },
  { name: 'Sneha Reddy',     email: 'sneha.reddy@yopmail.com',     phone: '+919876543206', plan: 'PREMIUM', bloodGroup: 'B-' },
  { name: 'Vikram Bose',     email: 'vikram.bose.p@yopmail.com',   phone: '+919876543207', plan: 'FREE',    bloodGroup: 'O-' },
  { name: 'Divya Menon',     email: 'divya.menon@yopmail.com',     phone: '+919876543208', plan: 'PREMIUM', bloodGroup: 'AB-' },
  { name: 'Arjun Joshi',     email: 'arjun.joshi@yopmail.com',     phone: '+919876543209', plan: 'FREE',    bloodGroup: 'A+' },
  { name: 'Pooja Iyer',      email: 'pooja.iyer@yopmail.com',      phone: '+919876543210', plan: 'FREE',    bloodGroup: 'B+' },
  { name: 'Rahul Gupta',     email: 'rahul.gupta@yopmail.com',     phone: '+919876543211', plan: 'PREMIUM', bloodGroup: 'O+' },
  { name: 'Meena Verma',     email: 'meena.verma@yopmail.com',     phone: '+919876543212', plan: 'FREE',    bloodGroup: 'A+' },
  { name: 'Aditya Kumar',    email: 'aditya.kumar@yopmail.com',    phone: '+919876543213', plan: 'PREMIUM', bloodGroup: 'AB+' },
  { name: 'Kavya Pillai',    email: 'kavya.pillai@yopmail.com',    phone: '+919876543214', plan: 'FREE',    bloodGroup: 'B+' },
  { name: 'Nikhil Desai',    email: 'nikhil.desai@yopmail.com',    phone: '+919876543215', plan: 'PREMIUM', bloodGroup: 'O+' },
  { name: 'Shruti Jain',     email: 'shruti.jain@yopmail.com',     phone: '+919876543216', plan: 'FREE',    bloodGroup: 'A-' },
  { name: 'Suresh Patel',    email: 'suresh.patel@yopmail.com',    phone: '+919876543217', plan: 'FREE',    bloodGroup: 'B-' },
  { name: 'Anjali Chaudhary',email: 'anjali.chaudhary@yopmail.com',phone: '+919876543218', plan: 'PREMIUM', bloodGroup: 'O-' },
  { name: 'Rohit Tiwari',    email: 'rohit.tiwari@yopmail.com',    phone: '+919876543219', plan: 'FREE',    bloodGroup: 'AB+' },
  { name: 'Nisha Malhotra',  email: 'nisha.malhotra@yopmail.com',  phone: '+919876543220', plan: 'PREMIUM', bloodGroup: 'A+' },
] as const;

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('MongoDB connected\n');

  let seeded = 0;
  let skipped = 0;

  for (const p of PATIENTS) {
    const exists = await Patient.findOne({ email: p.email }).lean();
    if (exists) {
      console.log(`  Skipped : ${p.name} (already exists)`);
      skipped++;
      continue;
    }

    await Patient.create({
      name: p.name,
      email: p.email,
      phone: p.phone,
      password: 'Patient@123',
      plan: p.plan,
      bloodGroup: p.bloodGroup,
      isEmailVerified: true,
    });

    console.log(`  Seeded  : ${p.name} [${p.plan}] — Blood: ${p.bloodGroup}`);
    seeded++;
  }

  console.log(`\nDone. Seeded: ${seeded}, Skipped: ${skipped}`);
  console.log('Default password for all patients: Patient@123');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
