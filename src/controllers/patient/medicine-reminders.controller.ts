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
