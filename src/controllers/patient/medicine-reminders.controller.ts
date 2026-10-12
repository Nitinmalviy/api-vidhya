import type { Response } from 'express';
import { MedicineReminder } from '../../models/MedicineReminder';
import { MedicineDoseLog } from '../../models/MedicineDoseLog';
import type { AuthRequest } from '../../types';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../utils/AppError';
import { createNotification } from '../../services/notification';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function cleanTimes(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new BadRequestError('At least one reminder time is required');
  }
  const times = [...new Set(input.map((t) => String(t).trim()))];
  if (!times.every((t) => TIME_RE.test(t))) {
    throw new BadRequestError('Times must be in 24-hour "HH:mm" format');
  }
  return times.sort();
}

function cleanDaysOfWeek(input: unknown): number[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new BadRequestError('daysOfWeek must be an array');
  const days = [...new Set(input.map(Number))];
  if (!days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
    throw new BadRequestError('daysOfWeek values must be integers 0-6');
  }
  return days.sort();
}

function cleanDate(value: unknown, field: string, required: boolean): string | undefined {
  if (!value) {
    if (required) throw new BadRequestError(`${field} is required`);
    return undefined;
  }
  const str = String(value).trim();
  if (!DATE_RE.test(str)) throw new BadRequestError(`${field} must be in YYYY-MM-DD format`);
  return str;
}

/* GET /api/v1/patient/medicine-reminders?active=true
 * Also opportunistically fires a "course ending soon" notification the first
 * time an active reminder's endDate is reached as "tomorrow" — there's no
 * background scheduler in this deployment, so this check piggybacks on the
 * patient loading their reminders (which happens whenever the Reminders
 * screen is opened). Each reminder is only notified once (endingSoonNotifiedAt). */
export const listReminders = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { active } = req.query;

  const filter: Record<string, unknown> = { patientId: req.user.id };
  if (active === 'true') filter.active = true;
  if (active === 'false') filter.active = false;

  const reminders = await MedicineReminder.find(filter).sort({ active: -1, createdAt: -1 });

  const todayISO = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().slice(0, 10);

  const results = [];
  for (const r of reminders) {
    let endingSoon = false;
    if (r.active && r.endDate) {
      endingSoon = r.endDate === todayISO || r.endDate === tomorrowISO;
      if (r.endDate === tomorrowISO && !r.endingSoonNotifiedAt) {
        await createNotification({
          userId: req.user.id,
          role: 'patient',
          type: 'REMINDER',
          title: 'Medicine course ending soon',
          message: `Your ${r.medicineName} reminder ends tomorrow (${r.endDate}). Refill or extend it if you still need it.`,
        });
        r.endingSoonNotifiedAt = new Date();
        await r.save();
      }
    }
    results.push({ ...r.toObject(), endingSoon });
  }

  res.status(200).json({ success: true, data: { reminders: results } });
};

/* POST /api/v1/patient/medicine-reminders */
export const createReminder = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const { medicineName, dosage, times, daysOfWeek, startDate, endDate, notes } = req.body ?? {};

  const cleanName = String(medicineName ?? '').trim();
  if (!cleanName) throw new BadRequestError('Medicine name is required');

  const reminder = await MedicineReminder.create({
    patientId: req.user.id,
    medicineName: cleanName.slice(0, 120),
    dosage: dosage ? String(dosage).trim().slice(0, 60) : undefined,
    times: cleanTimes(times),
    daysOfWeek: cleanDaysOfWeek(daysOfWeek),
    startDate: cleanDate(startDate, 'startDate', false) ?? new Date().toISOString().slice(0, 10),
    endDate: cleanDate(endDate, 'endDate', false),
    notes: notes ? String(notes).trim().slice(0, 500) : undefined,
    active: true,
  });

  res.status(201).json({ success: true, message: 'Reminder created', data: { reminder } });
};

/* PUT /api/v1/patient/medicine-reminders/:id */
export const updateReminder = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const reminder = await MedicineReminder.findOne({ _id: req.params.id, patientId: req.user.id });
  if (!reminder) throw new NotFoundError('Reminder');

  const { medicineName, dosage, times, daysOfWeek, startDate, endDate, notes } = req.body ?? {};

  if (medicineName !== undefined) {
    const cleanName = String(medicineName).trim();
    if (!cleanName) throw new BadRequestError('Medicine name is required');
    reminder.medicineName = cleanName.slice(0, 120);
  }
  if (dosage !== undefined) reminder.dosage = dosage ? String(dosage).trim().slice(0, 60) : undefined;
  if (times !== undefined) reminder.times = cleanTimes(times);
  if (daysOfWeek !== undefined) reminder.daysOfWeek = cleanDaysOfWeek(daysOfWeek);
  if (startDate !== undefined) reminder.startDate = cleanDate(startDate, 'startDate', true)!;
  if (endDate !== undefined) reminder.endDate = cleanDate(endDate, 'endDate', false);
  if (notes !== undefined) reminder.notes = notes ? String(notes).trim().slice(0, 500) : undefined;

  await reminder.save();

  res.status(200).json({ success: true, message: 'Reminder updated', data: { reminder } });
};

/* PATCH /api/v1/patient/medicine-reminders/:id/toggle */
export const toggleReminder = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const reminder = await MedicineReminder.findOne({ _id: req.params.id, patientId: req.user.id });
  if (!reminder) throw new NotFoundError('Reminder');

  reminder.active = !reminder.active;
  await reminder.save();

  res.status(200).json({ success: true, data: { reminder } });
};

/* DELETE /api/v1/patient/medicine-reminders/:id */
export const deleteReminder = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const deleted = await MedicineReminder.findOneAndDelete({ _id: req.params.id, patientId: req.user.id });
  if (!deleted) throw new NotFoundError('Reminder');

  await MedicineDoseLog.deleteMany({ reminderId: deleted._id, patientId: req.user.id });

  res.status(200).json({ success: true, message: 'Reminder deleted' });
};

/* ── Dose tracking ("seat map") ─────────────────────────────────────── */

async function ownedReminder(patientId: string, id: string) {
  const reminder = await MedicineReminder.findOne({ _id: id, patientId });
  if (!reminder) throw new NotFoundError('Reminder');
  return reminder;
}

/* GET /api/v1/patient/medicine-reminders/:id/doses — taken dose log for one reminder */
export const listDoseLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  await ownedReminder(req.user.id, req.params.id);

  const doses = await MedicineDoseLog.find({ reminderId: req.params.id, patientId: req.user.id })
    .select('date time takenAt')
    .sort({ date: 1, time: 1 })
    .lean();

  res.status(200).json({ success: true, data: { doses } });
};

/* POST /api/v1/patient/medicine-reminders/:id/doses  { date, time }
 * Marks one dose slot as taken — this is what fills a "seat" on the tracker. */
export const markDoseTaken = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const reminder = await ownedReminder(req.user.id, req.params.id);

  const { date, time } = req.body ?? {};
  const cleanDateVal = cleanDate(date, 'date', true)!;
  const cleanTime = String(time ?? '').trim();
  if (!TIME_RE.test(cleanTime)) throw new BadRequestError('A valid time (HH:mm) is required');
  if (!reminder.times.includes(cleanTime)) {
    throw new BadRequestError('That time is not part of this reminder\'s schedule');
  }

  const existing = await MedicineDoseLog.findOne({ reminderId: reminder._id, date: cleanDateVal, time: cleanTime });
  if (existing) {
    res.status(200).json({ success: true, message: 'Already marked as taken', data: { dose: existing } });
    return;
  }

  const dose = await MedicineDoseLog.create({
    patientId: req.user.id,
    reminderId: reminder._id,
    date: cleanDateVal,
    time: cleanTime,
  });

  await createNotification({
    userId: req.user.id,
    role: 'patient',
    type: 'REMINDER',
    title: `${reminder.medicineName} taken ✓`,
    message: `Marked as taken for ${cleanDateVal} at ${cleanTime}${reminder.dosage ? ` (${reminder.dosage})` : ''}.`,
  });

  res.status(201).json({ success: true, message: 'Marked as taken', data: { dose } });
};

/* DELETE /api/v1/patient/medicine-reminders/:id/doses  { date, time }
 * Undo an accidental "taken" tap — empties that seat again. */
export const unmarkDoseTaken = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const reminder = await ownedReminder(req.user.id, req.params.id);

  const { date, time } = req.body ?? {};
  const cleanDateVal = cleanDate(date, 'date', true)!;
  const cleanTime = String(time ?? '').trim();
  if (!TIME_RE.test(cleanTime)) throw new BadRequestError('A valid time (HH:mm) is required');

  await MedicineDoseLog.deleteOne({ reminderId: reminder._id, patientId: req.user.id, date: cleanDateVal, time: cleanTime });

  res.status(200).json({ success: true, message: 'Unmarked' });
};

/** Calendar maths on YYYY-MM-DD strings, independent of the server's timezone. */
function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function scheduledOn(
  r: { startDate: string; endDate?: string; daysOfWeek: number[]; times: string[] },
  iso: string
): string[] {
  if (r.startDate > iso) return [];
  if (r.endDate && r.endDate < iso) return [];
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  if (r.daysOfWeek.length && !r.daysOfWeek.includes(dow)) return [];
  return [...r.times].sort();
}

/* GET /api/v1/patient/medicine-reminders/schedule?date=YYYY-MM-DD
 * One day's doses across all active reminders, each marked taken or not, plus
 * the 7 days ending on that date for the adherence ring. The client sends its
 * own local date, so "today" is the patient's today, not the server's (UTC). */
export const getSchedule = async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new UnauthorizedError();
  const date = String(req.query.date ?? '');
  if (!DATE_RE.test(date)) throw new BadRequestError('date must be YYYY-MM-DD');

  const weekStart = shiftDate(date, -6);
  const reminders = await MedicineReminder.find({ patientId: req.user.id, active: true }).lean();
  const logs = await MedicineDoseLog.find({
    patientId: req.user.id,
    reminderId: { $in: reminders.map((r) => r._id) },
    date: { $gte: weekStart, $lte: date },
  })
    .select('reminderId date time takenAt')
    .lean();
  const takenAt = new Map(logs.map((l) => [`${l.reminderId}|${l.date}|${l.time}`, l.takenAt]));

  const doses = reminders
    .flatMap((r) =>
      scheduledOn(r, date).map((time) => {
        const at = takenAt.get(`${r._id}|${date}|${time}`);
        return {
          reminderId: String(r._id),
          medicineName: r.medicineName,
          dosage: r.dosage ?? null,
          notes: r.notes ?? null,
          time,
          taken: !!at,
          takenAt: at ?? null,
          endDate: r.endDate ?? null,
        };
      })
    )
    .sort((a, b) => a.time.localeCompare(b.time));

  const week = Array.from({ length: 7 }, (_, i) => {
    const day = shiftDate(weekStart, i);
    let total = 0;
    let taken = 0;
    for (const r of reminders) {
      for (const time of scheduledOn(r, day)) {
        total++;
        if (takenAt.has(`${r._id}|${day}|${time}`)) taken++;
      }
    }
    return { date: day, total, taken };
  });

  const weekTotal = week.reduce((s, d) => s + d.total, 0);
  const weekTaken = week.reduce((s, d) => s + d.taken, 0);

  res.status(200).json({
    success: true,
    data: {
      date,
      doses,
      summary: { total: doses.length, taken: doses.filter((d) => d.taken).length },
      week,
      weekAdherence: weekTotal ? Math.round((weekTaken / weekTotal) * 100) : null,
    },
  });
};
