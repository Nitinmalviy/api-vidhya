import type { Response } from 'express';
import { OpdSession } from '../../models/OpdSession';
import { Appointment } from '../../models/Appointment';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { createNotification } from '../../services/notification';

const DOCTOR_CARD_FIELDS = 'name specializations consultationFee photoUrl yearsExperience';

/* GET /api/v1/patient/opd — today's & upcoming live OPD sessions across all doctors */
export const listOpdSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const today = new Date().toISOString().slice(0, 10);

  const sessions = await OpdSession.find({
    status: { $in: ['LIVE', 'SCHEDULED'] },
    date: { $gte: today },
  })
    .populate('doctorId', DOCTOR_CARD_FIELDS)
    .sort({ status: 1, date: 1, startTime: 1 }) // LIVE sessions first
    .lean();

  const sessionIds = sessions.map((s) => s._id);
  const opdBookings = await Appointment.find({
    type: 'OPD',
    opdSessionId: { $in: sessionIds },
    status: 'BOOKED',
  })
    .select('opdSessionId patientId createdAt')
    .sort({ createdAt: 1 })
    .lean();

  const bookingsBySession = new Map<string, typeof opdBookings>();
  for (const b of opdBookings) {
    const key = String(b.opdSessionId);
    const list = bookingsBySession.get(key) ?? [];
    list.push(b);
    bookingsBySession.set(key, list);
  }

  const result = sessions.map((s) => {
    const bookings = bookingsBySession.get(String(s._id)) ?? [];
    const myIndex = bookings.findIndex((b) => String(b.patientId) === req.user!.id);
    return {
      ...s,
      queueCount: bookings.length,
      joined: myIndex !== -1,
      myPosition: myIndex !== -1 ? myIndex + 1 : null,
    };
  });

  res.status(200).json({ success: true, data: { sessions: result } });
};

/* POST /api/v1/patient/opd/:sessionId/join */
export const joinOpdSession = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { sessionId } = req.params;

  const session = await OpdSession.findById(sessionId).populate('doctorId', 'name');
  if (!session) throw new NotFoundError('OPD session');
  if (session.status !== 'LIVE' && session.status !== 'SCHEDULED') {
    throw new BadRequestError('This OPD session is no longer accepting patients');
  }

  const existing = await Appointment.findOne({
    type: 'OPD',
    opdSessionId: session._id,
    patientId: req.user.id,
    status: 'BOOKED',
  });
  if (existing) throw new BadRequestError('You have already joined this OPD queue');

  const appointment = await Appointment.create({
    patientId: req.user.id,
    doctorId: session.doctorId,
    type: 'OPD',
    opdSessionId: session._id,
    date: session.date,
    timeSlot: `${session.startTime} - ${session.endTime}`,
    status: 'BOOKED',
  });

  const queuePosition = await Appointment.countDocuments({
    type: 'OPD',
    opdSessionId: session._id,
    status: 'BOOKED',
  });

  const doctorName = (session.doctorId as any)?.name ?? 'the doctor';
  await createNotification({
    userId: session.doctorId as any,
    role: 'doctor',
    type: 'GENERAL',
    title: 'Patient joined your OPD queue',
    message: `A patient joined the OPD queue for ${session.date} at ${session.startTime}.`,
  });
  await createNotification({
    userId: req.user.id,
    role: 'patient',
    type: 'GENERAL',
    title: 'Joined OPD queue',
    message: `You're #${queuePosition} in line for ${doctorName}'s OPD on ${session.date}.`,
  });

  res.status(201).json({
    success: true,
    message: 'Joined the OPD queue',
    data: { appointmentId: appointment._id, queuePosition },
  });
};

/* DELETE /api/v1/patient/opd/:sessionId/leave */
export const leaveOpdSession = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { sessionId } = req.params;

  const appointment = await Appointment.findOne({
    type: 'OPD',
    opdSessionId: sessionId,
    patientId: req.user.id,
    status: 'BOOKED',
  });
  if (!appointment) throw new NotFoundError('Queue entry');

  appointment.status = 'CANCELLED';
  await appointment.save();

  res.status(200).json({ success: true, message: 'Left the OPD queue' });
};
