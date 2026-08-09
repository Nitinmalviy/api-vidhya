import type { Response } from 'express';
import { Appointment } from '../../models/Appointment';
import { Doctor } from '../../models/Doctor';
import { OPEN_CONSULTATION_STATES, OpdConsultation } from '../../models/OpdConsultation';
import { OpdSession } from '../../models/OpdSession';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { closeRoom, createCallToken } from '../../services/livekit';
import { createNotification } from '../../services/notification';
import {
  assertWithinHourBudget,
  expireStaleRings,
  requireOpdAccess,
  sessionHours,
} from '../../services/opd';

const PATIENT_CARD_FIELDS = 'name gender dateOfBirth bloodGroup conditions allergies';

function serializeAccess(access: any) {
  return {
    status: access?.status ?? 'NOT_REQUESTED',
    requestedHoursPerDay: access?.requestedHoursPerDay ?? null,
    approvedHoursPerDay: access?.approvedHoursPerDay ?? null,
    preferredWindow: access?.preferredWindow ?? null,
    requestNote: access?.requestNote ?? null,
    requestedAt: access?.requestedAt ?? null,
    reviewedAt: access?.reviewedAt ?? null,
    adminNote: access?.adminNote ?? null,
    canRunOpd: access?.status === 'APPROVED',
  };
}

/* ─────────────────────────────────────────────
   Access — doctor asks admin to switch Live-OPD on
───────────────────────────────────────────── */

/* GET /api/v1/doctor/opd/access */
export const getOpdAccess = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const doctor = await Doctor.findById(req.user.id).select('opdAccess').lean();
  if (!doctor) throw new NotFoundError('Doctor');
  res.status(200).json({ success: true, data: { access: serializeAccess(doctor.opdAccess) } });
};

/* POST /api/v1/doctor/opd/access/request  { hoursPerDay, preferredWindow?, note? } */
export const requestOpdAccess = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { hoursPerDay, preferredWindow, note } = req.body ?? {};

  const hours = Number(hoursPerDay);
  if (!Number.isFinite(hours) || hours < 1 || hours > 24) {
    throw new BadRequestError('Tell us how many hours a day you can be available (1–24)');
  }

  const doctor = await Doctor.findById(req.user.id).select('name opdAccess kycStatus');
  if (!doctor) throw new NotFoundError('Doctor');

  // OPD puts a doctor in front of patients unsupervised — KYC must be cleared.
  if (doctor.kycStatus !== 'APPROVED') {
    throw new BadRequestError('Your KYC must be approved before you can run Live-OPD');
  }
  if (doctor.opdAccess?.status === 'PENDING') {
    throw new BadRequestError('Your Live-OPD request is already with the admin team');
  }
  if (doctor.opdAccess?.status === 'APPROVED') {
    throw new BadRequestError('Live-OPD is already enabled on your account');
  }

  doctor.opdAccess = {
    status: 'PENDING',
    requestedHoursPerDay: hours,
    ...(preferredWindow ? { preferredWindow: String(preferredWindow).trim().slice(0, 200) } : {}),
    ...(note ? { requestNote: String(note).trim().slice(0, 1000) } : {}),
    requestedAt: new Date(),
    reviewedAt: null,
  };
  await doctor.save();

  res.status(200).json({
    success: true,
    message:
      'Request sent. The admin team will confirm your Live-OPD hours and enable it on your account.',
    data: { access: serializeAccess(doctor.opdAccess) },
  });
};

/* ─────────────────────────────────────────────
   Sessions — the doctor's OPD desk
───────────────────────────────────────────── */

/* POST /api/v1/doctor/opd  { date, startTime, endTime, notes? } */
export const createOpdSession = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const access = await requireOpdAccess(req.user.id);

  const { date, startTime, endTime, notes } = req.body ?? {};
  if (!date || !startTime || !endTime) {
    throw new BadRequestError('Date, startTime, and endTime are required');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw new BadRequestError('Date must be YYYY-MM-DD');
  }

  await assertWithinHourBudget(req.user.id, access, String(date), String(startTime), String(endTime));

  const session = await OpdSession.create({
    doctorId: req.user.id,
    date,
    startTime,
    endTime,
    notes,
    status: 'SCHEDULED',
  });

  res.status(201).json({ success: true, data: { session } });
};

/* GET /api/v1/doctor/opd */
export const getOpdSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const sessions = await OpdSession.find({ doctorId: req.user.id })
    .sort({ date: -1, startTime: 1 })
    .limit(100)
    .lean();

  // Waiting counts so the doctor sees demand without opening each session.
  const counts = await OpdConsultation.aggregate<{ _id: unknown; count: number }>([
    {
      $match: {
        sessionId: { $in: sessions.map((s) => s._id) },
        status: { $in: OPEN_CONSULTATION_STATES },
      },
    },
    { $group: { _id: '$sessionId', count: { $sum: 1 } } },
  ]);
  const waiting = new Map(counts.map((c) => [String(c._id), c.count]));

  const doctor = await Doctor.findById(req.user.id).select('opdAccess').lean();

  res.status(200).json({
    success: true,
    data: {
      access: serializeAccess(doctor?.opdAccess),
      sessions: sessions.map((s) => ({
        ...s,
        hours: Number(sessionHours(s.startTime, s.endTime).toFixed(2)),
        queueCount: waiting.get(String(s._id)) ?? 0,
      })),
    },
  });
};

/* PATCH /api/v1/doctor/opd/:id/status  { status }
   Going LIVE is what makes the doctor reachable by walk-in patients. */
export const updateOpdSessionStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { id } = req.params;
  const { status } = req.body ?? {};

  if (!['SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED'].includes(status)) {
    throw new BadRequestError('Invalid status');
  }
  if (status === 'LIVE') await requireOpdAccess(req.user.id);

  const session = await OpdSession.findOne({ _id: id, doctorId: req.user.id });
  if (!session) throw new NotFoundError('Session');

  if (status === 'LIVE') {
    // One desk at a time — two live sessions would split the queue.
    const otherLive = await OpdSession.findOne({
      doctorId: req.user.id,
      status: 'LIVE',
      _id: { $ne: session._id },
    }).select('_id');
    if (otherLive) {
      throw new BadRequestError('You already have a live OPD session. Close it before starting another.');
    }
    session.startedAt = session.startedAt ?? new Date();
  }

  if (status === 'COMPLETED' || status === 'CANCELLED') {
    session.endedAt = new Date();
    // Don't leave patients waiting on a desk nobody is at.
    const stranded = await OpdConsultation.find({
      sessionId: session._id,
      status: { $in: OPEN_CONSULTATION_STATES },
    }).select('_id patientId roomName');

    if (stranded.length > 0) {
      await OpdConsultation.updateMany(
        { sessionId: session._id, status: { $in: OPEN_CONSULTATION_STATES } },
        { $set: { status: 'CANCELLED', endedAt: new Date() } }
      );
      await Promise.all(stranded.map((c) => closeRoom(c.roomName)));
      await Promise.all(
        stranded.map((c) =>
          createNotification({
            userId: String(c.patientId),
            role: 'patient',
            type: 'GENERAL',
            title: 'OPD session closed',
            message: 'The doctor closed this OPD desk. Please start a new consultation — another doctor may be live.',
          }).catch(() => undefined)
        )
      );
    }
  }

  session.status = status;
  await session.save();

  res.status(200).json({ success: true, data: { session } });
};

/* ─────────────────────────────────────────────
   Queue + calls
───────────────────────────────────────────── */

/* GET /api/v1/doctor/opd/:id/queue — incoming calls, plus the one in progress */
export const getOpdQueue = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  // Drop timed-out rings before the doctor sees them, so nobody answers a dead call.
  await expireStaleRings();

  const session = await OpdSession.findOne({ _id: req.params.id, doctorId: req.user.id }).lean();
  if (!session) throw new NotFoundError('Session');

  const consultations = await OpdConsultation.find({
    sessionId: session._id,
    status: { $in: [...OPEN_CONSULTATION_STATES, 'COMPLETED', 'MISSED', 'EXPIRED'] },
  })
    .populate('patientId', PATIENT_CARD_FIELDS)
    .sort({ queuedAt: 1 })
    .lean();

  const open = consultations.filter((c) => OPEN_CONSULTATION_STATES.includes(c.status));
  /** The call the doctor is actually on. */
  const active = open.find((c) => c.status === 'IN_CALL') ?? null;

  res.status(200).json({
    success: true,
    data: {
      session,
      active,
      /** Ringing right now — each carries its own countdown to the deadline. */
      incoming: open
        .filter((c) => c.status === 'RINGING')
        .map((c, i) => ({
          ...c,
          position: i + 1,
          secondsLeft: c.ringExpiresAt
            ? Math.max(0, Math.round((new Date(c.ringExpiresAt).getTime() - Date.now()) / 1000))
            : null,
        })),
      /** Legacy queue rows, if any old sessions still have them. */
      waiting: open
        .filter((c) => c.status === 'WAITING')
        .map((c, i) => ({ ...c, position: i + 1 })),
      done: consultations.filter(
        (c) => c.status === 'COMPLETED' || c.status === 'MISSED' || c.status === 'EXPIRED'
      ),
    },
  });
};

/* POST /api/v1/doctor/opd/consultations/:id/call
   Accepts an incoming call. The patient is already waiting on the other end, so
   this both answers the ring and hands the doctor their room credentials. */
export const callPatient = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  // A request that timed out while the page was open must not be answerable.
  await expireStaleRings();

  const consultation = await OpdConsultation.findOne({
    _id: req.params.id,
    doctorId: req.user.id,
  }).populate('patientId', 'name');
  if (!consultation) throw new NotFoundError('Consultation');

  if (consultation.status === 'EXPIRED') {
    throw new BadRequestError('That call timed out — the patient has been asked to try again');
  }
  if (!OPEN_CONSULTATION_STATES.includes(consultation.status)) {
    throw new BadRequestError('This consultation is already closed');
  }

  // One call at a time, or two patients end up talking to the same doctor.
  const otherActive = await OpdConsultation.findOne({
    doctorId: req.user.id,
    status: 'IN_CALL',
    _id: { $ne: consultation._id },
  }).select('_id');
  if (otherActive) {
    throw new BadRequestError('Finish your current call before accepting another');
  }

  if (consultation.status !== 'IN_CALL') {
    consultation.status = 'IN_CALL';
    consultation.startedAt = consultation.startedAt ?? new Date();
    // The ring is answered — no deadline applies any more.
    consultation.ringExpiresAt = null;
    await consultation.save();

    await createNotification({
      userId: String((consultation.patientId as any)._id ?? consultation.patientId),
      role: 'patient',
      type: 'GENERAL',
      title: 'Doctor is on the call',
      message: 'Your Live-OPD consultation is starting now.',
    }).catch(() => undefined);
  }

  const doctor = await Doctor.findById(req.user.id).select('name').lean();
  const credentials = await createCallToken({
    room: consultation.roomName,
    identity: `doctor:${req.user.id}`,
    name: doctor?.name ?? 'Doctor',
    metadata: { role: 'doctor', consultationId: String(consultation._id) },
  });

  res.status(200).json({
    success: true,
    message: 'Call accepted — connecting you to the patient',
    data: { consultationId: String(consultation._id), call: credentials },
  });
};

/* POST /api/v1/doctor/opd/consultations/:id/end  { notes? }
   Ends the call, writes the appointment record, and frees the desk. */
export const endConsultation = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const consultation = await OpdConsultation.findOne({
    _id: req.params.id,
    doctorId: req.user.id,
  });
  if (!consultation) throw new NotFoundError('Consultation');
  if (consultation.status === 'COMPLETED') {
    res.status(200).json({ success: true, message: 'Consultation already closed' });
    return;
  }

  const session = await OpdSession.findById(consultation.sessionId).select('date startTime endTime');
  const endedAt = new Date();
  // A call that was never actually joined is a miss, not a consultation.
  const wasConnected = consultation.status === 'IN_CALL';

  consultation.status = wasConnected ? 'COMPLETED' : 'MISSED';
  consultation.endedAt = endedAt;
  if (consultation.startedAt) {
    consultation.durationSec = Math.round((endedAt.getTime() - consultation.startedAt.getTime()) / 1000);
  }
  if (req.body?.notes) consultation.doctorNotes = String(req.body.notes).trim().slice(0, 2000);

  // Only a real consultation earns a row in the patient's appointment history.
  if (wasConnected && !consultation.appointmentId && session) {
    const appointment = await Appointment.create({
      patientId: consultation.patientId,
      doctorId: consultation.doctorId,
      type: 'OPD',
      opdSessionId: consultation.sessionId,
      date: session.date,
      timeSlot: `${session.startTime} - ${session.endTime}`,
      status: 'COMPLETED',
    });
    consultation.appointmentId = appointment._id;
  }
  await consultation.save();

  if (wasConnected) {
    await OpdSession.findByIdAndUpdate(consultation.sessionId, { $inc: { consultationsDone: 1 } });
  }
  await closeRoom(consultation.roomName);

  await createNotification({
    userId: String(consultation.patientId),
    role: 'patient',
    type: 'GENERAL',
    title: wasConnected ? 'Consultation completed' : 'Consultation missed',
    message: wasConnected
      ? 'Your Live-OPD consultation has ended. Your prescription, if any, will appear in your records.'
      : 'You did not join the call in time. Please start a new consultation when you are ready.',
  }).catch(() => undefined);

  res.status(200).json({
    success: true,
    message: wasConnected ? 'Consultation completed' : 'Marked as missed — the patient never joined',
    data: { status: consultation.status, durationSec: consultation.durationSec ?? null },
  });
};

/* POST /api/v1/doctor/opd/consultations/:id/skip
   Declines an incoming call, or gives up on a patient who never joined. Either
   way the patient is told to try again rather than left hanging. */
export const skipConsultation = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const consultation = await OpdConsultation.findOne({
    _id: req.params.id,
    doctorId: req.user.id,
    status: { $in: OPEN_CONSULTATION_STATES },
  });
  if (!consultation) throw new NotFoundError('Consultation');

  // Declined before answering reads as "nobody took the call" to the patient;
  // dropped mid-call is a genuine miss.
  const declined = consultation.status === 'RINGING' || consultation.status === 'WAITING';
  consultation.status = declined ? 'EXPIRED' : 'MISSED';
  consultation.endedAt = new Date();
  consultation.ringExpiresAt = null;
  await consultation.save();
  await closeRoom(consultation.roomName);

  await createNotification({
    userId: String(consultation.patientId),
    role: 'patient',
    type: 'GENERAL',
    title: declined ? 'No doctor available' : 'You missed your OPD call',
    message: declined
      ? 'The doctor could not take your call. Please try again in a few minutes.'
      : 'The doctor ended the call because you did not join. Please try again when you are ready.',
  }).catch(() => undefined);

  res.status(200).json({
    success: true,
    message: declined ? 'Call declined' : 'Patient marked as missed',
  });
};
