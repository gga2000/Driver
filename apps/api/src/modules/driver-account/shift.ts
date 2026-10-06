import { SHIFT_MAX_HOURS, SHIFT_PER_HOUR_MIN_MINUTES, type EarningsJobLine } from '@driver/contracts';
import { BAGHDAD_OFFSET_MIN, startOfLocalDay } from '../../shared/local-time.js';

/**
 * End-of-shift summary (Partner audit S-4), pure: the window, per-hour, the best clock hour and
 * tomorrow's busiest window. Everything is on the Baghdad clock (UTC+3, no DST).
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Per hour is shown in the money step the rest of the app uses. */
const STEP = 250;
/** Tomorrow's window is two clock hours wide. */
export const BUSY_WINDOW_HOURS = 2;
/** Fewer orders than this in the busiest window last week: too thin to promise anything. */
export const BUSY_MIN_ORDERS = 4;

/**
 * The shift window: `to` defaults to now and never passes it; `from` defaults to the start of the
 * Baghdad day of `to`, is never after `to`, and the window is at most `SHIFT_MAX_HOURS` long.
 */
export function clampShift(input: { from?: Date | undefined; to?: Date | undefined }, now: Date): { from: Date; to: Date } {
  const to = new Date(Math.min((input.to ?? now).getTime(), now.getTime()));
  const earliest = to.getTime() - SHIFT_MAX_HOURS * HOUR_MS;
  const wanted = (input.from ?? startOfLocalDay(to)).getTime();
  const from = new Date(Math.min(Math.max(wanted, earliest), to.getTime()));
  return { from, to };
}

/** Net per online hour rounded to the 250 step; null when he was online too little to say. */
export function perHour(netIqd: number, onlineMinutes: number): number | null {
  if (onlineMinutes < SHIFT_PER_HOUR_MIN_MINUTES) return null;
  return Math.round((netIqd * 60) / onlineMinutes / STEP) * STEP;
}

/** Start of the Baghdad clock hour containing `at`. */
export function startOfLocalHour(at: Date, offsetMin = BAGHDAD_OFFSET_MIN): Date {
  const shifted = at.getTime() + offsetMin * 60_000;
  return new Date(shifted - (((shifted % HOUR_MS) + HOUR_MS) % HOUR_MS) - offsetMin * 60_000);
}

/** The clock hour that paid most (real jobs only, by when each started); ties go to the earlier hour. */
export function bestHour(jobs: readonly Pick<EarningsJobLine, 'at' | 'netIqd' | 'tripId' | 'orderId'>[], offsetMin = BAGHDAD_OFFSET_MIN): { from: Date; to: Date; netIqd: number; jobs: number } | null {
  const hours = new Map<number, { netIqd: number; jobs: number }>();
  for (const j of jobs) {
    if (j.tripId === null && j.orderId === null) continue;
    const h = startOfLocalHour(j.at, offsetMin).getTime();
    const cur = hours.get(h) ?? { netIqd: 0, jobs: 0 };
    cur.netIqd += j.netIqd;
    cur.jobs += 1;
    hours.set(h, cur);
  }
  let best: { at: number; netIqd: number; jobs: number } | null = null;
  for (const [at, v] of [...hours.entries()].sort((a, b) => a[0] - b[0])) {
    if (!best || v.netIqd > best.netIqd) best = { at, ...v };
  }
  if (!best || best.netIqd <= 0) return null;
  return { from: new Date(best.at), to: new Date(best.at + HOUR_MS), netIqd: best.netIqd, jobs: best.jobs };
}

/** The Baghdad day after `now`'s and the same weekday one week before it: [lastWeekFrom, lastWeekTo). */
export function tomorrowAndLastWeek(now: Date, offsetMin = BAGHDAD_OFFSET_MIN): { tomorrow: Date; lastWeekFrom: Date; lastWeekTo: Date } {
  const tomorrow = new Date(startOfLocalDay(now, offsetMin).getTime() + DAY_MS);
  const lastWeekFrom = new Date(tomorrow.getTime() - 7 * DAY_MS);
  return { tomorrow, lastWeekFrom, lastWeekTo: new Date(lastWeekFrom.getTime() + DAY_MS) };
}

/**
 * The busiest `width` consecutive clock hours of a day (counts per local hour 0–23), placed on
 * `dayStart` (tomorrow's local midnight). Null below `minOrders`. Ties go to the earlier window.
 */
export function busiestWindow(perHourCounts: readonly number[], dayStart: Date, width = BUSY_WINDOW_HOURS, minOrders = BUSY_MIN_ORDERS): { from: Date; to: Date; orders: number } | null {
  let best = -1;
  let bestAt = 0;
  for (let h = 0; h + width <= 24; h++) {
    let sum = 0;
    for (let k = 0; k < width; k++) sum += perHourCounts[h + k] ?? 0;
    if (sum > best) {
      best = sum;
      bestAt = h;
    }
  }
  if (best < minOrders) return null;
  const from = new Date(dayStart.getTime() + bestAt * HOUR_MS);
  return { from, to: new Date(from.getTime() + width * HOUR_MS), orders: best };
}
