/**
 * Seed diagnostic labs around Indore (VidhyaCare's HQ city) so the
 * "Labs near you" search has real, geolocated data to return.
 * Usage:  npm run seed:labs
 */

import 'dotenv/config';
import dns from 'dns';
import mongoose from 'mongoose';
import { Lab } from '../models/Lab';
import { env } from '../config/env';

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']);

const COMMON_TESTS = [
  { name: 'Complete Blood Count (CBC)', price: 350, reportTime: 'Same day' },
  { name: 'Blood Sugar (Fasting)', price: 120, reportTime: 'Same day' },
  { name: 'Lipid Profile', price: 700, reportTime: '24 hrs' },
  { name: 'Thyroid Profile (T3 T4 TSH)', price: 550, reportTime: '24 hrs' },
  { name: 'Liver Function Test (LFT)', price: 800, reportTime: '24 hrs' },
  { name: 'Vitamin D', price: 1200, reportTime: '48 hrs' },
];

const LABS = [
  {
    name: 'VidhyaCare Diagnostics — Musakhedi',
    address: { line1: '311 Health Plaza, Alok Nagar, Musakhedi', city: 'Indore', state: 'Madhya Pradesh', zip: '452001' },
    coordinates: [75.8937, 22.6899] as [number, number],
    phone: '+917312500111',
    accreditation: 'NABL Accredited',
    rating: 4.8,
    homeCollection: true,
    openHours: '7:00 AM – 9:00 PM',
    tests: COMMON_TESTS,
  },
  {
    name: 'City Path Labs — Vijay Nagar',
    address: { line1: 'Scheme 54, Vijay Nagar', city: 'Indore', state: 'Madhya Pradesh', zip: '452010' },
    coordinates: [75.8937, 22.7533] as [number, number],
    phone: '+917312500222',
    accreditation: 'NABL Accredited',
    rating: 4.6,
    homeCollection: true,
    openHours: '6:30 AM – 10:00 PM',
    tests: [
      ...COMMON_TESTS.slice(0, 4),
      { name: 'Full Body Checkup (72 tests)', price: 2499, reportTime: '48 hrs' },
    ],
  },
  {
    name: 'Sunrise Diagnostic Centre — Palasia',
    address: { line1: '12 MG Road, Palasia Square', city: 'Indore', state: 'Madhya Pradesh', zip: '452001' },
    coordinates: [75.8815, 22.7244] as [number, number],
    phone: '+917312500333',
    accreditation: 'ISO 9001:2015',
    rating: 4.4,
    homeCollection: false,
    openHours: '8:00 AM – 8:00 PM',
    tests: [
      ...COMMON_TESTS.slice(0, 3),
      { name: 'X-Ray Chest (PA)', price: 400, reportTime: 'Same day' },
      { name: 'ECG', price: 300, reportTime: 'Same day' },
    ],
  },
  {
    name: 'MedLife Pathology — Bhawarkua',
    address: { line1: 'Bhawarkua Main Road', city: 'Indore', state: 'Madhya Pradesh', zip: '452014' },
    coordinates: [75.8681, 22.6853] as [number, number],
    phone: '+917312500444',
    accreditation: 'NABL Accredited',
    rating: 4.2,
    homeCollection: true,
    openHours: '7:00 AM – 8:00 PM',
    tests: COMMON_TESTS.slice(0, 5),
  },
  {
    name: 'Apex Labs — Bhopal Central',
    address: { line1: 'MP Nagar Zone 1', city: 'Bhopal', state: 'Madhya Pradesh', zip: '462011' },
    coordinates: [77.4326, 23.2333] as [number, number],
    phone: '+917552500555',
    accreditation: 'NABL Accredited',
    rating: 4.5,
    homeCollection: true,
    openHours: '7:00 AM – 9:00 PM',
    tests: COMMON_TESTS,
  },
];

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('✅ MongoDB connected');

  await Lab.deleteMany({});

  await Lab.insertMany(
    LABS.map((l) => ({
      name: l.name,
      address: { ...l.address, country: 'India' },
      location: { type: 'Point' as const, coordinates: l.coordinates },
      phone: l.phone,
      accreditation: l.accreditation,
      rating: l.rating,
      homeCollection: l.homeCollection,
      openHours: l.openHours,
      tests: l.tests,
      isActive: true,
    }))
  );

  // Make sure the 2dsphere index actually exists before any $geoNear runs.
  await Lab.syncIndexes();

  console.log(`🎉 Seeded ${LABS.length} labs (4 in Indore, 1 in Bhopal).`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
