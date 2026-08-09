import type { Response } from 'express';
import { Doctor } from '../../models/Doctor';
import {
  NO_ANSWER_STATES,
  OPEN_CONSULTATION_STATES,
  OpdConsultation,
} from '../../models/OpdConsultation';
import { OpdSession } from '../../models/OpdSession';
import { Patient } from '../../models/Patient';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { closeRoom, createCallToken } from '../../services/livekit';
import { createNotification } from '../../services/notification';
import {
  OPD_DOCTOR_FIELDS,
  RING_TIMEOUT_MS,
  estimateWaitMinutes,
  expireStaleRings,
  liveDesks,
  newRoomName,
  pickLeastBusy,
} from '../../services/opd';

/* ─────────────────────────────────────────────
   GET /api/v1/patient/opd
   Who is available right now. The patient doesn't pick a doctor — this is for
   showing that the desk is staffed (and by whom) before they tap Consult.
───────────────────────────────────────────── */
export const listOpdSessions = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const desks = await liveDesks();
  const sessions = await OpdSession.find({ _id: { $in: desks.map((d) => d.sessionId) } })
    .populate('doctorId', OPD_DOCTOR_FIELDS)
    .lean();

  const loadBySession = new Map(desks.map((d) => [d.sessionId, d]));

  // Anything still open for this patient — so a reload lands back on the call.
  const mine = await OpdConsultation.findOne({
    patientId: req.user.id,
    status: { $in: OPEN_CONSULTATION_STATES },
  })
    .populate('doctorId', OPD_DOCTOR_FIELDS)
    .lean();

  res.status(200).json({
    success: true,
    data: {
      /** True when at least one doctor is live — drives the big Consult button. */
      available: desks.length > 0,
      doctorsOnline: desks.length,
      liveDoctors: sessions.map((s) => ({
        sessionId: String(s._id),
        doctor: s.doctorId,
        waiting: loadBySession.get(String(s._id))?.waiting ?? 0,
        busy: loadBySession.get(String(s._id))?.busy ?? false,
      })),
      myConsultation: mine ? serializeForPatient(mine, null) : null,
    },
  });
};

function serializeForPatient(c: any, position: number | null) {
  const ringExpiresAt: Date | null = c.ringExpiresAt ?? null;
  return {
    id: String(c._id),
    status: c.status,
    doctor: c.doctorId,
    sessionId: String(c.sessionId),
    position,
    estimatedWaitMinutes: position !== null ? estimateWaitMinutes(position, false) : null,
    reason: c.reason ?? null,
    queuedAt: c.queuedAt,
    calledAt: c.calledAt ?? null,
    ringExpiresAt,
    /** Seconds left for the doctor to pick up — drives the countdown. */
    secondsLeft: ringExpiresAt
      ? Math.max(0, Math.round((new Date(ringExpiresAt).getTime() - Date.now()) / 1000))
      : null,
    /** True once the doctor has accepted — the app opens the room immediately. */
    canJoin: c.status === 'IN_CALL',
  };
}

/* ─────────────────────────────────────────────
   POST /api/v1/patient/opd/consult  { reason? }

   The emergency door: one button, no doctor chosen, no slot booked. The request
   is forwarded straight to the live doctor with the lightest load and starts
   ringing their desk. The doctor has RING_TIMEOUT_MS to accept; after that it
   expires and the patient is told to try again shortly.
───────────────────────────────────────────── */
export const requestConsultation = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const patient = await Patient.findById(req.user.id).select('name').lean();
  if (!patient) throw new NotFoundError('Patient');

  // One live request at a time, or a patient could ring every doctor at once.
  const existing = await OpdConsultation.findOne({
    patientId: req.user.id,
    status: { $in: OPEN_CONSULTATION_STATES },
  })
    .populate('doctorId', OPD_DOCTOR_FIELDS)
    .lean();
  if (existing) {
    res.status(200).json({
      success: true,
      message: 'You already have a consultation in progress',
      data: { consultation: serializeForPatient(existing, null) },
    });
    return;
  }

  const desk = pickLeastBusy(await liveDesks());
  if (!desk) {
    throw new BadRequestError(
      'No doctor is available right now. Please try again in a few minutes, or book an appointment.'
    );
  }

  const now = new Date();
  const consultation = await OpdConsultation.create({
    sessionId: desk.sessionId,
    doctorId: desk.doctorId,
    patientId: req.user.id,
    status: 'RINGING',
    roomName: newRoomName(),
    queuedAt: now,
    calledAt: now,
    ringExpiresAt: new Date(now.getTime() + RING_TIMEOUT_MS),
    ...(req.body?.reason ? { reason: String(req.body.reason).trim().slice(0, 500) } : {}),
  });

  await createNotification({
    userId: desk.doctorId,
    role: 'doctor',
    type: 'GENERAL',
    title: 'Incoming OPD call',
    message: `${patient.name} needs a consultation now${
      consultation.reason ? `: ${consultation.reason}` : ''
    }. Accept within 2 minutes.`,
  }).catch(() => undefined);

  const populated = await consultation.populate('doctorId', OPD_DOCTOR_FIELDS);

  res.status(201).json({
    success: true,
    message: 'Connecting you to a doctor…',
    data: { consultation: serializeForPatient(populated.toObject(), null) },
  });
};

/* GET /api/v1/patient/opd/my-consultation
   Polled while ringing — reports when the doctor accepted, or that the ring
   timed out and nobody could take the call. */
export const getMyConsultation = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  // Enforce the 2-minute deadline on read; there's no cron doing it for us.
  await expireStaleRings();

  const consultation = await OpdConsultation.findOne({
    patientId: req.user.id,
    status: { $in: OPEN_CONSULTATION_STATES },
  })
    .populate('doctorId', OPD_DOCTOR_FIELDS)
    .lean();

  if (!consultation) {
    // Nothing open — surface *why*, so the screen can say "nobody picked up"
    // instead of silently snapping back to the start.
    const recent = await OpdConsultation.findOne({
      patientId: req.user.id,
      status: { $in: NO_ANSWER_STATES },
      endedAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) },
    })
      .sort({ endedAt: -1 })
      .select('status endedAt')
      .lean();

    res.status(200).json({
      success: true,
      data: {
        consultation: null,
        lastOutcome: recent ? { status: recent.status, endedAt: recent.endedAt } : null,
      },
    });
    return;
  }

  res.status(200).json({
    success: true,
    data: { consultation: serializeForPatient(consultation, null), lastOutcome: null },
  });
};

/* POST /api/v1/patient/opd/consultations/:id/join
   Hands over LiveKit credentials once the doctor has rung. Also flips the
   consultation to IN_CALL, which is what makes it count as a real consultation. */
export const joinConsultationCall = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const consultation = await OpdConsultation.findOne({
    _id: req.params.id,
    patientId: req.user.id,
  });
  if (!consultation) throw new NotFoundError('Consultation');

  if (consultation.status === 'RINGING' || consultation.status === 'WAITING') {
    throw new BadRequestError('The doctor has not picked up yet — hold on a moment');
  }
  if (consultation.status !== 'IN_CALL') {
    throw new BadRequestError('This consultation has ended');
  }

  const patient = await Patient.findById(req.user.id).select('name').lean();
  const credentials = await createCallToken({
    room: consultation.roomName,
    identity: `patient:${req.user.id}`,
    name: patient?.name ?? 'Patient',
    metadata: { role: 'patient', consultationId: String(consultation._id) },
  });

  res.status(200).json({ success: true, data: { call: credentials } });
};

/* DELETE /api/v1/patient/opd/consultations/:id — leave the queue */
export const leaveQueue = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const consultation = await OpdConsultation.findOne({
    _id: req.params.id,
    patientId: req.user.id,
    status: { $in: OPEN_CONSULTATION_STATES },
  });
  if (!consultation) throw new NotFoundError('Consultation');

  const wasInCall = consultation.status === 'IN_CALL';
  consultation.status = wasInCall ? 'COMPLETED' : 'CANCELLED';
  consultation.endedAt = new Date();
  if (wasInCall && consultation.startedAt) {
    consultation.durationSec = Math.round(
      (consultation.endedAt.getTime() - consultation.startedAt.getTime()) / 1000
    );
  }
  await consultation.save();

  // The doctor keeps their own room token, so only tear the room down if the
  // call was actually running.
  if (wasInCall) await closeRoom(consultation.roomName);

  await createNotification({
    userId: String(consultation.doctorId),
    role: 'doctor',
    type: 'GENERAL',
    title: wasInCall ? 'Patient left the call' : 'Patient left the queue',
    message: wasInCall
      ? 'The patient disconnected from the consultation.'
      : 'A patient removed themselves from your OPD queue.',
  }).catch(() => undefined);

  res.status(200).json({
    success: true,
    message: wasInCall ? 'You left the consultation' : 'You left the OPD queue',
  });
};

/* ─────────────────────────────────────────────
   Legacy: join a specific doctor's session by id. Kept so older app builds
   don't break; routing is now the preferred path.
───────────────────────────────────────────── */
export const joinOpdSession = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const session = await OpdSession.findById(req.params.sessionId);
  if (!session) throw new NotFoundError('OPD session');
  if (session.status !== 'LIVE') {
    throw new BadRequestError('This doctor is not live right now');
  }

  const existing = await OpdConsultation.findOne({
    patientId: req.user.id,
    status: { $in: OPEN_CONSULTATION_STATES },
  });
  if (existing) throw new BadRequestError('You are already in an OPD queue');

  const doctor = await Doctor.findById(session.doctorId).select('opdAccess').lean();
  if (doctor?.opdAccess?.status !== 'APPROVED') {
    throw new BadRequestError('This doctor is not enabled for Live-OPD');
  }

  const consultation = await OpdConsultation.create({
    sessionId: session._id,
    doctorId: session.doctorId,
    patientId: req.user.id,
    status: 'WAITING',
    roomName: newRoomName(),
    queuedAt: new Date(),
  });

  const position = await OpdConsultation.countDocuments({
    sessionId: session._id,
    status: 'WAITING',
  });

  res.status(201).json({
    success: true,
    message: 'Joined the OPD queue',
    data: { consultationId: String(consultation._id), queuePosition: position },
  });
};
