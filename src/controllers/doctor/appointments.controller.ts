import type { Response } from 'express';
import { Appointment } from '../../models/Appointment';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';

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

  const appt = await Appointment.findOneAndUpdate(
    { _id: req.params.id, doctorId: req.user.id },
    { status },
    { new: true }
  ).lean();

  if (!appt) throw new NotFoundError('Appointment not found');

  res.status(200).json({ success: true, message: 'Appointment updated', data: { status: appt.status } });
};
