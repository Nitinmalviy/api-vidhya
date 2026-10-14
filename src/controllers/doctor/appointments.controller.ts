import type { Response } from 'express';
import { Appointment, isSlotTaken } from '../../models/Appointment';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { afterStatusChange } from '../../services/appointmentLifecycle';

/* GET /api/v1/doctor/appointments?status=&date= */
export const getDoctorAppointments = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { status, date } = req.query;

  const filter: Record<string, unknown> = { doctorId: req.user.id };
  if (status && ['BOOKED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(String(status))) {
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

  let appt;
  try {
    appt = await Appointment.findOneAndUpdate({ _id: current._id, status: current.status }, { status }, { new: true }).lean();
  } catch (err) {
    if (isSlotTaken(err)) throw new BadRequestError('Another booking already holds this slot, so it cannot be reopened.');
    throw err;
  }
  if (!appt) throw new BadRequestError('Appointment was updated by someone else — refresh and try again');

  await afterStatusChange(appt);

  res.status(200).json({ success: true, message: 'Appointment updated', data: { status: appt.status } });
};
