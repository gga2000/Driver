import {
  addLocalDays,
  hhmmToMinutes,
  storeHoursProblems,
  STORE_HOURS_RULES,
  type DayHours,
  type HolidayClosure,
  type HoursProblem,
  type HoursShift,
  type StoreHoursView,
  type StoreStatusView,
} from '@driver/contracts';
import { hour12, hourPeriod } from '@/lib/calendar';
import { formatRange } from '@driver/i18n';
import type { Locale, TKey } from '@/lib/i18n-core';

/**
 * The opening-hours editor's rules (pure, tested): a draft of the week and the closures, the edits a
 * kitchen owner makes (close a day, split a shift, copy a day to the week), labels in Iraqi time of
 * day ("6 المغرب – 1 بالليل") and what to say about problems before saving.
 */

type TFn = (key: TKey, params?: Record<string, string | number>) => string;

export interface HoursDraft {
  days: DayHours[];
  holidays: HolidayClosure[];
}

/** Week order on screen: Saturday first (the Iraqi working week), Friday last. */
export const WEEK_ORDER: readonly number[] = [6, 0, 1, 2, 3, 4, 5];

export function draftFrom(view: Pick<StoreHoursView, 'days' | 'holidays'>): HoursDraft {
  return {
    days: view.days.map((d) => ({ dow: d.dow, shifts: d.shifts.map((s) => ({ ...s })) })),
    holidays: view.holidays.map((h) => ({ ...h })),
  };
}

export function sameDraft(a: HoursDraft, b: HoursDraft): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

function normalise(d: HoursDraft): HoursDraft {
  return {
    days: [...d.days]
      .sort((x, y) => x.dow - y.dow)
      .map((x) => ({
        dow: x.dow,
        shifts: [...x.shifts].sort((p, q) => hhmmToMinutes(p.start) - hhmmToMinutes(q.start)),
      })),
    holidays: [...d.holidays]
      .sort((x, y) => x.from.localeCompare(y.from))
      .map((h) => ({ from: h.from, to: h.to, note: h.note?.trim() || null })),
  };
}

function mapDay(
  draft: HoursDraft,
  dow: number,
  f: (shifts: HoursShift[]) => HoursShift[],
): HoursDraft {
  return {
    ...draft,
    days: draft.days.map((d) => (d.dow === dow ? { dow, shifts: f(d.shifts) } : d)),
  };
}

const DEFAULT_SHIFT: HoursShift = { start: '12:00', end: '23:00' };

function fromMinutes(m: number): string {
  const v = ((m % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** Closed: no shifts. Open again: the shifts it had before closing, else 12:00–23:00. */
export function setDayOpen(
  draft: HoursDraft,
  dow: number,
  open: boolean,
  remembered?: readonly HoursShift[],
): HoursDraft {
  return mapDay(draft, dow, () =>
    open
      ? remembered && remembered.length > 0
        ? remembered.map((s) => ({ ...s }))
        : [{ ...DEFAULT_SHIFT }]
      : [],
  );
}

/**
 * A second (third) shift starts an hour after the last one ends and lasts four hours — dinner after
 * lunch. At most three shifts a day.
 */
export function addShift(draft: HoursDraft, dow: number): HoursDraft {
  return mapDay(draft, dow, (shifts) => {
    if (shifts.length >= STORE_HOURS_RULES.maxShiftsPerDay) return shifts;
    if (shifts.length === 0) return [{ ...DEFAULT_SHIFT }];
    const last = [...shifts]
      .sort((a, b) => hhmmToMinutes(a.start) - hhmmToMinutes(b.start))
      .at(-1)!;
    const lastEnd =
      hhmmToMinutes(last.end) <= hhmmToMinutes(last.start)
        ? hhmmToMinutes(last.end) + 1440
        : hhmmToMinutes(last.end);
    const start = lastEnd + 60;
    return [...shifts, { start: fromMinutes(start), end: fromMinutes(start + 240) }];
  });
}

export function updateShift(
  draft: HoursDraft,
  dow: number,
  index: number,
  patch: Partial<HoursShift>,
): HoursDraft {
  return mapDay(draft, dow, (shifts) =>
    shifts.map((s, i) => (i === index ? { ...s, ...patch } : s)),
  );
}

export function removeShift(draft: HoursDraft, dow: number, index: number): HoursDraft {
  return mapDay(draft, dow, (shifts) => shifts.filter((_, i) => i !== index));
}

/** "Same hours every day": the day's shifts on all seven days (closed days too). */
export function copyToAll(draft: HoursDraft, fromDow: number): HoursDraft {
  const src = draft.days.find((d) => d.dow === fromDow)?.shifts ?? [];
  return {
    ...draft,
    days: draft.days.map((d) => ({ dow: d.dow, shifts: src.map((s) => ({ ...s })) })),
  };
}

export function addHoliday(draft: HoursDraft, h: HolidayClosure): HoursDraft {
  const from = h.from <= h.to ? h.from : h.to;
  const to = h.from <= h.to ? h.to : h.from;
  return {
    ...draft,
    holidays: [...draft.holidays, { from, to, note: h.note?.trim() || null }].sort((a, b) =>
      a.from.localeCompare(b.from),
    ),
  };
}

export function removeHoliday(draft: HoursDraft, index: number): HoursDraft {
  return { ...draft, holidays: draft.holidays.filter((_, i) => i !== index) };
}

/** Iraqi number agreement for "يوم": واحد · 2–10 أيام · 11+ يوم. */
export function daysForm(n: number): 'one' | 'few' | 'many' {
  return n === 1 ? 'one' : n <= 10 ? 'few' : 'many';
}

/** Days a closure covers, both ends included. */
export function holidayDays(h: Pick<HolidayClosure, 'from' | 'to'>): number {
  return (
    Math.round((Date.parse(`${h.to}T00:00:00Z`) - Date.parse(`${h.from}T00:00:00Z`)) / 86_400_000) +
    1
  );
}

/** The problems the API would refuse (`store_hours_invalid`), checked before saving. */
export function draftProblems(draft: HoursDraft): HoursProblem[] {
  return storeHoursProblems(draft.days, draft.holidays);
}

export function problemText(t: TFn, p: HoursProblem): string {
  const day = (dow: number) => t(`merchant.date.dow_${dow}` as TKey);
  switch (p.code) {
    case 'no_open_day':
      return t('merchant.hours.problem_none');
    case 'shift_overlap':
      return t('merchant.hours.problem_overlap', { day: day(p.dow) });
    case 'shift_too_short':
      return t('merchant.hours.problem_short', { day: day(p.dow) });
    case 'duplicate_day':
      return t('merchant.hours.problem_overlap', { day: day(p.dow) });
    default:
      return t('merchant.hours.problem_holiday');
  }
}

/** Is this shift/day flagged? (to colour the row that needs fixing) */
export function flagged(problems: readonly HoursProblem[], dow: number, index?: number): boolean {
  return problems.some(
    (p) =>
      'dow' in p && p.dow === dow && (index === undefined || !('index' in p) || p.index === index),
  );
}

/** "12 الظهر", "3:30 العصر", "1 بالليل" — how a kitchen says a time. */
export function timeLabel(t: TFn, hhmm: string): string {
  const m = hhmmToMinutes(hhmm);
  const h = Math.floor(m / 60);
  const min = m % 60;
  const hour = min === 0 ? String(hour12(h)) : `${hour12(h)}:${String(min).padStart(2, '0')}`;
  return t('merchant.time.hour', { hour, period: t(`merchant.time.${hourPeriod(h)}` as TKey) });
}

/**
 * "6 المغرب – 1 بالليل" (an end at or before the start runs past midnight), isolated right to left in
 * Arabic so the opening time stays on the right, where the reader starts (`formatRange`).
 */
export function shiftLabel(t: TFn, s: { start: string; end: string }, locale: Locale = 'ar-IQ'): string {
  return formatRange(timeLabel(t, s.start), timeLabel(t, s.end), locale, { spaced: true });
}

export function crossesMidnight(s: HoursShift): boolean {
  return hhmmToMinutes(s.end) <= hhmmToMinutes(s.start) && s.end !== '00:00';
}

/** Start-time choices for the picker, in the order a kitchen's day runs: 6 الصبح … 5:30 الصبح. */
export function timeChoices(stepMin = 30): string[] {
  const out: string[] = [];
  for (let m = 6 * 60; m < 6 * 60 + 1440; m += stepMin) out.push(fromMinutes(m));
  return out;
}

/** "اليوم" / "باچر" / the weekday, for "يفتح … الساعة …". */
export function dayWord(t: TFn, date: string, dow: number, today: string): string {
  if (date === today) return t('merchant.date.today');
  if (date === addLocalDays(today, 1)) return t('merchant.hours.tomorrow');
  return t(`merchant.date.dow_${dow}` as TKey);
}

/** The status line on top: open until …, outside hours (opens …), holiday until …, paused, closed. */
export function stateLine(
  t: TFn,
  view: Pick<StoreHoursView, 'state' | 'today' | 'holidays'>,
  dayMonth: (date: string) => string,
): string {
  const s = view.state;
  if (s.open)
    return s.closesAt
      ? t('merchant.hours.state_open_until', { time: timeLabel(t, s.closesAt) })
      : t('merchant.status.open');
  const opens = s.opensAt
    ? t('merchant.hours.opens', {
        day: dayWord(t, s.opensAt.date, s.opensAt.dow, view.today),
        time: timeLabel(t, s.opensAt.time),
      })
    : '';
  if (s.reason === 'holiday') {
    const h = view.holidays.find((x) => x.from <= view.today && view.today <= x.to);
    return [t('merchant.hours.state_holiday', { date: dayMonth(h?.to ?? view.today) }), opens]
      .filter(Boolean)
      .join(' · ');
  }
  if (s.reason === 'hours')
    return [t('merchant.hours.state_out'), opens].filter(Boolean).join(' · ');
  if (s.reason === 'pause')
    return t('merchant.status.paused', { time: s.opensAt ? timeLabel(t, s.opensAt.time) : '' });
  return t('merchant.status.closed');
}

/**
 * The board's strip when the schedule keeps customers out (the switch may still read "open"):
 * "برّا وقت الدوام: … يفتح اليوم 6 المغرب" or "عطلة: … لحد 22 تشرين الأول". Null while in hours.
 */
export function scheduleBanner(
  t: TFn,
  schedule: StoreStatusView['schedule'],
  today: string,
  dayMonth: (date: string) => string,
): string | null {
  if (!schedule || schedule.inHours) return null;
  if (schedule.holiday)
    return t('merchant.hours.board_holiday', { date: dayMonth(schedule.holiday.to) });
  const when = schedule.opensAt
    ? `${dayWord(t, schedule.opensAt.date, schedule.opensAt.dow, today)} ${timeLabel(t, schedule.opensAt.time)}`
    : '';
  return t('merchant.hours.board_out', { when }).trim();
}
