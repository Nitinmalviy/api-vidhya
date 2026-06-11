/**
 * Seed 10 mock doctors with varied KYC statuses, specializations, and work types.
 * Usage:  npm run seed:doctors
 * Idempotent: skips any doctor whose email already exists.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { Doctor } from '../models/Doctor';
import { env } from '../config/env';

const PASSWORD = 'Doctor@123';

const mockDoctors = [
  {
    name: 'Dr. Arjun Sharma',
    email: 'arjun.sharma@vidhyacare.in',
    phone: '+91 98765 11001',
    specializations: ['Cardiology'],
    workType: 'OWN_CLINIC' as const,
    kycStatus: 'APPROVED' as const,
    degreeDetails: {
      degreeName: 'MBBS, MD (Cardiology)',
      university: 'AIIMS New Delhi',
      passingYear: 2010,
      documentUrl: 'https://placeholder.example.com/degree-arjun.pdf',
    },
    licenseDetails: {
      licenseNumber: 'MCI-2010-CARD-001',
      expiryDate: new Date('2030-12-31'),
      documentUrl: 'https://placeholder.example.com/license-arjun.pdf',
    },
    isEmailVerified: true,
  },
  {
    name: 'Dr. Priya Nair',
    email: 'priya.nair@vidhyacare.in',
    phone: '+91 99887 22002',
    specializations: ['Dermatology'],
    workType: 'EMPLOYEE' as const,
    kycStatus: 'APPROVED' as const,
    degreeDetails: {
      degreeName: 'MBBS, MD (Dermatology)',
      university: 'Kasturba Medical College, Manipal',
      passingYear: 2013,
      documentUrl: 'https://placeholder.example.com/degree-priya.pdf',
    },
    licenseDetails: {
      licenseNumber: 'MCI-2013-DERM-002',
      expiryDate: new Date('2031-06-30'),
      documentUrl: 'https://placeholder.example.com/license-priya.pdf',
    },
    isEmailVerified: true,
  },
  {
    name: 'Dr. Suresh Verma',
    email: 'suresh.verma@vidhyacare.in',
    phone: '+91 91234 33003',
    specializations: ['General Medicine'],
    workType: 'OWN_CLINIC' as const,
    kycStatus: 'APPROVED' as const,
    degreeDetails: {
      degreeName: 'MBBS',
      university: 'Grant Medical College, Mumbai',
      passingYear: 2008,
      documentUrl: 'https://placeholder.example.com/degree-suresh.pdf',
    },
    licenseDetails: {
      licenseNumber: 'MCI-2008-GM-003',
      expiryDate: new Date('2029-03-31'),
      documentUrl: 'https://placeholder.example.com/license-suresh.pdf',
    },
    isEmailVerified: true,
  },
  {
    name: 'Dr. Kavita Reddy',
    email: 'kavita.reddy@vidhyacare.in',
    phone: '+91 90000 44004',
    specializations: ['Orthopedics'],
    workType: 'EMPLOYEE' as const,
    kycStatus: 'APPROVED' as const,
    degreeDetails: {
      degreeName: 'MBBS, MS (Orthopaedics)',
      university: 'Osmania Medical College, Hyderabad',
      passingYear: 2012,
      documentUrl: 'https://placeholder.example.com/degree-kavita.pdf',
    },
    licenseDetails: {
      licenseNumber: 'MCI-2012-ORTHO-004',
      expiryDate: new Date('2032-09-30'),
      documentUrl: 'https://placeholder.example.com/license-kavita.pdf',
    },
    isEmailVerified: true,
  },
  {
    name: 'Dr. Rajesh Iyer',
    email: 'rajesh.iyer@vidhyacare.in',
    phone: '+91 98001 55005',
    specializations: ['Pediatrics'],
    workType: 'OWN_CLINIC' as const,
    kycStatus: 'PENDING' as const,
    degreeDetails: {
      degreeName: 'MBBS, DCH',
      university: 'Madras Medical College',
      passingYear: 2015,
      documentUrl: 'https://placeholder.example.com/degree-rajesh.pdf',
    },
    licenseDetails: {
      licenseNumber: 'MCI-2015-PED-005',
      expiryDate: new Date('2033-11-30'),
      documentUrl: 'https://placeholder.example.com/license-rajesh.pdf',
    },
    isEmailVerified: true,
  },
  {
    name: 'Dr. Anita Gupta',
    email: 'anita.gupta@vidhyacare.in',
    phone: '+91 97654 66006',
    specializations: ['Neurology'],
    workType: 'EMPLOYEE' as const,
    kycStatus: 'PENDING' as const,
    degreeDetails: {
      degreeName: 'MBBS, DM (Neurology)',
      university: 'PGI Chandigarh',
      passingYear: 2016,
      documentUrl: 'https://placeholder.example.com/degree-anita.pdf',
    },
    licenseDetails: {
      licenseNumber: 'MCI-2016-NEURO-006',
      expiryDate: new Date('2034-04-30'),
      documentUrl: 'https://placeholder.example.com/license-anita.pdf',
    },
    isEmailVerified: true,
  },
  {
    name: 'Dr. Vikram Bose',
    email: 'vikram.bose@vidhyacare.in',
    phone: '+91 96543 77007',
    specializations: ['ENT'],
    workType: 'OWN_CLINIC' as const,
    kycStatus: 'PENDING' as const,
    degreeDetails: {
      degreeName: 'MBBS, MS (ENT)',
      university: 'RG Kar Medical College, Kolkata',
      passingYear: 2014,
      documentUrl: 'https://placeholder.example.com/degree-vikram.pdf',
    },
    licenseDetails: {
      licenseNumber: 'MCI-2014-ENT-007',
      expiryDate: new Date('2030-07-31'),
      documentUrl: 'https://placeholder.example.com/license-vikram.pdf',
    },
    isEmailVerified: true,
  },
  {
    name: 'Dr. Meera Joshi',
    email: 'meera.joshi@vidhyacare.in',
    phone: '+91 95432 88008',
    specializations: ['Psychiatry'],
    workType: 'EMPLOYEE' as const,
    kycStatus: 'REJECTED' as const,
    adminRemarks: 'License document unclear. Please resubmit a high-resolution copy.',
    degreeDetails: {
      degreeName: 'MBBS, MD (Psychiatry)',
      university: 'BJ Medical College, Pune',
      passingYear: 2017,
      documentUrl: 'https://placeholder.example.com/degree-meera.pdf',
    },
    licenseDetails: {
      licenseNumber: 'MCI-2017-PSY-008',
      expiryDate: new Date('2035-01-31'),
      documentUrl: 'https://placeholder.example.com/license-meera.pdf',
    },
    isEmailVerified: true,
  },
  {
    name: 'Dr. Santosh Pillai',
    email: 'santosh.pillai@vidhyacare.in',
    phone: '+91 94321 99009',
    specializations: ['Ophthalmology'],
    workType: 'OWN_CLINIC' as const,
    kycStatus: 'REJECTED' as const,
    adminRemarks: 'Degree details do not match MCI records. Verification pending with council.',
    degreeDetails: {
      degreeName: 'MBBS, MS (Ophthalmology)',
      university: 'Government Medical College, Thiruvananthapuram',
      passingYear: 2011,
      documentUrl: 'https://placeholder.example.com/degree-santosh.pdf',
    },
    licenseDetails: {
      licenseNumber: 'MCI-2011-OPH-009',
      expiryDate: new Date('2028-10-31'),
      documentUrl: 'https://placeholder.example.com/license-santosh.pdf',
    },
    isEmailVerified: true,
  },
  {
    name: 'Dr. Deepa Menon',
    email: 'deepa.menon@vidhyacare.in',
    phone: '+91 93210 00010',
    specializations: ['Gynecology'],
    workType: 'EMPLOYEE' as const,
    kycStatus: 'REJECTED' as const,
    adminRemarks: 'Practice certificate expired. Please renew and resubmit.',
    degreeDetails: {
      degreeName: 'MBBS, MS (Obstetrics & Gynecology)',
      university: 'Calicut Medical College, Kerala',
      passingYear: 2009,
      documentUrl: 'https://placeholder.example.com/degree-deepa.pdf',
    },
    licenseDetails: {
      licenseNumber: 'MCI-2009-GYN-010',
      expiryDate: new Date('2026-05-31'),
      documentUrl: 'https://placeholder.example.com/license-deepa.pdf',
    },
    isEmailVerified: true,
  },
];

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('MongoDB connected');

  let seeded = 0;
  let skipped = 0;

  for (const data of mockDoctors) {
    const existing = await Doctor.findOne({ email: data.email }).lean();
    if (existing) {
      console.log(`  Skipping (already exists): ${data.email}`);
      skipped++;
      continue;
    }

    await Doctor.create({ ...data, password: PASSWORD });
    console.log(`  Seeded: ${data.name} [${data.kycStatus}] — ${data.specializations[0]}`);
    seeded++;
  }

  console.log(`\nDone. Seeded: ${seeded}, Skipped: ${skipped}`);
  console.log('Default password for all doctors: Doctor@123');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
