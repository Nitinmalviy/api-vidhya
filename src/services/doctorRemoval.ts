import { Types } from 'mongoose';
import { Appointment } from '../models/Appointment';
import { Doctor } from '../models/Doctor';
import { OpdConsultation } from '../models/OpdConsultation';
import { OpdSession } from '../models/OpdSession';
import { Prescription } from '../models/Prescription';
import { Review } from '../models/Review';
import { WalletEntry } from '../models/WalletEntry';
import { Wallet } from '../models/Wallet';
import { afterStatusChange } from './appointmentLifecycle';
import { createNotification } from './notification';
import { nowInIndia } from '../utils/availability';
import { logger } from '../utils/logger';

export type RemovalMode = 'deleted' | 'deactivated';

/**
 * Takes a doctor out of the product.
 * - Nothing on record (no bookings, calls, prescriptions or money): the account
 *   and its reviews are deleted outright.
 * - Otherwise patients' records must keep pointing at a real doctor, so the
 *   account is deactivated: hidden from every listing, unable to sign in,
 *   upcoming bookings cancelled (paid ones refunded to the patient's wallet).
 */
export async function removeDoctorAccount(doctorId: string, reason: string): Promise<RemovalMode> {
  const id = new Types.ObjectId(doctorId);
  const [appt, opd, call, rx, money] = await Promise.all([
    Appointment.exists({ doctorId: id }),
    OpdSession.exists({ doctorId: id }),
    OpdConsultation.exists({ doctorId: id }),
    Prescription.exists({ doctorId: id }),
    WalletEntry.exists({ ownerType: 'doctor', ownerId: id }),
  ]);

  if (!appt && !opd && !call && !rx && !money) {
    await Review.deleteMany({ doctorId: id });
    await Wallet.deleteOne({ ownerType: 'doctor', ownerId: id, balance: 0, pending: 0 });
    await Doctor.deleteOne({ _id: id });
    return 'deleted';
  }

  await Doctor.updateOne(
    { _id: id },
    {
      $set: { removedAt: new Date(), kycStatus: 'REJECTED', adminRemarks: `Removed: ${reason}`.slice(0, 500) },
      $inc: { sessionVersion: 1 }, // signs the account out everywhere
    }
  );
  // Reviews written by nobody (seeded) go; real patients' reviews stay attached to their history.
  await Review.deleteMany({ doctorId: id, patientId: { $exists: false } });

  const today = nowInIndia().date;
  const upcoming = await Appointment.find({ doctorId: id, status: 'BOOKED', date: { $gte: today } }).select('_id').lean();
  for (const { _id } of upcoming) {
    const appt = await Appointment.findOneAndUpdate({ _id, status: 'BOOKED' }, { $set: { status: 'CANCELLED' } }, { new: true }).lean();
    if (!appt) continue;
    await afterStatusChange(appt);
    // Paid bookings already get a "cancelled & refunded" notice from afterStatusChange.
    if (appt.patientId && appt.paymentStatus !== 'PAID') {
      await createNotification({
        userId: String(appt.patientId),
        role: 'patient',
        type: 'GENERAL',
        title: 'Appointment cancelled',
        message: `Your appointment on ${appt.date} at ${appt.timeSlot} was cancelled because the doctor is no longer available on VidhyaCare. Please book another doctor.`,
      }).catch(() => undefined);
    }
  }
  logger.info({ doctorId, cancelled: upcoming.length }, 'Doctor account deactivated');
  return 'deactivated';
}
