import type { Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import {
  Appointment,
  CLINIC_PAYMENT_METHODS,
  ONLINE_PAYMENT_METHODS,
  WALK_IN_SLOT,
  isSlotTaken,
  type IAppointment,
} from '../../models/Appointment';
import { ClinicCounter } from '../../models/ClinicCounter';
import { Doctor } from '../../models/Doctor';
import { Patient } from '../../models/Patient';
import type { AuthRequest } from '../../types';
import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { effectiveAvailability, nowInIndia, offeredSlots, slotMinutes } from '../../utils/availability';
import { toIndianMobile } from '../../utils/phone';
import { doctorPatientIds } from '../../services/careRelationship';
import { afterStatusChange } from '../../services/appointmentLifecycle';
import { createNotification } from '../../services/notification';

/* ─────────────────────────────────────────────
   Clinic desk: offline (walk-in / phone) bookings and the day's queue.
   A visit moves SCHEDULED → WAITING (checked in, has a token)
   → IN_CONSULTATION → DONE, or ends as NO_SHOW / CANCELLED.
───────────────────────────────────────────── */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS_AHEAD = 60;
const toPaise = (rupees: number) => Math.round(rupees * 100);
const toRupees = (paise?: number) => (paise ? paise / 100 : 0);

/**
 * The doctor whose desk a request acts on: the signed-in doctor, or — for the
 * admin front desk — a doctor the admin route has already checked and set.
 */
export type DeskRequest = AuthRequest & { deskDoctorId?: string; deskBy?: 'admin' };
const deskDoctor = (req: AuthRequest): string => (req as DeskRequest).deskDoctorId ?? req.user!.id;

type Stage = 'SCHEDULED' | 'WAITING' | 'IN_CONSULTATION' | 'DONE' | 'NO_SHOW' | 'CANCELLED';

function stageOf(a: Pick<IAppointment, 'status' | 'checkedInAt' | 'consultStartedAt'>): Stage {
  if (a.status === 'COMPLETED') return 'DONE';
  if (a.status === 'CANCELLED') return 'CANCELLED';
  if (a.status === 'NO_SHOW') return 'NO_SHOW';
  if (a.consultStartedAt) return 'IN_CONSULTATION';
  if (a.checkedInAt) return 'WAITING';
  return 'SCHEDULED';
}

export const STAGE_ORDER: Record<Stage, number> = {
  IN_CONSULTATION: 0,
  WAITING: 1,
  SCHEDULED: 2,
  DONE: 3,
  NO_SHOW: 4,
  CANCELLED: 5,
};

function daysBetween(fromIso: string, toIso: string) {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

function ageFrom(dob?: Date | null): number | undefined {
  if (!dob) return undefined;
  const years = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86_400_000));
  return years >= 0 && years < 130 ? years : undefined;
}

const last10 = (phone?: string | null) => String(phone ?? '').replace(/\D/g, '').slice(-10);

type PopulatedPatient = { _id: Types.ObjectId; name?: string; phone?: string; gender?: string; dateOfBirth?: Date } | null;

export function serialize(a: IAppointment & { _id: Types.ObjectId; createdAt?: Date }, defaultFee?: number) {
  // patientId is a populated patient on reads, a bare ObjectId right after create.
  const p = a.patientId as unknown as PopulatedPatient | Types.ObjectId;
  const linked = p && !(p instanceof Types.ObjectId) ? p : null;
  return {
    id: String(a._id),
    source: a.source ?? 'ONLINE',
    type: a.type,
    date: a.date,
    timeSlot: a.timeSlot,
    walkIn: a.timeSlot === WALK_IN_SLOT,
    status: a.status,
    stage: stageOf(a),
    token: a.token ?? null,
    checkedInAt: a.checkedInAt ?? null,
    consultStartedAt: a.consultStartedAt ?? null,
    completedAt: a.completedAt ?? null,
    reason: a.notes ?? null,
    patient: {
      id: linked ? String(linked._id) : a.patientId ? String(a.patientId) : null,
      hasAccount: !!a.patientId,
      name: a.guest?.name ?? linked?.name ?? 'Patient',
      phone: a.guest?.phone ?? linked?.phone ?? '',
      age: a.guest?.age ?? ageFrom(linked?.dateOfBirth),
      gender: a.guest?.gender ?? linked?.gender ?? null,
    },
    fee: a.price ?? defaultFee ?? null,
    payment: {
      status: a.paymentStatus,
      method: a.paymentMethod ?? null,
      amount: toRupees(a.amountPaid),
      paidAt: a.paidAt ?? null,
      atClinic: !!a.paymentMethod && (CLINIC_PAYMENT_METHODS as readonly string[]).includes(a.paymentMethod),
    },
  };
}

/** Atomic per-doctor, per-day token: 1, 2, 3 … */
async function nextToken(doctorId: string, date: string): Promise<number> {
  const id = `${doctorId}:${date}`;
  const expiresAt = new Date(Date.parse(`${date}T00:00:00Z`) + 3 * 86_400_000);
  const run = () =>
    ClinicCounter.findOneAndUpdate(
      { _id: id },
      { $inc: { seq: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, new: true, lean: true }
    );
  let doc;
  try {
    doc = await run();
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
    doc = await run();
  }
  return doc!.seq;
}

type SlotState = 'free' | 'app' | 'clinic' | 'past';
export type SlotCell = { slot: string; state: SlotState; name?: string };

/**
 * Every slot of the doctor's weekly hours for a date and who holds it, so the
 * desk can see why a time isn't free. Online booking can still be paused or the
 * day blocked — the desk books regardless; that's the doctor's call.
 * `ignoreId` leaves out one booking (the one being rescheduled).
 */
async function clinicSlotGrid(doctorId: string, date: string, ignoreId?: string): Promise<SlotCell[]> {
  const doctor = await Doctor.findById(doctorId).select('availability').lean();
  if (!doctor) throw new NotFoundError('Doctor');
  const a = { ...effectiveAvailability(doctor.availability), accepting: true, blockedDates: [] as string[] };
  const booked = await Appointment.find({
    doctorId,
    date,
    status: 'BOOKED',
    timeSlot: { $ne: WALK_IN_SLOT },
    ...(ignoreId && { _id: { $ne: ignoreId } }),
  })
    .select('timeSlot source guest patientId')
    .populate('patientId', 'name')
    .lean();
  const holder = new Map(booked.map((b) => [b.timeSlot, b]));
  const now = nowInIndia();
  return offeredSlots(a, date).map((slot) => {
    const b = holder.get(slot);
    if (b) {
      const p = b.patientId as unknown as { name?: string } | null;
      return { slot, state: b.source === 'OFFLINE' ? 'clinic' : 'app', name: b.guest?.name ?? p?.name ?? undefined };
    }
    if (date === now.date && slotMinutes(slot) < now.minutes - 15) return { slot, state: 'past' };
    return { slot, state: 'free' };
  });
}

async function clinicFreeSlots(doctorId: string, date: string, ignoreId?: string): Promise<string[]> {
  return (await clinicSlotGrid(doctorId, date, ignoreId)).filter((c) => c.state === 'free').map((c) => c.slot);
}

/** A registered patient with this phone, but only one who is already this doctor's patient. */
async function findLinkedPatient(doctorId: string, phone: string) {
  const ids = await doctorPatientIds(doctorId);
  if (!ids.length) return null;
  const want = last10(phone);
  const candidates = await Patient.find({ _id: { $in: ids } })
    .select('name phone verifiedPhone gender dateOfBirth')
    .lean();
  return candidates.find((c) => last10(c.verifiedPhone) === want || last10(c.phone) === want) ?? null;
}

/* ─────────────────────────────────────────────
   GET /api/v1/doctor/clinic/day?date=YYYY-MM-DD
   Every in-person visit for the day (app bookings and clinic bookings), queue-ordered.
───────────────────────────────────────────── */
export const getClinicDay = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const today = nowInIndia().date;
  const date = DATE_RE.test(String(req.query.date ?? '')) ? String(req.query.date) : today;

  const [doctor, rows] = await Promise.all([
    Doctor.findById(req.user.id).select('consultationFee').lean(),
    Appointment.find({ doctorId: req.user.id, date, type: { $ne: 'OPD' } })
      .populate('patientId', 'name phone gender dateOfBirth')
      .lean(),
  ]);

  const visits = rows
    .map((r) => serialize(r as never, doctor?.consultationFee))
    .sort((x, y) => {
      const s = STAGE_ORDER[x.stage] - STAGE_ORDER[y.stage];
      if (s) return s;
      if (x.token && y.token) return x.token - y.token;
      if (x.token || y.token) return x.token ? -1 : 1;
      const tx = x.walkIn ? -1 : slotMinutes(x.timeSlot);
      const ty = y.walkIn ? -1 : slotMinutes(y.timeSlot);
      return tx - ty;
    });

  const count = (s: Stage) => visits.filter((v) => v.stage === s).length;
  const collected = visits.filter((v) => v.payment.status === 'PAID' && v.payment.atClinic).reduce((n, v) => n + v.payment.amount, 0);
  const online = visits.filter((v) => v.payment.status === 'PAID' && !v.payment.atClinic).reduce((n, v) => n + v.payment.amount, 0);

  res.status(200).json({
    success: true,
    data: {
      date,
      isToday: date === today,
      defaultFee: doctor?.consultationFee ?? null,
      summary: {
        total: visits.filter((v) => v.stage !== 'CANCELLED').length,
        scheduled: count('SCHEDULED'),
        waiting: count('WAITING'),
        inConsultation: count('IN_CONSULTATION'),
        done: count('DONE'),
        noShow: count('NO_SHOW'),
        collectedAtClinic: collected,
        paidOnline: online,
      },
      visits,
    },
  });
};

/* GET /api/v1/doctor/clinic/slots?date=YYYY-MM-DD */
export const getClinicSlots = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const date = String(req.query.date ?? '');
  if (!DATE_RE.test(date)) throw new BadRequestError('date must be YYYY-MM-DD');
  const grid = await clinicSlotGrid(req.user.id, date);
  res.status(200).json({
    success: true,
    data: { date, slots: grid.filter((c) => c.state === 'free').map((c) => c.slot), grid },
  });
};

/* ─────────────────────────────────────────────
   GET /api/v1/doctor/clinic/lookup?phone=
   Prefills the booking form for a returning patient — only from this
   doctor's own clinic visits and their own existing patients.
───────────────────────────────────────────── */
export const lookupClinicPatient = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const phone = toIndianMobile(req.query.phone);

  const [lastVisit, visits, linked] = await Promise.all([
    Appointment.findOne({ doctorId: req.user.id, source: 'OFFLINE', 'guest.phone': phone })
      .sort({ createdAt: -1 })
      .select('guest date')
      .lean(),
    Appointment.countDocuments({ doctorId: req.user.id, source: 'OFFLINE', 'guest.phone': phone, status: 'COMPLETED' }),
    findLinkedPatient(req.user.id, phone),
  ]);

  res.status(200).json({
    success: true,
    data: {
      phone,
      found: !!(lastVisit || linked),
      name: lastVisit?.guest?.name ?? linked?.name ?? null,
      age: lastVisit?.guest?.age ?? ageFrom(linked?.dateOfBirth) ?? null,
      gender: lastVisit?.guest?.gender ?? linked?.gender ?? null,
      clinicVisits: visits,
      lastVisitDate: lastVisit?.date ?? null,
      hasAccount: !!linked,
    },
  });
};

export const createClinicBookingSchema = z.object({
  name: z.string().trim().min(2, 'Enter the patient name').max(80),
  phone: z.string().trim().min(10, 'Enter a 10-digit mobile number').max(20),
  age: z.coerce.number().int().min(0).max(120).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  reason: z.string().trim().max(300).optional(),
  date: z.string().regex(DATE_RE, 'date must be YYYY-MM-DD'),
  /** Omit for a walk-in seen today without a slot. */
  timeSlot: z.string().trim().max(20).optional(),
  type: z.enum(['CONSULTATION', 'CHECKUP']).default('CONSULTATION'),
  /** Rupees. Defaults to the doctor's consultation fee. */
  fee: z.coerce.number().min(0).max(100000).optional(),
  payment: z
    .object({
      method: z.enum(CLINIC_PAYMENT_METHODS),
      amount: z.coerce.number().positive().max(100000),
    })
    .optional(),
});

/* ─────────────────────────────────────────────
   POST /api/v1/doctor/clinic/bookings
   Walk-in (today, joins the queue straight away) or a phone booking for a slot.
───────────────────────────────────────────── */
export const createClinicBooking = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const doctorId = deskDoctor(req);
  const body = req.body as z.infer<typeof createClinicBookingSchema>;
  const phone = toIndianMobile(body.phone);
  const today = nowInIndia().date;

  const ahead = daysBetween(today, body.date);
  if (ahead < 0) throw new BadRequestError('Pick today or a future date');
  if (ahead > MAX_DAYS_AHEAD) throw new BadRequestError(`Bookings can be made up to ${MAX_DAYS_AHEAD} days ahead`);

  const walkIn = !body.timeSlot || body.timeSlot === WALK_IN_SLOT;
  if (walkIn && body.date !== today) throw new BadRequestError('Walk-ins are for today. Pick a time slot for another day.');
  if (!walkIn && !(await clinicFreeSlots(doctorId, body.date)).includes(body.timeSlot!)) {
    throw new ConflictError('That slot is no longer free. Pick another time.');
  }

  const doctor = await Doctor.findById(doctorId).select('name consultationFee').lean();
  if (!doctor) throw new NotFoundError('Doctor');
  const fee = body.fee ?? doctor.consultationFee ?? undefined;
  const linked = await findLinkedPatient(doctorId, phone);

  const now = new Date();
  let appt;
  try {
    appt = await Appointment.create({
      doctorId,
      patientId: linked?._id,
      source: 'OFFLINE',
      guest: { name: body.name, phone, age: body.age, gender: body.gender },
      type: body.type,
      price: fee,
      date: body.date,
      timeSlot: walkIn ? WALK_IN_SLOT : body.timeSlot,
      notes: body.reason || undefined,
      status: 'BOOKED',
      ...(walkIn && { checkedInAt: now, token: await nextToken(doctorId, body.date) }),
      ...(body.payment && {
        paymentStatus: 'PAID',
        paymentMethod: body.payment.method,
        amountPaid: toPaise(body.payment.amount),
        paidAt: now,
      }),
    });
  } catch (err) {
    // The app (or another desk) took this slot a moment ago.
    if (isSlotTaken(err)) throw new ConflictError('That slot was just booked. Pick another time.');
    throw err;
  }

  if (linked) {
    await createNotification({
      userId: linked._id,
      role: 'patient',
      type: 'GENERAL',
      title: walkIn ? 'Checked in at the clinic' : 'Clinic visit booked',
      message: walkIn
        ? `You're checked in with ${doctor.name ?? 'your doctor'}. Your token is ${appt.token}.`
        : `${doctor.name ?? 'Your doctor'} booked your clinic visit for ${body.date} at ${body.timeSlot}.`,
    }).catch(() => undefined);
  }

  if ((req as DeskRequest).deskBy === 'admin') {
    await createNotification({
      userId: doctorId,
      role: 'doctor',
      type: 'GENERAL',
      title: 'New walk-in from the front desk',
      message: `${body.name} is waiting${walkIn ? ` — token ${appt.token}` : ''}${body.reason ? ` (${body.reason})` : ''}.`,
    }).catch(() => undefined);
  }

  res.status(201).json({
    success: true,
    message: walkIn ? `Added to the queue — token ${appt.token}` : 'Visit booked',
    data: { visit: serialize(appt.toObject() as never, doctor.consultationFee) },
  });
};

export const visitActionSchema = z.object({
  action: z.enum(['CHECK_IN', 'UNDO_CHECK_IN', 'START', 'COMPLETE', 'NO_SHOW', 'RESTORE', 'CANCEL']),
});

/* ─────────────────────────────────────────────
   PATCH /api/v1/doctor/clinic/bookings/:id/visit  { action }
   Works for app bookings too, so the whole day runs from one queue.
───────────────────────────────────────────── */
export const updateVisit = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  if (!Types.ObjectId.isValid(req.params.id)) throw new NotFoundError('Visit');
  const { action } = req.body as z.infer<typeof visitActionSchema>;

  const current = await Appointment.findOne({ _id: req.params.id, doctorId: deskDoctor(req), type: { $ne: 'OPD' } }).lean();
  if (!current) throw new NotFoundError('Visit');
  const today = nowInIndia().date;
  const now = new Date();
  const onlinePaid =
    current.paymentStatus === 'PAID' && !!current.paymentMethod && ONLINE_PAYMENT_METHODS.includes(current.paymentMethod);

  const needBooked = () => {
    if (current.status !== 'BOOKED') throw new BadRequestError('This visit is already closed');
  };
  const needToday = () => {
    if (current.date !== today) throw new BadRequestError('Patients can only be checked in on the day of the visit');
  };

  let set: Record<string, unknown> = {};
  let unset: Record<string, 1> = {};
  switch (action) {
    case 'CHECK_IN':
      needBooked();
      needToday();
      if (current.checkedInAt) throw new BadRequestError('Already checked in');
      set = { checkedInAt: now, ...(!current.token && { token: await nextToken(deskDoctor(req), current.date) }) };
      break;
    case 'UNDO_CHECK_IN':
      needBooked();
      if (!current.checkedInAt || current.consultStartedAt) throw new BadRequestError('Nothing to undo');
      unset = { checkedInAt: 1 };
      break;
    case 'START':
      needBooked();
      needToday();
      if (current.consultStartedAt) throw new BadRequestError('Consultation already started');
      set = {
        consultStartedAt: now,
        ...(!current.checkedInAt && { checkedInAt: now }),
        ...(!current.token && { token: await nextToken(deskDoctor(req), current.date) }),
      };
      break;
    case 'COMPLETE':
      needBooked();
      set = { status: 'COMPLETED', completedAt: now, ...(!current.consultStartedAt && { consultStartedAt: now }) };
      break;
    case 'NO_SHOW':
      needBooked();
      if (current.consultStartedAt) throw new BadRequestError('The consultation has started — finish it instead');
      if (onlinePaid) throw new BadRequestError('This patient paid online. Cancel the visit to refund them, or mark it complete.');
      set = { status: 'NO_SHOW' };
      break;
    case 'RESTORE':
      if (current.status !== 'NO_SHOW') throw new BadRequestError('Only a no-show can be restored');
      if (
        current.timeSlot !== WALK_IN_SLOT &&
        (await Appointment.exists({ doctorId: deskDoctor(req), date: current.date, timeSlot: current.timeSlot, status: 'BOOKED' }))
      ) {
        throw new ConflictError('Someone else has this slot now. Book the patient again as a walk-in.');
      }
      set = { status: 'BOOKED' };
      break;
    case 'CANCEL':
      needBooked();
      set = { status: 'CANCELLED' };
      break;
  }

  const update: Record<string, unknown> = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;

  // Matching on the status we read means two taps (or two staff) can't both apply.
  let appt;
  try {
    appt = await Appointment.findOneAndUpdate({ _id: current._id, status: current.status }, update, { new: true })
      .populate('patientId', 'name phone gender dateOfBirth')
      .lean();
  } catch (err) {
    if (isSlotTaken(err)) throw new ConflictError('Someone else has this slot now. Book the patient again as a walk-in.');
    throw err;
  }
  if (!appt) throw new ConflictError('This visit was just updated — refresh and try again');

  if (action === 'COMPLETE' || action === 'CANCEL') await afterStatusChange(appt as never);

  const doctor = await Doctor.findById(deskDoctor(req)).select('consultationFee').lean();
  res.status(200).json({ success: true, data: { visit: serialize(appt as never, doctor?.consultationFee) } });
};

export const clinicPaymentSchema = z.object({
  method: z.enum(CLINIC_PAYMENT_METHODS),
  amount: z.coerce.number().positive().max(100000),
});

/* POST /api/v1/doctor/clinic/bookings/:id/payment  { method, amount } — fee collected at the desk. */
export const recordClinicPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  if (!Types.ObjectId.isValid(req.params.id)) throw new NotFoundError('Visit');
  const { method, amount } = req.body as z.infer<typeof clinicPaymentSchema>;

  const appt = await Appointment.findOneAndUpdate(
    {
      _id: req.params.id,
      doctorId: deskDoctor(req),
      type: { $ne: 'OPD' },
      status: { $in: ['BOOKED', 'COMPLETED'] },
      paymentStatus: 'UNPAID',
    },
    { $set: { paymentStatus: 'PAID', paymentMethod: method, amountPaid: toPaise(amount), paidAt: new Date() } },
    { new: true }
  )
    .populate('patientId', 'name phone gender dateOfBirth')
    .lean();
  if (!appt) throw new BadRequestError('This visit is already paid or closed');

  const doctor = await Doctor.findById(deskDoctor(req)).select('consultationFee').lean();
  res.status(200).json({ success: true, message: 'Payment recorded', data: { visit: serialize(appt as never, doctor?.consultationFee) } });
};

/* DELETE /api/v1/doctor/clinic/bookings/:id/payment — undo a desk payment entered by mistake. */
export const undoClinicPayment = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  if (!Types.ObjectId.isValid(req.params.id)) throw new NotFoundError('Visit');

  const appt = await Appointment.findOneAndUpdate(
    // Only desk payments: platform payments are undone by cancelling (which refunds).
    { _id: req.params.id, doctorId: deskDoctor(req), paymentStatus: 'PAID', paymentMethod: { $in: CLINIC_PAYMENT_METHODS } },
    { $set: { paymentStatus: 'UNPAID' }, $unset: { paymentMethod: 1, amountPaid: 1, paidAt: 1 } },
    { new: true }
  )
    .populate('patientId', 'name phone gender dateOfBirth')
    .lean();
  if (!appt) throw new BadRequestError('No clinic payment to undo on this visit');

  const doctor = await Doctor.findById(deskDoctor(req)).select('consultationFee').lean();
  res.status(200).json({ success: true, message: 'Payment removed', data: { visit: serialize(appt as never, doctor?.consultationFee) } });
};

export const rescheduleSchema = z.object({
  date: z.string().regex(DATE_RE, 'date must be YYYY-MM-DD'),
  timeSlot: z.string().trim().min(4).max(20),
});

/* ─────────────────────────────────────────────
   PATCH /api/v1/doctor/clinic/bookings/:id/reschedule  { date, timeSlot }
   Moves an app or clinic booking (or turns a walk-in that hasn't arrived into a
   slot booking). The unique slot index is the final word if two people grab the
   same slot at once.
───────────────────────────────────────────── */
export const rescheduleVisit = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  if (!Types.ObjectId.isValid(req.params.id)) throw new NotFoundError('Visit');
  const { date, timeSlot } = req.body as z.infer<typeof rescheduleSchema>;

  const current = await Appointment.findOne({ _id: req.params.id, doctorId: req.user.id, type: { $ne: 'OPD' } }).lean();
  if (!current) throw new NotFoundError('Visit');
  if (current.status !== 'BOOKED') throw new BadRequestError('Only upcoming visits can be moved');
  if (current.checkedInAt) throw new BadRequestError('This patient is already checked in. Finish or cancel the visit instead.');
  if (current.date === date && current.timeSlot === timeSlot) throw new BadRequestError('Pick a different time');

  const ahead = daysBetween(nowInIndia().date, date);
  if (ahead < 0) throw new BadRequestError('Pick today or a future date');
  if (ahead > MAX_DAYS_AHEAD) throw new BadRequestError(`Visits can be moved up to ${MAX_DAYS_AHEAD} days ahead`);
  if (!(await clinicFreeSlots(req.user.id, date, String(current._id))).includes(timeSlot)) {
    throw new ConflictError('That slot is not free. Pick another time.');
  }

  let appt;
  try {
    appt = await Appointment.findOneAndUpdate(
      { _id: current._id, status: 'BOOKED', date: current.date, timeSlot: current.timeSlot },
      { $set: { date, timeSlot, holdsSlot: true }, $unset: { token: 1 } },
      { new: true }
    )
      .populate('patientId', 'name phone gender dateOfBirth')
      .lean();
  } catch (err) {
    if (isSlotTaken(err)) throw new ConflictError('That slot was just booked. Pick another time.');
    throw err;
  }
  if (!appt) throw new ConflictError('This visit was just updated — refresh and try again');

  const patientId = current.patientId ? String(current.patientId) : null;
  if (patientId) {
    const doctor = await Doctor.findById(req.user.id).select('name').lean();
    await createNotification({
      userId: patientId,
      role: 'patient',
      type: 'GENERAL',
      title: 'Appointment rescheduled',
      message: `${doctor?.name ?? 'Your doctor'} moved your visit from ${current.date}, ${current.timeSlot} to ${date}, ${timeSlot}. Cancel from Appointments if the new time doesn't suit you.`,
    }).catch(() => undefined);
  }

  const doctor = await Doctor.findById(req.user.id).select('consultationFee').lean();
  res.status(200).json({
    success: true,
    message: patientId ? 'Visit moved — the patient has been notified' : 'Visit moved',
    data: { visit: serialize(appt as never, doctor?.consultationFee) },
  });
};

export const editVisitSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    age: z.coerce.number().int().min(0).max(120).nullable().optional(),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']).nullable().optional(),
    reason: z.string().trim().max(300).optional(),
    fee: z.coerce.number().min(0).max(100000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/* ─────────────────────────────────────────────
   PATCH /api/v1/doctor/clinic/bookings/:id  — fix details of a clinic booking.
   App bookings belong to the patient's account, so only clinic ones are editable.
───────────────────────────────────────────── */
export const editClinicVisit = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  if (!Types.ObjectId.isValid(req.params.id)) throw new NotFoundError('Visit');
  const body = req.body as z.infer<typeof editVisitSchema>;

  const current = await Appointment.findOne({ _id: req.params.id, doctorId: req.user.id, source: 'OFFLINE' }).lean();
  if (!current) throw new NotFoundError('Clinic visit');
  if (body.fee !== undefined && current.paymentStatus !== 'UNPAID') {
    throw new BadRequestError('The fee is already collected. Undo the payment first to change it.');
  }

  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (body.name !== undefined) set['guest.name'] = body.name;
  if (body.age !== undefined) body.age === null ? (unset['guest.age'] = 1) : (set['guest.age'] = body.age);
  if (body.gender !== undefined) body.gender === null ? (unset['guest.gender'] = 1) : (set['guest.gender'] = body.gender);
  if (body.reason !== undefined) body.reason ? (set.notes = body.reason) : (unset.notes = 1);
  if (body.fee !== undefined) set.price = body.fee;

  const appt = await Appointment.findOneAndUpdate(
    { _id: current._id },
    { ...(Object.keys(set).length && { $set: set }), ...(Object.keys(unset).length && { $unset: unset }) },
    { new: true, runValidators: true }
  )
    .populate('patientId', 'name phone gender dateOfBirth')
    .lean();
  if (!appt) throw new NotFoundError('Clinic visit');

  const doctor = await Doctor.findById(req.user.id).select('consultationFee').lean();
  res.status(200).json({ success: true, message: 'Details saved', data: { visit: serialize(appt as never, doctor?.consultationFee) } });
};
