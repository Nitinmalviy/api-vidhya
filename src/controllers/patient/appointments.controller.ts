import type { Response } from 'express';
import { Appointment } from '../../models/Appointment';
import { Doctor } from '../../models/Doctor';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { createNotification } from '../../services/notification';

/* POST /api/v1/patient/appointments */
export const createAppointment = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const { doctorId, type, planName, price, date, timeSlot, notes } = req.body ?? {};

  if (!doctorId || !date || !timeSlot) {
    throw new BadRequestError('doctorId, date, and timeSlot are required');
  }
  const apptType = type === 'CHECKUP' ? 'CHECKUP' : 'CONSULTATION';

  const doctor = await Doctor.findOne({ _id: doctorId, kycStatus: 'APPROVED' }).lean();
  if (!doctor) throw new NotFoundError('Doctor not available');

  // Prevent double-booking the same doctor slot
  const clash = await Appointment.findOne({
    doctorId,
    date,
    timeSlot,
    status: 'BOOKED',
  }).lean();
  if (clash) throw new BadRequestError('This time slot is already booked. Please pick another.');

  const appointment = await Appointment.create({
    patientId: req.user.id,
    doctorId,
    type: apptType,
    planName: planName || undefined,
    price: price != null ? Number(price) : undefined,
    date,
    timeSlot,
    notes: notes || undefined,
    status: 'BOOKED',
  });

  // Notify the doctor in-app
  await createNotification({
    userId: doctorId,
    role: 'doctor',
    type: 'GENERAL',
    title: 'New Appointment Booked',
    message: `${apptType === 'CHECKUP' ? planName ?? 'Health checkup' : 'Consultation'} booked for ${date} at ${timeSlot}.`,
  });

  res.status(201).json({
    success: true,
    message: 'Appointment booked successfully',
    data: { id: appointment._id, date, timeSlot, status: appointment.status },
  });
};

/* GET /api/v1/patient/appointments */
export const getMyAppointments = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const appointments = await Appointment.find({ patientId: req.user.id })
    .populate('doctorId', 'name specializations')
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ success: true, data: { appointments } });
};

/* GET /api/v1/patient/appointments/booked-slots?doctorId=&date= */
export const getBookedSlots = async (req: AuthRequest, res: Response): Promise<void> => {
  const { doctorId, date } = req.query;
  if (!doctorId || !date) throw new BadRequestError('doctorId and date are required');

  const booked = await Appointment.find({ doctorId, date, status: 'BOOKED' })
    .select('timeSlot')
    .lean();

  res.status(200).json({ success: true, data: { slots: booked.map((b) => b.timeSlot) } });
};
