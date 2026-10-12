import type { Response } from 'express';
import { Appointment } from '../../models/Appointment';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { createNotification } from '../../services/notification';
import { refundCancelledAppointment, releaseAppointmentEarning, toRupees } from '../../services/wallet';
import { logger } from '../../utils/logger';

/* GET /api/v1/doctor/appointments?status=&date= */
export const getDoctorAppointments = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { status, date } = req.query;

  const filter: Record<string, unknown> = { doctorId: req.user.id };
  if (status && ['BOOKED', 'COMPLETED', 'CANCELLED'].includes(String(status))) {
    filter.status = status;
  }
  if (date) filter.date = String(date);

  const appointments = await Appointment.find(filter)
    .populate('patientId', 'name phone email')
    .sort({ date: 1, createdAt: -1 })
    .lean();

  res.status(200).json({ success: true, data: { appointments } });
};

/* PATCH /api/v1/doctor/appointments/:id/status */
export const updateAppointmentStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { status } = req.body ?? {};
  if (!['COMPLETED', 'CANCELLED', 'BOOKED'].includes(status)) {
    throw new BadRequestError('Invalid status');
  }

  const current = await Appointment.findOne({ _id: req.params.id, doctorId: req.user.id }).lean();
  if (!current) throw new NotFoundError('Appointment not found');

  // Money has moved for paid appointments, so their status only moves forward
  // from BOOKED. Unpaid ones keep the old freedom (e.g. undo a mistaken change).
  const hasMoney = current.paymentStatus === 'PAID' || current.paymentStatus === 'REFUNDED';
  if (hasMoney && current.status !== 'BOOKED' && status !== current.status) {
    throw new BadRequestError('A paid appointment cannot be changed after it is completed or cancelled');
  }

  const appt = await Appointment.findOneAndUpdate(
    { _id: current._id, status: current.status },
    { status },
    { new: true }
  ).lean();
  if (!appt) throw new BadRequestError('Appointment was updated by someone else — refresh and try again');

  if (status === 'COMPLETED' && appt.paymentStatus === 'PAID') {
    try {
      await releaseAppointmentEarning(String(appt._id));
    } catch (err) {
      // Status is saved; the release is idempotent and can be re-run safely.
      logger.error({ err, appointmentId: String(appt._id) }, 'WALLET: earning release failed');
    }
  } else if (status === 'CANCELLED' && appt.paymentStatus === 'PAID') {
    let refunded = 0;
    try {
      refunded = await refundCancelledAppointment(String(appt._id));
    } catch (err) {
      logger.error({ err, appointmentId: String(appt._id) }, 'WALLET: refund failed — re-run refundCancelledAppointment');
    }
    if (refunded > 0) {
      try {
        await createNotification({
          userId: String(appt.patientId),
          role: 'patient',
          type: 'GENERAL',
          title: 'Appointment cancelled by doctor',
          message: `Your appointment on ${appt.date} at ${appt.timeSlot} was cancelled. ₹${toRupees(refunded).toLocaleString('en-IN')} has been refunded to your VidhyaCare wallet.`,
        });
      } catch (err) {
        logger.warn({ err }, 'Doctor-cancel refund notification failed');
      }
    }
  }

  res.status(200).json({ success: true, message: 'Appointment updated', data: { status: appt.status } });
};
