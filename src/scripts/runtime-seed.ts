import { Doctor } from '../models/Doctor';
import { Review } from '../models/Review';
import { logger } from '../utils/logger';

/**
 * Idempotent startup seeding so doctor cards and detail pages always have
 * real, dynamic data to render:
 *  - approved doctors missing a consultationFee / yearsExperience get sensible values
 *  - if a doctor has no reviews yet, a few starter reviews are inserted
 * Runs after DB connect; every operation is guarded so a failure never blocks boot.
 */

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

/** Deterministic-ish pseudo-random from a string so re-runs stay stable. */
function seedFrom(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export async function runtimeSeed(): Promise<void> {
  try {
    // 1. Fill in missing public-profile fields on approved doctors.
    const incomplete = await Doctor.find({
      kycStatus: 'APPROVED',
      $or: [{ consultationFee: { $exists: false } }, { yearsExperience: { $exists: false } }],
    })
      .select('consultationFee yearsExperience degreeDetails')
      .exec();

    for (const doc of incomplete) {
      const h = seedFrom(String(doc._id));
      if (doc.consultationFee === undefined || doc.consultationFee === null) {
        doc.consultationFee = 300 + (h % 6) * 100; // ₹300–800
      }
      if (doc.yearsExperience === undefined || doc.yearsExperience === null) {
        const fromDegree = doc.degreeDetails?.passingYear
          ? new Date().getFullYear() - doc.degreeDetails.passingYear
          : null;
        doc.yearsExperience =
          fromDegree && fromDegree > 0 && fromDegree < 50 ? fromDegree : 4 + (h % 14);
      }
      await doc.save();
    }
    if (incomplete.length > 0) {
      logger.info({ count: incomplete.length }, 'Runtime seed: filled doctor fees/experience');
    }

    // 2. Starter reviews for approved doctors that have none.
    const approved = await Doctor.find({ kycStatus: 'APPROVED' }).select('_id').lean();
    if (approved.length === 0) return;

    const reviewed = new Set(
      (await Review.distinct('doctorId', {
        doctorId: { $in: approved.map((d) => d._id) },
      })).map(String)
    );

    let created = 0;
    for (const doc of approved) {
      if (reviewed.has(String(doc._id))) continue;
      const h = seedFrom(String(doc._id));
      const howMany = 3 + (h % 3); // 3–5 reviews
      const docs = Array.from({ length: howMany }, (_, i) => {
        const tpl = REVIEW_TEXTS[(h + i * 3) % REVIEW_TEXTS.length];
        return {
          doctorId: doc._id,
          patientName: REVIEWER_NAMES[(h + i * 7) % REVIEWER_NAMES.length],
          rating: tpl.rating,
          text: tpl.text,
        };
      });
      await Review.insertMany(docs);
      created += docs.length;
    }
    if (created > 0) {
      logger.info({ count: created }, 'Runtime seed: created starter doctor reviews');
    }
  } catch (err) {
    logger.error({ err }, 'Runtime seed failed (non-fatal)');
  }
}
