import type { NextFunction, Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { Appointment } from '../../models/Appointment';
import { Clinic } from '../../models/Clinic';
import { Doctor } from '../../models/Doctor';
import { type AdminRequest, deskScope, doctorIdsForClinics } from '../../middleware/adminAccess';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../utils/AppError';
import { nowInIndia } from '../../utils/availability';
import {
  STAGE_ORDER,
  createClinicBookingSchema,
  serialize,
  type DeskRequest,
} from '../doctor/clinic.controller';

/* ─────────────────────────────────────────────
   Admin front desk (walk-ins).
   Walk-ins are ordinary clinic-desk visits on the chosen doctor's queue, so the
   doctor sees them on their Clinic desk straight away and tokens never clash.
   The admin routes only pick the doctor; the clinic handlers do the rest.
   Front-desk accounts only ever see and touch the doctors of their own clinics.
───────────────────────────────────────────── */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 500;

/** Doctors a walk-in can be sent to: verified and not removed. */
const deskDoctorFilter = { kycStatus: 'APPROVED', removedAt: null } as const;

/* GET /api/v1/admin/walkins/doctors — who can take walk-ins today, with their queue size. */
export const listWalkinDoctors = async (req: AdminRequest, res: Response): Promise<void> => {
  const today = nowInIndia().date;
  const scope = await deskScope(req);
  const doctors = await Doctor.find({ ...deskDoctorFilter, ...(scope && { _id: { $in: scope } }) })
    .select('name specializations consultationFee clinicId')
    .populate('clinicId', 'name')
    .sort({ name: 1 })
    .limit(MAX_ROWS)
    .lean();

  const queues = await Appointment.aggregate<{ _id: Types.ObjectId; waiting: number; withDoctor: number }>([
    {
      $match: {
        doctorId: { $in: doctors.map((d) => d._id) },
        date: today,
        type: { $ne: 'OPD' },
        status: 'BOOKED',
        checkedInAt: { $ne: null },
      },
    },
    {
      $group: {
        _id: '$doctorId',
        waiting: { $sum: { $cond: [{ $ifNull: ['$consultStartedAt', false] }, 0, 1] } },
        withDoctor: { $sum: { $cond: [{ $ifNull: ['$consultStartedAt', false] }, 1, 0] } },
      },
    },
  ]);
  const byDoctor = new Map(queues.map((q) => [String(q._id), q]));

  type ClinicRef = { _id: Types.ObjectId; name?: string } | null;
  const clinicOf = (d: (typeof doctors)[number]) => {
    const c = d.clinicId as unknown as ClinicRef;
    return c?._id ? { id: String(c._id), name: c.name?.trim() || 'Clinic' } : null;
  };
  // A front desk sees its own clinics even before any doctor there is verified.
  const clinics = new Map<string, { id: string; name: string }>();
  if (scope) {
    const own = await Clinic.find({ _id: { $in: req.admin!.clinicIds } }).select('name').lean();
    own.forEach((c) => clinics.set(String(c._id), { id: String(c._id), name: c.name?.trim() || 'Clinic' }));
  }
  doctors.forEach((d) => {
    const c = clinicOf(d);
    if (c) clinics.set(c.id, c);
  });

  res.status(200).json({
    success: true,
    data: {
      doctors: doctors.map((d) => ({
        id: String(d._id),
        name: d.name ?? 'Doctor',
        specializations: d.specializations ?? [],
        consultationFee: d.consultationFee ?? null,
        clinic: clinicOf(d),
        waiting: byDoctor.get(String(d._id))?.waiting ?? 0,
        withDoctor: byDoctor.get(String(d._id))?.withDoctor ?? 0,
      })),
      clinics: [...clinics.values()].sort((a, b) => a.name.localeCompare(b.name)),
      restricted: !!scope,
    },
  });
};

/* GET /api/v1/admin/walkins?date=YYYY-MM-DD&doctorId=&clinicId= — the day's in-clinic visits across doctors. */
export const listWalkins = async (req: AdminRequest, res: Response): Promise<void> => {
  const today = nowInIndia().date;
  const date = DATE_RE.test(String(req.query.date ?? '')) ? String(req.query.date) : today;
  const doctorId = String(req.query.doctorId ?? '');
  const clinicId = String(req.query.clinicId ?? '');
  if (doctorId && !Types.ObjectId.isValid(doctorId)) throw new BadRequestError('Invalid doctor');
  if (clinicId && !Types.ObjectId.isValid(clinicId)) throw new BadRequestError('Invalid clinic');

  // Narrow step by step: the admin's own scope, then the clinic, then the doctor.
  let allowed = await deskScope(req);
  if (clinicId) {
    const atClinic = await doctorIdsForClinics([clinicId]);
    allowed = allowed ? allowed.filter((id) => atClinic.includes(id)) : atClinic;
  }
  if (doctorId) allowed = !allowed || allowed.includes(doctorId) ? [doctorId] : [];

  const rows = await Appointment.find({
    date,
    type: { $ne: 'OPD' },
    ...(allowed && { doctorId: { $in: allowed } }),
  })
    .populate('patientId', 'name phone gender dateOfBirth')
    .populate('doctorId', 'name specializations consultationFee')
    .limit(MAX_ROWS)
    .lean();

  type DoctorRef = { _id: Types.ObjectId; name?: string; specializations?: string[]; consultationFee?: number };
  const visits = rows
    .map((r) => {
      const doc = r.doctorId as unknown as DoctorRef | null;
      return {
        ...serialize(r as never, doc?.consultationFee),
        doctor: doc ? { id: String(doc._id), name: doc.name ?? 'Doctor', specialization: doc.specializations?.[0] ?? null } : null,
      };
    })
    .sort((x, y) => {
      const s = STAGE_ORDER[x.stage] - STAGE_ORDER[y.stage];
      if (s) return s;
      const tx = x.checkedInAt ? new Date(x.checkedInAt).getTime() : Infinity;
      const ty = y.checkedInAt ? new Date(y.checkedInAt).getTime() : Infinity;
      if (tx !== ty) return tx - ty;
      return x.timeSlot.localeCompare(y.timeSlot);
    });

  const count = (stage: string) => visits.filter((v) => v.stage === stage).length;
  res.status(200).json({
    success: true,
    data: {
      date,
      isToday: date === today,
      summary: {
        total: visits.filter((v) => v.stage !== 'CANCELLED').length,
        scheduled: count('SCHEDULED'),
        waiting: count('WAITING'),
        inConsultation: count('IN_CONSULTATION'),
        done: count('DONE'),
        noShow: count('NO_SHOW'),
        collectedAtClinic: visits
          .filter((v) => v.payment.status === 'PAID' && v.payment.atClinic)
          .reduce((n, v) => n + v.payment.amount, 0),
      },
      visits,
    },
  });
};

/** A walk-in the front desk adds: always today, always straight into the queue. */
export const adminWalkinSchema = createClinicBookingSchema
  .omit({ date: true, timeSlot: true })
  .extend({ doctorId: z.string().refine((v) => Types.ObjectId.isValid(v), 'Pick a doctor') });

/**
 * POST /api/v1/admin/walkins — checks the chosen doctor can take patients, then
 * hands over to the clinic-desk booking as that doctor's desk.
 */
export const prepareWalkin = async (req: AdminRequest, _res: Response, next: NextFunction): Promise<void> => {
  const { doctorId, ...rest } = req.body as z.infer<typeof adminWalkinSchema>;
  const scope = await deskScope(req);
  if (scope && !scope.includes(String(doctorId))) throw new ForbiddenError('This doctor is not at your clinic');
  const doctor = await Doctor.exists({ _id: doctorId, ...deskDoctorFilter });
  if (!doctor) throw new BadRequestError('This doctor is not available for walk-ins');

  req.body = { ...rest, date: nowInIndia().date };
  Object.assign(req as DeskRequest, { deskDoctorId: String(doctorId), deskBy: 'admin' });
  next();
};

/**
 * /api/v1/admin/walkins/:id/... — acts on the visit as its own doctor's desk, so every
 * rule of the clinic desk (stages, tokens, slot locks, refunds) applies unchanged.
 */
export const loadWalkinDesk = async (req: AdminRequest, _res: Response, next: NextFunction): Promise<void> => {
  if (!Types.ObjectId.isValid(req.params.id)) throw new NotFoundError('Visit');
  const visit = await Appointment.findOne({ _id: req.params.id, type: { $ne: 'OPD' } }).select('doctorId').lean();
  const scope = await deskScope(req);
  // Another clinic's visit looks exactly like a missing one.
  if (!visit || (scope && !scope.includes(String(visit.doctorId)))) throw new NotFoundError('Visit');

  Object.assign(req as DeskRequest, { deskDoctorId: String(visit.doctorId), deskBy: 'admin' });
  next();
};
