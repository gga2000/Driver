import { z } from 'zod';

/**
 * A store's opening hours (Driver Merchant "الدوام"): a weekly schedule with up to three shifts a day
 * (split shifts: lunch and dinner), dated holiday closures (Eid, a family event), and the city's
 * pause windows (Friday prayer) shown alongside. Pure: shared by the API (`merchant.hours` /
 * `merchant.setHours`, the customer card's open/closed) and the Merchant app's editor.
 *
 * Times are local "HH:MM" (Baghdad); a shift whose end is not after its start runs past midnight
 * ("18:00"–"01:00"), and "00:00" as an end is midnight.
 */

export const STORE_HOURS_RULES = {
  maxShiftsPerDay: 3,
  maxHolidays: 20,
  /** One closure spans at most a month (Eid is 3–4 days). */
  holidayMaxDays: 31,
  /** A shift is at least 30 minutes and at most 24 hours. */
  minShiftMinutes: 30,
} as const;

const DAY_MIN = 1440;
const WEEK_MIN = 7 * DAY_MIN;

export const HhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const HoursShift = z.object({ start: HhMm, end: HhMm });
export type HoursShift = z.infer<typeof HoursShift>;

/** One weekday (0 = Sunday … 6 = Saturday); no shifts = closed all day. */
export const DayHours = z.object({
  dow: z.number().int().min(0).max(6),
  shifts: z.array(HoursShift).max(STORE_HOURS_RULES.maxShiftsPerDay),
});
export type DayHours = z.infer<typeof DayHours>;

/** Closed on these local dates, both included. */
export const HolidayClosure = z.object({
  from: LocalDate,
  to: LocalDate,
  note: z.string().trim().max(80).nullable(),
});
export type HolidayClosure = z.infer<typeof HolidayClosure>;

/** A weekly window as stored and enforced (`{dow, start, end}`, end may wrap past midnight). */
export interface WeeklyWindow {
  dow: number;
  start: string;
  end: string;
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Length of a shift in minutes (wrapping past midnight; equal start and end is 0). */
export function shiftMinutes(s: HoursShift): number {
  const a = hhmmToMinutes(s.start);
  const b = hhmmToMinutes(s.end);
  return b > a ? b - a : b === a ? 0 : DAY_MIN - a + b;
}

/** Minutes from Sunday 00:00 to the shift's start and end (end may pass the week's end). */
function span(dow: number, s: HoursShift): [number, number] {
  const start = dow * DAY_MIN + hhmmToMinutes(s.start);
  return [start, start + shiftMinutes(s)];
}

export type HoursProblem =
  | { code: 'no_open_day' }
  | { code: 'duplicate_day'; dow: number }
  | { code: 'shift_too_short'; dow: number; index: number }
  | { code: 'shift_overlap'; dow: number; index: number }
  | { code: 'holiday_order'; index: number }
  | { code: 'holiday_too_long'; index: number };

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * What is wrong with a schedule (empty when it can be saved): at least one open day, every weekday once, shifts of at
 * least 30 minutes that never overlap — also across midnight into the next day — and closures whose
 * end is not before their start and that last at most a month.
 */
export function storeHoursProblems(
  days: readonly DayHours[],
  holidays: readonly HolidayClosure[] = [],
): HoursProblem[] {
  const problems: HoursProblem[] = [];
  const seen = new Set<number>();
  const spans: Array<{ dow: number; index: number; a: number; b: number }> = [];
  for (const d of days) {
    if (seen.has(d.dow)) problems.push({ code: 'duplicate_day', dow: d.dow });
    seen.add(d.dow);
    d.shifts.forEach((s, index) => {
      if (shiftMinutes(s) < STORE_HOURS_RULES.minShiftMinutes) {
        problems.push({ code: 'shift_too_short', dow: d.dow, index });
        return;
      }
      const [a, b] = span(d.dow, s);
      spans.push({ dow: d.dow, index, a, b });
    });
  }
  // Overlaps on the week circle (Saturday night runs into Sunday morning).
  const flagged = new Set<string>();
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const x = spans[i]!;
      const y = spans[j]!;
      const k = [-WEEK_MIN, 0, WEEK_MIN].find((n) => x.a < y.b + n && y.a + n < x.b);
      if (k === undefined) continue;
      // The one that starts inside the other is the one to fix.
      const later = x.a <= y.a + k ? y : x;
      const key = `${later.dow}:${later.index}`;
      if (flagged.has(key)) continue;
      flagged.add(key);
      problems.push({ code: 'shift_overlap', dow: later.dow, index: later.index });
    }
  }
  // Closed every day is the early-close switch's job; an empty schedule would read as "no hours".
  if (spans.length === 0 && !problems.some((p) => p.code === 'shift_too_short'))
    problems.unshift({ code: 'no_open_day' });
  holidays.forEach((h, index) => {
    const n = daysBetween(h.from, h.to);
    if (n < 0) problems.push({ code: 'holiday_order', index });
    else if (n + 1 > STORE_HOURS_RULES.holidayMaxDays)
      problems.push({ code: 'holiday_too_long', index });
  });
  return problems;
}

/** Days → the flat weekly windows the open/closed checks read (shifts sorted by start). */
export function windowsFromDays(days: readonly DayHours[]): WeeklyWindow[] {
  return [...days]
    .sort((a, b) => a.dow - b.dow)
    .flatMap((d) => sortShifts(d.shifts).map((s) => ({ dow: d.dow, start: s.start, end: s.end })));
}

/** Weekly windows → seven days, Sunday first, shifts sorted by start (no windows = closed). */
export function daysFromWindows(windows: readonly WeeklyWindow[]): DayHours[] {
  return Array.from({ length: 7 }, (_, dow) => ({
    dow,
    shifts: sortShifts(
      windows.filter((w) => w.dow === dow).map((w) => ({ start: w.start, end: w.end })),
    ),
  }));
}

function sortShifts(shifts: readonly HoursShift[]): HoursShift[] {
  return [...shifts].sort((a, b) => hhmmToMinutes(a.start) - hhmmToMinutes(b.start));
}

// ───────────────────────── local calendar ─────────────────────────

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local date, weekday and minute of day at `at` in `timeZone`. */
export function localClock(
  at: Date,
  timeZone: string,
): { date: string; dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    dow: DOW[get('weekday')] ?? at.getUTCDay(),
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  };
}

/** `YYYY-MM-DD` plus `n` days. */
export function addLocalDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** The closure covering a local date, if any. */
export function holidayOn(
  holidays: readonly HolidayClosure[],
  date: string,
): HolidayClosure | null {
  return holidays.find((h) => h.from <= date && date <= h.to) ?? null;
}

/** Closures that still matter on `today` (current or upcoming), soonest first. */
export function upcomingHolidays(
  holidays: readonly HolidayClosure[],
  today: string,
): HolidayClosure[] {
  return holidays.filter((h) => h.to >= today).sort((a, b) => a.from.localeCompare(b.from));
}

export interface ScheduleState {
  /** Inside an opening shift, and not on a holiday (no hours on file reads as always open). */
  inHours: boolean;
  holiday: HolidayClosure | null;
  /** End of the shift in force ("HH:MM"), when open. */
  closesAt: string | null;
  /** Next opening after now, skipping holidays (within two weeks), when closed. */
  opensAt: { date: string; dow: number; time: string } | null;
}

/**
 * Open or closed by the schedule alone (pause windows and the early-close switch are separate). A
 * shift that started yesterday and runs past midnight counts for yesterday's date, so a holiday on
 * yesterday also closes its small hours.
 */
export function scheduleState(
  at: Date,
  windows: readonly WeeklyWindow[],
  holidays: readonly HolidayClosure[],
  timeZone: string,
): ScheduleState {
  const { date, dow, minutes } = localClock(at, timeZone);
  const holiday = holidayOn(holidays, date);
  if (windows.length === 0) {
    if (!holiday) return { inHours: true, holiday: null, closesAt: null, opensAt: null };
    // No hours on file: open all day, so it opens at midnight after the closure.
    let d = 1;
    while (d < 60 && holidayOn(holidays, addLocalDays(date, d))) d++;
    return {
      inHours: false,
      holiday,
      closesAt: null,
      opensAt: { date: addLocalDays(date, d), dow: (dow + d) % 7, time: '00:00' },
    };
  }
  for (const w of windows) {
    const s = hhmmToMinutes(w.start);
    const len = shiftMinutes(w);
    if (len === 0) continue;
    const today = w.dow === dow && minutes >= s && minutes < s + len;
    const fromYesterday =
      (w.dow + 1) % 7 === dow && s + len > DAY_MIN && minutes < s + len - DAY_MIN;
    if (today && !holiday) return { inHours: true, holiday: null, closesAt: w.end, opensAt: null };
    if (fromYesterday && !holidayOn(holidays, addLocalDays(date, -1)))
      return { inHours: true, holiday: null, closesAt: w.end, opensAt: null };
  }
  return {
    inHours: false,
    holiday,
    closesAt: null,
    opensAt: nextOpening(date, dow, minutes, windows, holidays),
  };
}

function nextOpening(
  date: string,
  dow: number,
  minutes: number,
  windows: readonly WeeklyWindow[],
  holidays: readonly HolidayClosure[],
): ScheduleState['opensAt'] {
  for (let d = 0; d < 14; d++) {
    const day = addLocalDays(date, d);
    if (holidayOn(holidays, day)) continue;
    const wd = (dow + d) % 7;
    const starts = windows
      .filter((w) => w.dow === wd && shiftMinutes(w) > 0)
      .map((w) => hhmmToMinutes(w.start))
      .sort((a, b) => a - b);
    for (const s of starts) {
      if (d === 0 && s <= minutes) continue;
      const h = Math.floor(s / 60);
      return {
        date: day,
        dow: wd,
        time: `${String(h).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`,
      };
    }
  }
  return null;
}
