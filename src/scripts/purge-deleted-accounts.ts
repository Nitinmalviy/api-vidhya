/**
 * Erase patient accounts whose 14-day deletion grace period has run out.
 *
 * `DELETE /api/v1/patient/profile` only *schedules* deletion, so this job does
 * the irreversible part: patient row, locker members, health records (including
 * soft-deleted ones), their S3 objects, appointments and medicine reminders.
 *
 * Run it on a daily schedule:  npm run purge:accounts
 */

import 'dotenv/config';
import dns from 'dns';
import mongoose from 'mongoose';
import { Appointment } from '../models/Appointment';
import { HealthRecord } from '../models/HealthRecord';
import { LockerMember } from '../models/LockerMember';
import { MedicineDoseLog } from '../models/MedicineDoseLog';
import { MedicineReminder } from '../models/MedicineReminder';
import { Patient } from '../models/Patient';
import { deleteFromS3 } from '../services/s3Upload';
import { env } from '../config/env';

dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']);

async function run() {
  await mongoose.connect(env.MONGO_URI);
  console.log('✅ MongoDB connected');

  const due = await Patient.find({ deletionScheduledAt: { $ne: null, $lte: new Date() } })
    .select('_id email deletionScheduledAt')
    .lean();

  if (due.length === 0) {
    console.log('Nothing to purge — no account is past its deletion date.');
    await mongoose.disconnect();
    return;
  }

  console.log(`Purging ${due.length} account(s)…`);

  for (const patient of due) {
    // Files first: once the rows are gone we no longer know the S3 keys.
    const records = await HealthRecord.find({ patientId: patient._id }).select('fileUrl').lean();
    const keys = records.map((r) => r.fileUrl).filter((k): k is string => !!k);
    const results = await Promise.allSettled(keys.map((key) => deleteFromS3(key)));
    const failed = results.filter((r) => r.status === 'rejected').length;

    await Promise.all([
      HealthRecord.deleteMany({ patientId: patient._id }),
      LockerMember.deleteMany({ patientId: patient._id }),
      Appointment.deleteMany({ patientId: patient._id }),
      MedicineReminder.deleteMany({ patientId: patient._id }),
      MedicineDoseLog.deleteMany({ patientId: patient._id }),
    ]);
    await Patient.deleteOne({ _id: patient._id });

    console.log(
      `  · ${patient.email} — ${keys.length} file(s), ${failed} S3 deletion(s) failed, account erased`
    );
  }

  console.log('🧹 Purge complete.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Purge failed:', err.message);
  process.exit(1);
});
