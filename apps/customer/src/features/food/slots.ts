import { CITY_UTC_OFFSET_MIN } from '@driver/i18n';

/**
 * Pre-order slots (joy o11, audit F-21): half-hour times on the city's clock for «اليوم» or «باچر»,
 * inside the kitchen's opening hours and at least 45 minutes away — so a closed kitchen can take a
 * breakfast order tonight for 7:30 tomorrow. The server checks the same hours at `orders.place`.
 */

/** A weekly opening window on the city's clock: "HH:MM"; `end` before `start` runs past midnight. */
export interface OpeningWindow {
  dow: number;
  start: string;
  end: string;
}

const MIN = 60_000;
const DAY_MIN = 1440;
/** The earliest a scheduled order can be (the kitchen needs its lead). */
export const SLOT_LEAD_MIN = 45;
export const SLOT_STEP_MIN = 30;
/** At most this many chips per day. */
export const SLOTS_PER_DAY = 8;

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Whether a local (dow, minute of day) is inside a window; the opening minute itself counts. */
export function insideHours(dow: number, minute: number, hours: readonly OpeningWindow[]): boolean {
  if (hours.length === 0) return true;
  return hours.some((w) => {
    const s = toMin(w.start);
    const e = toMin(w.end);
    if (s <= e) return w.dow === dow && minute >= s && minute < e;
    return (w.dow === dow && minute >= s) || ((w.dow + 1) % 7 === dow && minute < e);
  });
}

/** Start of the city's local day `dayOffset` days after `now`, as an instant. */
function localDayStart(now: Date, dayOffset: number, offsetMin: number): number {
  const local = now.getTime() + offsetMin * MIN;
  const midnight = Math.floor(local / (DAY_MIN * MIN)) * DAY_MIN * MIN;
  return midnight + dayOffset * DAY_MIN * MIN - offsetMin * MIN;
}

/** Start of the city's local day `dayOffset` days after `now` (today 0, tomorrow 1). */
export function cityDayStart(now: Date, dayOffset: 0 | 1, offsetMin: number = CITY_UTC_OFFSET_MIN): Date {
  return new Date(localDayStart(now, dayOffset, offsetMin));
}

/**
 * The half-hour slots of today (0) or tomorrow (1) that the kitchen can take, earliest first: inside
 * its opening hours and outside its pause windows (Friday prayer), which `orders.place` refuses.
 */
export function preorderSlots(now: Date, hours: readonly OpeningWindow[], dayOffset: 0 | 1, opts: { offsetMin?: number; count?: number; pauses?: readonly OpeningWindow[] } = {}): Date[] {
  const offsetMin = opts.offsetMin ?? CITY_UTC_OFFSET_MIN;
  const count = opts.count ?? SLOTS_PER_DAY;
  const pauses = opts.pauses ?? [];
  const start = localDayStart(now, dayOffset, offsetMin);
  const earliest = now.getTime() + SLOT_LEAD_MIN * MIN;
  const dow = new Date(start + offsetMin * MIN).getUTCDay();
  const out: Date[] = [];
  for (let m = 0; m < DAY_MIN && out.length < count; m += SLOT_STEP_MIN) {
    const at = start + m * MIN;
    if (at < earliest) continue;
    if (insideHours(dow, m, hours) && !(pauses.length > 0 && insideHours(dow, m, pauses))) out.push(new Date(at));
  }
  return out;
}

/** The first slot a closed kitchen can take: today's, else tomorrow's; null when neither has one. */
export function firstOpenSlot(now: Date, hours: readonly OpeningWindow[], offsetMin?: number, pauses: readonly OpeningWindow[] = []): { day: 0 | 1; at: Date } | null {
  for (const day of [0, 1] as const) {
    const [first] = preorderSlots(now, hours, day, { ...(offsetMin !== undefined ? { offsetMin } : {}), count: 1, pauses });
    if (first) return { day, at: first };
  }
  return null;
}
