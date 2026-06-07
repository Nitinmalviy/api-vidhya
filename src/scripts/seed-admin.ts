/**
 * Seed the super-admin account.
 * Usage:  pnpm seed:admin   (or npm run seed:admin)
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { Admin } from '../models/Admin';
import { env } from '../config/env';

const ADMIN_EMAIL = 'adminvidhya@yopmail.com';
const ADMIN_PASSWORD = 'admiVidhya@123';
const ADMIN_NAME = 'Vidhya Super Admin';

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('✅ MongoDB connected');

  const existing = await Admin.findOne({ email: ADMIN_EMAIL }).lean();

  if (existing) {
    console.log(`ℹ️  Admin already exists: ${ADMIN_EMAIL}`);
    await mongoose.disconnect();
    return;
  }

  await Admin.create({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    role: 'SUPER_ADMIN',
    permissions: [],
    isEmailVerified: true,
  });

  console.log('🎉 Admin seeded successfully!');
  console.log(`   Email   : ${ADMIN_EMAIL}`);
  console.log(`   Password: ${ADMIN_PASSWORD}`);
  console.log(`   Role    : SUPER_ADMIN`);

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
