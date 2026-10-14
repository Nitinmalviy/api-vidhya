import { createNotification } from './notification';
import { refundCancelledAppointment, releaseAppointmentEarning, toRupees } from './wallet';
import { logger } from '../utils/logger';
import type { IAppointment } from '../models/Appointment';

type Appt = Pick<IAppointment, 'status' | 'paymentStatus' | 'patientId' | 'date' | 'timeSlot'> & { _id: unknown };

/**
 * Money side of a status change. Safe to call for clinic-paid visits too:
 * the wallet functions ignore anything not paid on the platform.
 */
/** Returns the paise refunded to the patient's wallet (0 when nothing was refunded). */
export async function afterStatusChange(appt: Appt): Promise<number> {
  const id = String(appt._id);
  if (appt.status === 'COMPLETED' && appt.paymentStatus === 'PAID') {
    try {
      await releaseAppointmentEarning(id);
    } catch (err) {
      // Status is saved; the release is idempotent and can be re-run safely.
      logger.error({ err, appointmentId: id }, 'WALLET: earning release failed');
    }
  } else if (appt.status === 'CANCELLED' && appt.paymentStatus === 'PAID') {
    let refunded = 0;
    try {
      refunded = await refundCancelledAppointment(id);
    } catch (err) {
      logger.error({ err, appointmentId: id }, 'WALLET: refund failed — re-run refundCancelledAppointment');
    }
    if (refunded > 0 && appt.patientId) {
      await createNotification({
        userId: String(appt.patientId),
        role: 'patient',
        type: 'GENERAL',
        title: 'Appointment cancelled by doctor',
        message: `Your appointment on ${appt.date} at ${appt.timeSlot} was cancelled. ₹${toRupees(refunded).toLocaleString('en-IN')} has been refunded to your VidhyaCare wallet.`,
      }).catch((err) => logger.warn({ err }, 'Doctor-cancel refund notification failed'));
    }
    return refunded;
  }
  return 0;
}
