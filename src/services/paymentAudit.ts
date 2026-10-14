import { Types } from 'mongoose';
import { Doctor } from '../models/Doctor';
import { Patient } from '../models/Patient';
import { PaymentAudit, type AuditActor, type PaymentAuditEvent } from '../models/PaymentAudit';
import type { AdminRequest } from '../middleware/adminAccess';
import type { AuthRequest } from '../types';
import { logger } from '../utils/logger';

/**
 * Who is acting at the desk: the admin (front desk / admin) when the request
 * came through the admin walk-in routes, otherwise the signed-in doctor.
 */
export async function deskActor(req: AuthRequest): Promise<AuditActor> {
  const r = req as AdminRequest & { deskBy?: 'admin' };
  if (r.deskBy === 'admin' && r.admin) {
    return { kind: 'admin', id: new Types.ObjectId(r.admin.id), name: r.admin.name, role: r.admin.role };
  }
  const doctor = await Doctor.findById(req.user!.id).select('name').lean();
  return { kind: 'doctor', id: new Types.ObjectId(req.user!.id), name: doctor?.name ?? 'Doctor' };
}

type Visit = {
  _id: unknown;
  doctorId: unknown;
  date: string;
  guest?: { name?: string } | null;
  patientId?: unknown;
};

/**
 * Appends one entry to the trail. The money change it describes is already
 * saved, so a failure here is logged loudly rather than failing the request.
 */
export async function auditPayment(
  visit: Visit,
  actor: AuditActor,
  entry: { event: PaymentAuditEvent; method?: string | null; amount: number; refunded?: number }
): Promise<void> {
  try {
    // App bookings have no guest name; use the patient's (populated or looked up).
    let patientName = visit.guest?.name ?? (visit.patientId as { name?: string } | undefined)?.name;
    if (!patientName && visit.patientId) {
      patientName = (await Patient.findById(visit.patientId).select('name').lean())?.name;
    }
    await PaymentAudit.create({
      appointmentId: visit._id,
      doctorId: (visit.doctorId as { _id?: unknown })?._id ?? visit.doctorId,
      visitDate: visit.date,
      patientName: patientName ?? 'Patient',
      event: entry.event,
      method: entry.method ?? undefined,
      amount: entry.amount,
      refunded: entry.refunded || undefined,
      actor,
    });
  } catch (err) {
    logger.error({ err, appointmentId: String(visit._id), entry, actor }, 'AUDIT: payment audit entry was not saved');
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;
const MAX_ROWS = 1000;
const toRupees = (paise?: number) => (paise ? paise / 100 : 0);

/** Reads `from`/`to` (YYYY-MM-DD, India time) — defaults to today, at most 31 days. */
export function auditRange(query: Record<string, unknown>, today: string): { from: string; to: string; start: Date; end: Date } {
  const to = DATE_RE.test(String(query.to ?? '')) ? String(query.to) : today;
  const from = DATE_RE.test(String(query.from ?? '')) ? String(query.from) : to;
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 864e5);
  if (start >= end) throw new Error('`from` must be on or before `to`');
  if (end.getTime() - start.getTime() > MAX_DAYS * 864e5) throw new Error(`Pick at most ${MAX_DAYS} days`);
  return { from, to, start, end };
}

/** Trail rows in a time range, newest first, plus net desk collections per method and per person. */
export async function loadAudit(doctorIds: string[] | null, start: Date, end: Date) {
  const rows = await PaymentAudit.find({
    createdAt: { $gte: start, $lt: end },
    ...(doctorIds && { doctorId: { $in: doctorIds } }),
  })
    .sort({ createdAt: -1 })
    .limit(MAX_ROWS)
    .populate('doctorId', 'name')
    .lean();

  const entries = rows.map((r) => {
    const doc = r.doctorId as unknown as { _id: Types.ObjectId; name?: string } | null;
    return {
      id: String(r._id),
      at: r.createdAt,
      event: r.event,
      method: r.method ?? null,
      amount: toRupees(r.amount),
      refunded: toRupees(r.refunded),
      patientName: r.patientName,
      visitDate: r.visitDate,
      appointmentId: String(r.appointmentId),
      doctor: doc?._id ? { id: String(doc._id), name: doc.name ?? 'Doctor' } : null,
      actor: { kind: r.actor.kind, name: r.actor.name, role: r.actor.role ?? null },
    };
  });

  // Desk money only: recorded minus undone. Online refunds are reported separately.
  const byMethod: Record<string, number> = {};
  const byActor = new Map<string, { name: string; kind: string; role: string | null; net: number; entries: number }>();
  let refunded = 0;
  for (const [i, e] of entries.entries()) {
    const sign = e.event === 'RECORDED' ? 1 : e.event === 'UNDONE' ? -1 : 0;
    if (sign && e.method) byMethod[e.method] = (byMethod[e.method] ?? 0) + sign * e.amount;
    refunded += e.refunded;
    const key = `${e.actor.kind}:${String(rows[i].actor.id)}`;
    const a = byActor.get(key) ?? { name: e.actor.name, kind: e.actor.kind, role: e.actor.role, net: 0, entries: 0 };
    a.net += sign * e.amount;
    a.entries += 1;
    byActor.set(key, a);
  }

  return {
    entries,
    truncated: rows.length === MAX_ROWS,
    summary: {
      collected: Object.values(byMethod).reduce((n, v) => n + v, 0),
      byMethod,
      refunded,
      undone: entries.filter((e) => e.event === 'UNDONE').length,
      byActor: [...byActor.values()].sort((x, y) => y.net - x.net),
    },
  };
}
