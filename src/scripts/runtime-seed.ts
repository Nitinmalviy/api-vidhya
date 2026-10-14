import { Doctor } from '../models/Doctor';
import { Review } from '../models/Review';
import { logger } from '../utils/logger';
import { removeDoctorAccount } from '../services/doctorRemoval';
import { Appointment, WALK_IN_SLOT } from '../models/Appointment';


// Names and texts the old seeder used — kept only to recognise and delete its reviews.
const REVIEWER_NAMES = [
  'Riya Sharma',
  'Arjun Patel',
  'Meera Iyer',
  'Vikram Singh',
  'Ananya Rao',
  'Rohan Gupta',
  'Sneha Kulkarni',
  'Aditya Verma',
  'Pooja Nair',
  'Karan Malhotra',
];

const REVIEW_TEXTS: { rating: number; text: string }[] = [
  { rating: 5, text: 'Explained everything patiently and the treatment worked within a week. Consultation started right on time.' },
  { rating: 5, text: 'Very thorough with reports — went through my full history before suggesting any medicines.' },
  { rating: 4, text: 'Good consultation and clear advice. Booking a follow-up took a couple of tries, otherwise excellent.' },
  { rating: 5, text: 'The prescription reached my Health Vault immediately after the visit. Genuinely caring doctor.' },
  { rating: 4, text: 'Listened carefully and did not rush the appointment. Clinic was clean and well managed.' },
  { rating: 5, text: 'Consulted for my father — the doctor was patient with all our questions and adjusted medicines for his age.' },
  { rating: 3, text: 'Consultation itself was fine, but the wait time at the clinic was longer than expected.' },
  { rating: 5, text: 'Accurate diagnosis on the first visit after months of confusion elsewhere. Highly recommended.' },
];


/** Doctors created by the old `seed:doctors` script — demo accounts, not real practitioners. */
const TEST_DOCTOR_EMAILS = [
  'arjun.sharma@vidhyacare.in',
  'priya.nair@vidhyacare.in',
  'suresh.verma@vidhyacare.in',
  'kavita.reddy@vidhyacare.in',
  'rajesh.iyer@vidhyacare.in',
  'anita.gupta@vidhyacare.in',
  'vikram.bose@vidhyacare.in',
  'meera.joshi@vidhyacare.in',
  'santosh.pillai@vidhyacare.in',
  'deepa.menon@vidhyacare.in',
];

/**
 * Startup housekeeping. This used to invent data for public profiles — starter
 * reviews from made-up patients and random fees/experience. Patients read those
 * as real, so it now only removes what earlier runs created. Idempotent and cheap
 * once clean; failures never block boot.
 */
export async function runtimeSeed(): Promise<void> {
  try {
    // 1. Reviews nobody wrote: no patient account, text and name from the old templates.
    const fake = await Review.deleteMany({
      patientId: { $exists: false },
      patientName: { $in: REVIEWER_NAMES },
      text: { $in: REVIEW_TEXTS.map((r) => r.text) },
    });
    if (fake.deletedCount) logger.info({ count: fake.deletedCount }, 'Cleanup: removed seeded reviews');

    // 2. Demo doctors from the seed script.
    const demo = await Doctor.find({ email: { $in: TEST_DOCTOR_EMAILS }, removedAt: null }).select('_id email').lean();
    for (const d of demo) {
      const mode = await removeDoctorAccount(String(d._id), 'demo account from seed script');
      logger.info({ email: d.email, mode }, 'Cleanup: removed demo doctor');
    }
  } catch (err) {
    logger.error({ err }, 'Startup cleanup failed (non-fatal)');
  }
}

/**
 * Marks bookings made before slot locking as slot-holders so the unique index
 * protects them too. Closed bookings are flagged in bulk; active ones one by one,
 * so a double booking that already existed is logged and skipped instead of
 * failing the whole run. Cheap once done: the query then matches nothing.
 */
export async function backfillSlotHolds(): Promise<void> {
  const base = { holdsSlot: { $exists: false } };
  try {
    // The unique slot index must exist first, or two old double bookings could both be
    // flagged and then the index itself would fail to build.
    await Appointment.init();
    await Appointment.updateMany(
      { ...base, status: { $ne: 'BOOKED' }, type: { $ne: 'OPD' }, timeSlot: { $ne: WALK_IN_SLOT } },
      { $set: { holdsSlot: true } }
    );
    await Appointment.updateMany({ ...base, $or: [{ type: 'OPD' }, { timeSlot: WALK_IN_SLOT }] }, { $set: { holdsSlot: false } });
    const active = await Appointment.find({ ...base, status: 'BOOKED' }).select('_id').limit(2000).lean();
    for (const a of active) {
      try {
        await Appointment.updateOne({ _id: a._id }, { $set: { holdsSlot: true } });
      } catch (err) {
        logger.warn({ err, appointmentId: String(a._id) }, 'Existing double booking — left unlocked for the doctor to resolve');
        await Appointment.updateOne({ _id: a._id }, { $set: { holdsSlot: false } });
      }
    }
  } catch (err) {
    logger.error({ err }, 'Slot-hold backfill failed');
  }
}
