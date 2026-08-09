import type { Response } from 'express';
import { Doctor } from '../../models/Doctor';
import { OpdConsultation } from '../../models/OpdConsultation';
import { OpdSession } from '../../models/OpdSession';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { createNotification } from '../../services/notification';
import { signFieldsArray } from '../../services/presignedUrl';

const DOCTOR_FIELDS = 'name email phone specializations photoUrl yearsExperience kycStatus opdAccess';

/* ─────────────────────────────────────────────
   GET /api/v1/admin/opd/requests?status=PENDING
   Doctors asking for (or already holding) Live-OPD access.
───────────────────────────────────────────── */
export const listOpdRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  // Doctors created before Live-OPD existed have no `opdAccess` at all, so match
  // the review states explicitly — `$ne: NOT_REQUESTED` would sweep them all in.
  const REVIEW_STATES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];

  const status = String(req.query.status ?? 'PENDING').toUpperCase();
  const filter =
    status === 'ALL'
      ? { 'opdAccess.status': { $in: REVIEW_STATES } }
      : { 'opdAccess.status': status };

  const doctors = await Doctor.find(filter)
    .select(DOCTOR_FIELDS)
    .sort({ 'opdAccess.requestedAt': -1 })
    .limit(200)
    .lean();

  await signFieldsArray(doctors, ['photoUrl']);

  // Counts for the tab badges, in one round trip.
  const grouped = await Doctor.aggregate<{ _id: string; count: number }>([
    { $match: { 'opdAccess.status': { $in: REVIEW_STATES } } },
    { $group: { _id: '$opdAccess.status', count: { $sum: 1 } } },
  ]);

  res.status(200).json({
    success: true,
    data: {
      doctors,
      counts: grouped.reduce<Record<string, number>>(
        (acc, g) => ({ ...acc, [g._id]: g.count }),
        {}
      ),
    },
  });
};

/* ─────────────────────────────────────────────
   PATCH /api/v1/admin/opd/requests/:doctorId
   { decision: 'APPROVE' | 'REJECT' | 'SUSPEND' | 'RESTORE', hoursPerDay?, note? }

   Approving is where the doctor's daily hour budget is set — every session they
   create afterwards is measured against it.
───────────────────────────────────────────── */
export const reviewOpdRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const { decision, hoursPerDay, note } = req.body ?? {};
  const action = String(decision ?? '').toUpperCase();
  if (!['APPROVE', 'REJECT', 'SUSPEND', 'RESTORE'].includes(action)) {
    throw new BadRequestError("decision must be APPROVE, REJECT, SUSPEND or RESTORE");
  }

  const doctor = await Doctor.findById(req.params.doctorId).select('name email opdAccess kycStatus');
  if (!doctor) throw new NotFoundError('Doctor');

  const access = doctor.opdAccess ?? { status: 'NOT_REQUESTED' as const };
  const adminNote = note ? String(note).trim().slice(0, 1000) : undefined;

  if (action === 'APPROVE' || action === 'RESTORE') {
    if (doctor.kycStatus !== 'APPROVED') {
      throw new BadRequestError("This doctor's KYC is not approved yet");
    }
    // Fall back to what the doctor asked for if admin doesn't override it.
    const hours = Number(hoursPerDay ?? access.requestedHoursPerDay);
    if (!Number.isFinite(hours) || hours < 1 || hours > 24) {
      throw new BadRequestError('Set the daily OPD hours you are approving (1–24)');
    }
    doctor.opdAccess = {
      ...access,
      status: 'APPROVED',
      approvedHoursPerDay: hours,
      reviewedAt: new Date(),
      reviewedBy: req.user.id as any,
      ...(adminNote ? { adminNote } : { adminNote: undefined }),
    };
  } else if (action === 'REJECT') {
    doctor.opdAccess = {
      ...access,
      status: 'REJECTED',
      approvedHoursPerDay: undefined,
      reviewedAt: new Date(),
      reviewedBy: req.user.id as any,
      ...(adminNote ? { adminNote } : {}),
    };
  } else {
    // SUSPEND — pull the doctor off Live-OPD and close any desk they have open.
    doctor.opdAccess = {
      ...access,
      status: 'SUSPENDED',
      reviewedAt: new Date(),
      reviewedBy: req.user.id as any,
      ...(adminNote ? { adminNote } : {}),
    };
    await closeOpenDesks(String(doctor._id));
  }

  await doctor.save();

  const messages: Record<string, string> = {
    APPROVE: `Live-OPD is now enabled on your account for up to ${doctor.opdAccess.approvedHoursPerDay}h per day.`,
    RESTORE: `Your Live-OPD access has been restored (${doctor.opdAccess.approvedHoursPerDay}h per day).`,
    REJECT: adminNote
      ? `Your Live-OPD request was declined: ${adminNote}`
      : 'Your Live-OPD request was declined. Please contact the admin team.',
    SUSPEND: adminNote
      ? `Your Live-OPD access has been suspended: ${adminNote}`
      : 'Your Live-OPD access has been suspended. Please contact the admin team.',
  };

  await createNotification({
    userId: String(doctor._id),
    role: 'doctor',
    type: 'GENERAL',
    title: 'Live-OPD access updated',
    message: messages[action],
  }).catch(() => undefined);

  res.status(200).json({
    success: true,
    message: `Doctor ${action.toLowerCase()}d for Live-OPD`,
    data: { doctorId: String(doctor._id), access: doctor.opdAccess },
  });
};

/** Ends any live/scheduled desk for a doctor who just lost access. */
async function closeOpenDesks(doctorId: string): Promise<void> {
  const open = await OpdSession.find({
    doctorId,
    status: { $in: ['LIVE', 'SCHEDULED'] },
  }).select('_id');
  if (open.length === 0) return;

  const ids = open.map((s) => s._id);
  await OpdSession.updateMany(
    { _id: { $in: ids } },
    { $set: { status: 'CANCELLED', endedAt: new Date() } }
  );
  await OpdConsultation.updateMany(
    { sessionId: { $in: ids }, status: { $in: ['WAITING', 'RINGING', 'IN_CALL'] } },
    { $set: { status: 'CANCELLED', endedAt: new Date() } }
  );
}

/* ─────────────────────────────────────────────
   GET /api/v1/admin/opd/live — who is on duty right now
───────────────────────────────────────────── */
export const getLiveOpdOverview = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();

  const sessions = await OpdSession.find({ status: 'LIVE' })
    .populate('doctorId', 'name specializations photoUrl')
    .lean();

  const counts = await OpdConsultation.aggregate<{ _id: unknown; count: number }>([
    {
      $match: {
        sessionId: { $in: sessions.map((s) => s._id) },
        status: { $in: ['WAITING', 'RINGING', 'IN_CALL'] },
      },
    },
    { $group: { _id: '$sessionId', count: { $sum: 1 } } },
  ]);
  const waiting = new Map(counts.map((c) => [String(c._id), c.count]));

  const today = new Date().toISOString().slice(0, 10);
  const [consultationsToday, approvedDoctors] = await Promise.all([
    OpdConsultation.countDocuments({
      status: 'COMPLETED',
      createdAt: { $gte: new Date(`${today}T00:00:00.000Z`) },
    }),
    Doctor.countDocuments({ 'opdAccess.status': 'APPROVED' }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      doctorsOnline: sessions.length,
      approvedDoctors,
      consultationsToday,
      patientsWaiting: [...waiting.values()].reduce((a, b) => a + b, 0),
      live: sessions.map((s) => ({
        sessionId: String(s._id),
        doctor: s.doctorId,
        startedAt: s.startedAt ?? null,
        window: `${s.startTime} - ${s.endTime}`,
        waiting: waiting.get(String(s._id)) ?? 0,
        consultationsDone: s.consultationsDone ?? 0,
      })),
    },
  });
};
