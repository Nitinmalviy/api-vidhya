/**
 * Doctor availability and the bookable slots it produces.
 *
 * A doctor opens whole hours per weekday ("09:00", "17:00"); each open hour
 * becomes two 30-minute booking slots ("09:00 AM", "09:30 AM") — the same
 * strings appointments already store in `timeSlot`.
 *
 * Times are India time. The API may run in UTC, so "today" and "now" are
 * computed for Asia/Kolkata explicitly.
 */

export const OPEN_HOURS = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'];

export interface IAvailability {
  accepting: boolean;
  /** Index = day of week (0 Sun … 6 Sat); each entry the open hours ("HH:00"). */
  weekly: string[][];
  /** YYYY-MM-DD dates the doctor is away. */
  blockedDates: string[];
  updatedAt?: Date;
}

/** What doctors who never set availability get: Mon–Sat, 9–1 and 2–6. */
export const DEFAULT_WEEKLY: string[][] = [
  [],
  ...Array.from({ length: 6 }, () => ['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00']),
];

export function effectiveAvailability(a?: Partial<IAvailability> | null): IAvailability {
  return {
    accepting: a?.accepting ?? true,
    weekly: a?.weekly && a.weekly.length === 7 ? a.weekly : DEFAULT_WEEKLY,
    blockedDates: a?.blockedDates ?? [],
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "14:30" → "02:30 PM" (the stored timeSlot format). */
export function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${pad(h % 12 || 12)}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** "02:30 PM" → minutes since midnight. */
export function slotMinutes(slot: string): number {
  const [t, ampm] = slot.split(' ');
  const [h, m] = t.split(':').map(Number);
  return ((h % 12) + (ampm === 'PM' ? 12 : 0)) * 60 + (m || 0);
}

/** Today's date and the current minute of the day, in India. */
export function nowInIndia(): { date: string; minutes: number; dow: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { date, minutes: Number(get('hour')) * 60 + Number(get('minute')), dow };
}

export function dayOfWeek(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

/**
 * Every slot the doctor offers on a date, ignoring bookings. Empty when they
 * aren't accepting, the date is blocked, or it's a day off.
 */
export function offeredSlots(a: IAvailability, isoDate: string): string[] {
  if (!a.accepting || a.blockedDates.includes(isoDate)) return [];
  const hours = a.weekly[dayOfWeek(isoDate)] ?? [];
  return [...hours].sort().flatMap((h) => [to12h(h), to12h(h.replace(':00', ':30'))]);
}

/** Offered slots minus booked ones and (today) ones already past. */
export function freeSlots(a: IAvailability, isoDate: string, booked: string[]): string[] {
  const now = nowInIndia();
  const taken = new Set(booked);
  return offeredSlots(a, isoDate).filter(
    (s) => !taken.has(s) && (isoDate !== now.date || slotMinutes(s) > now.minutes + 15)
  );
}

/** Validates and normalises a weekly grid from the client. */
export function cleanWeekly(input: unknown): string[][] {
  if (!Array.isArray(input) || input.length !== 7) throw new Error('weekly must have 7 days');
  return input.map((day) => {
    if (!Array.isArray(day)) return [];
    return [...new Set(day.map(String).filter((h) => OPEN_HOURS.includes(h)))].sort();
  });
}
