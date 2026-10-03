/**
 * Baghdad calendar on screen (UTC+3 all year, no DST), the same local day / Sunday-start week the API
 * uses for money and insights. Pure (no React Native), tested. Names come from the locale
 * (`merchant.date.*`, `merchant.time.*`) through `useDates()` in `dates.ts`.
 */

const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export interface LocalParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0 = Sunday … 6 = Saturday */
  dow: number;
  hour: number;
  minute: number;
}

const ms = (at: Date | number) => (typeof at === 'number' ? at : at.getTime());

export function localParts(at: Date | number): LocalParts {
  const d = new Date(ms(at) + OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), dow: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** `2026-10-03` for the Baghdad day containing `at`. */
export function localDayKey(at: Date | number): string {
  return new Date(ms(at) + OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC instant of the Baghdad midnight starting that day. */
export function startOfLocalDay(at: Date | number): number {
  const shifted = ms(at) + OFFSET_MS;
  return shifted - (((shifted % DAY_MS) + DAY_MS) % DAY_MS) - OFFSET_MS;
}

/** Sunday 00:00 Baghdad of the week containing `at`. */
export function startOfLocalWeek(at: Date | number): number {
  return startOfLocalDay(at) - localParts(at).dow * DAY_MS;
}

/** 'today' / 'yesterday' relative to `now`, else null. */
export function relativeDay(at: Date | number, now: Date | number): 'today' | 'yesterday' | null {
  const diff = Math.round((startOfLocalDay(now) - startOfLocalDay(at)) / DAY_MS);
  return diff === 0 ? 'today' : diff === 1 ? 'yesterday' : null;
}

export type HourPeriod = 'p_late_night' | 'p_morning' | 'p_noon' | 'p_afternoon' | 'p_evening' | 'p_night';

/** How Iraqis name the part of the day an hour falls in: الصبح، الظهر، العصر، المغرب، بالليل. */
export function hourPeriod(hour: number): HourPeriod {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5) return 'p_late_night';
  if (h < 12) return 'p_morning';
  if (h < 15) return 'p_noon';
  if (h < 18) return 'p_afternoon';
  if (h < 20) return 'p_evening';
  return 'p_night';
}

/** 0 → 12, 13 → 1, 21 → 9. */
export function hour12(hour: number): number {
  return ((hour % 24) + 24) % 24 % 12 || 12;
}
