import crypto from 'crypto';
import { Doctor, type IOpdAccess } from '../models/Doctor';
import { OPEN_CONSULTATION_STATES, OpdConsultation } from '../models/OpdConsultation';
import { createNotification } from './notification';
import { OpdSession } from '../models/OpdSession';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/AppError';

/** Doctor-facing fields patients see on an OPD card. */
export const OPD_DOCTOR_FIELDS = 'name specializations consultationFee photoUrl yearsExperience';

/** A room name no one can guess, so a leaked consultation id isn't enough to join. */
export function newRoomName(): string {
  return `opd_${crypto.randomBytes(12).toString('hex')}`;
}

/** "HH:mm" → minutes since midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new BadRequestError('Times must be in HH:mm 24-hour format');
  }
  return h * 60 + m;
}

/** Session length in hours, handling a window that crosses midnight. */
export function sessionHours(startTime: string, endTime: string): number {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const span = end > start ? end - start : end + 24 * 60 - start;
  return span / 60;
}

/**
 * Only a doctor admin has cleared for Live-OPD may run a desk. Everyone else is
 * told to talk to admin, which is the whole point of the approval flow.
 */
export async function requireOpdAccess(doctorId: string): Promise<IOpdAccess> {
  const doctor = await Doctor.findById(doctorId).select('opdAccess kycStatus').lean();
  if (!doctor) throw new NotFoundError('Doctor');

  const access = doctor.opdAccess ?? { status: 'NOT_REQUESTED' as const };

  if (access.status === 'APPROVED') return access;

  if (access.status === 'PENDING') {
    throw new ForbiddenError('Your Live-OPD request is still with the admin team');
  }
  if (access.status === 'SUSPENDED') {
    throw new ForbiddenError(
      access.adminNote
        ? `Your Live-OPD access is suspended: ${access.adminNote}`
        : 'Your Live-OPD access is suspended — please contact the admin team'
    );
  }
  if (access.status === 'REJECTED') {
    throw new ForbiddenError(
      access.adminNote
        ? `Your Live-OPD request was declined: ${access.adminNote}`
        : 'Your Live-OPD request was declined — please contact the admin team'
    );
  }
  throw new ForbiddenError(
    'Live-OPD is not enabled on your account. Request access and the admin team will set your hours.'
  );
}

/**
 * Keep a doctor inside the daily hour budget admin granted. Counts every
 * session they already have on that date that isn't cancelled.
 */
export async function assertWithinHourBudget(
  doctorId: string,
  access: IOpdAccess,
  date: string,
  startTime: string,
  endTime: string,
  excludeSessionId?: string
): Promise<void> {
  const hours = sessionHours(startTime, endTime);
  if (hours <= 0) throw new BadRequestError('End time must be after start time');

  const budget = access.approvedHoursPerDay ?? 0;
  if (budget <= 0) {
    throw new ForbiddenError('Admin has not set your daily Live-OPD hours yet');
  }
  if (hours > budget) {
    throw new BadRequestError(
      `That session is ${hours.toFixed(1)}h long — admin approved ${budget}h of OPD per day.`
    );
  }

  const sameDay = await OpdSession.find({
    doctorId,
    date,
    status: { $ne: 'CANCELLED' },
    ...(excludeSessionId ? { _id: { $ne: excludeSessionId } } : {}),
  })
    .select('startTime endTime')
    .lean();

  const used = sameDay.reduce((sum, s) => sum + sessionHours(s.startTime, s.endTime), 0);
  if (used + hours > budget) {
    throw new BadRequestError(
      `You already have ${used.toFixed(1)}h of OPD scheduled on ${date}. Your approved limit is ${budget}h per day.`
    );
  }
}

/**
 * How long a doctor's desk rings before the patient is told to try again.
 * Emergency-style: connect fast or fail honestly — never leave someone staring
 * at a spinner.
 */
export const RING_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Expire any request whose ring window has run out.
 *
 * Done lazily on every read instead of with a cron job: the states that matter
 * are only ever observed through these endpoints, so a sweep here is both
 * cheap and always-correct — and there's no scheduler to deploy or babysit.
 */
export async function expireStaleRings(): Promise<void> {
  const stale = await OpdConsultation.find({
    status: 'RINGING',
    ringExpiresAt: { $ne: null, $lt: new Date() },
  })
    .select('_id doctorId')
    .lean();

  if (stale.length === 0) return;

  await OpdConsultation.updateMany(
    { _id: { $in: stale.map((c) => c._id) } },
    { $set: { status: 'EXPIRED', endedAt: new Date() } }
  );

  // Tell the doctor they let one go by — this is how they learn to answer fast.
  await Promise.all(
    stale.map((c) =>
      createNotification({
        userId: String(c.doctorId),
        role: 'doctor',
        type: 'GENERAL',
        title: 'Missed an OPD call',
        message: 'A patient waited 2 minutes and gave up. Please accept calls promptly while live.',
      }).catch(() => undefined)
    )
  );
}

export type LiveDesk = {
  sessionId: string;
  doctorId: string;
  waiting: number;
  /** True when the doctor is mid-call with someone else. */
  busy: boolean;
};

/**
 * Every OPD desk that is live this instant, with its current load.
 *
 * "Live" means the doctor pressed Go Live (status LIVE) — not merely that the
 * clock is inside a scheduled window. A scheduled session with nobody sitting at
 * it would leave patients ringing an empty room.
 */
export async function liveDesks(): Promise<LiveDesk[]> {
  // Clear timed-out rings first, or a doctor stays "busy" on a dead request.
  await expireStaleRings();

  const sessions = await OpdSession.find({ status: 'LIVE' }).select('_id doctorId').lean();
  if (sessions.length === 0) return [];

  const counts = await OpdConsultation.aggregate<{
    _id: { sessionId: unknown; status: string };
    count: number;
  }>([
    {
      $match: {
        sessionId: { $in: sessions.map((s) => s._id) },
        status: { $in: OPEN_CONSULTATION_STATES },
      },
    },
    { $group: { _id: { sessionId: '$sessionId', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const waitingBySession = new Map<string, number>();
  const busySessions = new Set<string>();
  for (const row of counts) {
    const key = String(row._id.sessionId);
    if (row._id.status === 'WAITING') {
      waitingBySession.set(key, (waitingBySession.get(key) ?? 0) + row.count);
    } else {
      // RINGING or IN_CALL — the doctor's attention is already taken.
      busySessions.add(key);
      waitingBySession.set(key, waitingBySession.get(key) ?? 0);
    }
  }

  return sessions.map((s) => ({
    sessionId: String(s._id),
    doctorId: String(s.doctorId),
    waiting: waitingBySession.get(String(s._id)) ?? 0,
    busy: busySessions.has(String(s._id)),
  }));
}

/**
 * Pick the desk a walk-in patient should be routed to: fewest people waiting,
 * and among equals prefer a doctor who isn't already on a call. Returns null
 * when no doctor is live — the caller turns that into a friendly message.
 */
export function pickLeastBusy(desks: LiveDesk[]): LiveDesk | null {
  if (desks.length === 0) return null;
  return [...desks].sort(
    (a, b) => a.waiting - b.waiting || Number(a.busy) - Number(b.busy)
  )[0];
}

/** Rough wait estimate for the patient, at ~8 minutes a consultation. */
export const AVG_CONSULT_MINUTES = 8;

export function estimateWaitMinutes(position: number, busy: boolean): number {
  const ahead = Math.max(0, position - 1);
  return ahead * AVG_CONSULT_MINUTES + (busy ? Math.ceil(AVG_CONSULT_MINUTES / 2) : 0);
}
