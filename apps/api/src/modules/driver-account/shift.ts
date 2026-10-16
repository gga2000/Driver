import { MY_BEST_MIN_JOBS, MY_BEST_WINDOW_MAX_HOURS, SHIFT_MAX_HOURS, SHIFT_PER_HOUR_MIN_MINUTES, SHIFT_PER_HOUR_STEP_IQD, type EarningsJobLine, type LatLng, type MyBestView } from '@driver/contracts';
import { BAGHDAD_OFFSET_MIN, localDateKey, localDow, localHour, startOfLocalDay } from '../../shared/local-time.js';
import { kmApprox } from '../../shared/landmarks.js';

/**
 * End-of-shift summary (Partner audit S-4), pure: the window, per-hour, the best clock hour and
 * tomorrow's busiest window. Everything is on the Baghdad clock (UTC+3, no DST).
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
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

/**
 * Net per online hour from the exact minutes, to the nearest `SHIFT_PER_HOUR_STEP_IQD` (the screen says
 * «تقريباً»); null when he was online too little to say. Not a money step: nothing is paid from it.
 */
export function perHour(netIqd: number, onlineMinutes: number): number | null {
  if (onlineMinutes < SHIFT_PER_HOUR_MIN_MINUTES) return null;
  return Math.round((netIqd * 60) / onlineMinutes / SHIFT_PER_HOUR_STEP_IQD) * SHIFT_PER_HOUR_STEP_IQD;
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

type JobPoint = Pick<EarningsJobLine, 'at' | 'netIqd' | 'tripId' | 'orderId'>;

const realJob = (j: JobPoint) => j.tripId !== null || j.orderId !== null;

/** His best Baghdad day among `jobs` (net of every line that day, jobs counted); ties go to the later day. */
export function bestDay(jobs: readonly JobPoint[], offsetMin = BAGHDAD_OFFSET_MIN): MyBestView['bestDay'] {
  const days = new Map<string, { at: Date; netIqd: number; jobs: number }>();
  for (const j of jobs) {
    const key = localDateKey(j.at, offsetMin);
    const cur = days.get(key) ?? { at: startOfLocalDay(j.at, offsetMin), netIqd: 0, jobs: 0 };
    cur.netIqd += j.netIqd;
    if (realJob(j) && j.netIqd > 0) cur.jobs += 1;
    days.set(key, cur);
  }
  let best: { at: Date; netIqd: number; jobs: number } | null = null;
  for (const d of days.values()) if (d.jobs > 0 && (!best || d.netIqd >= best.netIqd)) best = d;
  return best && best.netIqd > 0 ? best : null;
}

/**
 * «أحسن وقت إلك» (partner redesign e3), pure: over `days` of his jobs, the weekday and clock hours that
 * paid him most. The best `MY_BEST_WINDOW_MAX_HOURS`-hour window of any weekday by net (ties: earlier
 * weekday, earlier hour) has its edge hours trimmed while they hold under 15 % of it (down to 2 h), so
 * «7–11 بالليل» is where he really worked. A window needs `MY_BEST_MIN_JOBS` jobs on two different days:
 * one lucky night is not a habit. Per hour = the window's net ÷ its hours ÷ how many of that weekday the
 * range holds (four in four weeks), to the nearest `SHIFT_PER_HOUR_STEP_IQD`.
 */
export function bestWindow(jobs: readonly JobPoint[], days: number, offsetMin = BAGHDAD_OFFSET_MIN): MyBestView['bestWindow'] {
  // cells[weekday][hour]
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ netIqd: 0, jobs: 0, dates: new Set<string>() })));
  for (const j of jobs) {
    if (!realJob(j)) continue;
    const c = cells[localDow(j.at, offsetMin)]![localHour(j.at, offsetMin)]!;
    c.netIqd += j.netIqd;
    c.jobs += 1;
    c.dates.add(localDateKey(j.at, offsetMin));
  }
  const width = MY_BEST_WINDOW_MAX_HOURS;
  let best: { weekday: number; from: number; netIqd: number } | null = null;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h + width <= 24; h++) {
      let net = 0;
      for (let k = 0; k < width; k++) net += cells[d]![h + k]!.netIqd;
      if (net > 0 && (!best || net > best.netIqd)) best = { weekday: d, from: h, netIqd: net };
    }
  }
  if (!best) return null;
  const row = cells[best.weekday]!;
  let from = best.from;
  let to = best.from + width;
  const floor = best.netIqd * 0.15;
  while (to - from > 2) {
    const head = row[from]!.netIqd;
    const tail = row[to - 1]!.netIqd;
    if (tail <= head && tail < floor) to -= 1;
    else if (head < floor) from += 1;
    else break;
  }
  let net = 0;
  let count = 0;
  const dates = new Set<string>();
  for (let h = from; h < to; h++) {
    net += row[h]!.netIqd;
    count += row[h]!.jobs;
    for (const x of row[h]!.dates) dates.add(x);
  }
  if (count < MY_BEST_MIN_JOBS || dates.size < 2 || net <= 0) return null;
  const occurrences = Math.max(1, Math.floor(days / 7));
  const perHourIqd = Math.round(net / (to - from) / occurrences / SHIFT_PER_HOUR_STEP_IQD) * SHIFT_PER_HOUR_STEP_IQD;
  return { weekday: best.weekday, fromHour: from, toHour: to, perHourIqd, jobs: count, days: dates.size };
}

/**
 * «يومك» (partner redesign e7): whole km in straight lines between the consecutive stops of each trip
 * (stops without a pin are skipped), rounded down. The road is never shorter than this, so the app
 * says «أكثر من …». Null without a single leg.
 */
export function straightLineKm(trips: ReadonlyArray<{ stops: ReadonlyArray<{ target: LatLng | null }> }>): number | null {
  let km = 0;
  let legs = 0;
  for (const trip of trips) {
    let prev: LatLng | null = null;
    for (const s of trip.stops) {
      if (!s.target) continue;
      if (prev) {
        km += kmApprox(prev, s.target);
        legs += 1;
      }
      prev = s.target;
    }
  }
  return legs > 0 ? Math.floor(km) : null;
}
