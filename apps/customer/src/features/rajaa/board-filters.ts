import type { DepartureCard } from '@driver/contracts';
import { IRAQ_UTC_OFFSET_MIN } from './logic';

/**
 * Narrowing the الرجعة board (Baghdad/Kut ideas s2, s5, s6, s7, x3, Ali 2026-10-07): which day, which
 * part of the day, how busy each hour is, when a car reaches the city, and the one-tap «نبّهني» wish
 * for an empty day or part. Pure: the board screen passes the cars the server returned.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Baghdad midnight on or before `at` (ms). */
export function baghdadMidnight(at: Date, offsetMin: number = IRAQ_UTC_OFFSET_MIN): number {
  const local = at.getTime() + offsetMin * MIN;
  return local - (((local % DAY) + DAY) % DAY) - offsetMin * MIN;
}

export type BoardDayId = 'today' | 'tomorrow' | 'after';
export type BoardDay = { id: BoardDayId; start: Date; end: Date };

/** Today, tomorrow and the day after (drivers announce up to 48 h ahead), Baghdad days. */
export function boardDays(now: Date, offsetMin: number = IRAQ_UTC_OFFSET_MIN): BoardDay[] {
  const day0 = baghdadMidnight(now, offsetMin);
  return (['today', 'tomorrow', 'after'] as const).map((id, i) => ({ id, start: new Date(day0 + i * DAY), end: new Date(day0 + (i + 1) * DAY) }));
}

/** The board's whole read: from now to the end of the day after tomorrow. */
export function boardSpan(now: Date, offsetMin: number = IRAQ_UTC_OFFSET_MIN): { from: Date; to: Date } {
  const days = boardDays(now, offsetMin);
  return { from: now, to: days[days.length - 1]!.end };
}

export type DayPartId = 'morning' | 'noon' | 'afternoon' | 'night';
/** Hours of the Baghdad day: الصبح 4–12, الظهر 12–15, العصر 15–18, الليل 18–4 (into the next day). */
export const DAY_PARTS: Readonly<Record<DayPartId, { fromH: number; toH: number }>> = {
  morning: { fromH: 4, toH: 12 },
  noon: { fromH: 12, toH: 15 },
  afternoon: { fromH: 15, toH: 18 },
  night: { fromH: 18, toH: 28 },
};
export const DAY_PART_IDS = Object.keys(DAY_PARTS) as DayPartId[];

/** A part's span on a day. The small hours (0–4) belong to the night before. */
export function partSpan(day: BoardDay, part: DayPartId): { start: Date; end: Date } {
  const p = DAY_PARTS[part];
  return { start: new Date(day.start.getTime() + p.fromH * HOUR), end: new Date(day.start.getTime() + p.toH * HOUR) };
}

/** The Baghdad day a car belongs to: before 4 in the morning it is still the night before. */
function dayStartOf(at: Date, offsetMin: number): number {
  return baghdadMidnight(new Date(at.getTime() - 4 * HOUR), offsetMin);
}

/**
 * A car is on its own Baghdad day, except that today also keeps the small hours still ahead: between
 * midnight and 4 a car leaving at 02:30 belongs to last night, which is not on the board, so it shows
 * under today (and today's «الليل»).
 */
export function onDay(dep: Pick<DepartureCard, 'departAt'>, day: BoardDay, offsetMin: number = IRAQ_UTC_OFFSET_MIN): boolean {
  const start = dayStartOf(dep.departAt, offsetMin);
  return start === day.start.getTime() || (day.id === 'today' && start < day.start.getTime());
}

export function inPart(dep: Pick<DepartureCard, 'departAt'>, day: BoardDay, part: DayPartId): boolean {
  const s = partSpan(day, part);
  if (dep.departAt >= s.start && dep.departAt < s.end) return true;
  // Today's small hours (0–4) are the end of a night that started yesterday: they count as today's night.
  return part === 'night' && day.id === 'today' && dep.departAt >= day.start && dep.departAt.getTime() < day.start.getTime() + 4 * HOUR;
}

/** The cars on a day (and a part of it when one is picked). */
export function filterBoard<D extends Pick<DepartureCard, 'departAt'>>(deps: readonly D[], day: BoardDay, part: DayPartId | null, offsetMin: number = IRAQ_UTC_OFFSET_MIN): D[] {
  return deps.filter((d) => onDay(d, day, offsetMin) && (!part || inPart(d, day, part)));
}

/** Cars per day for the day strip («باچر · 4 سيارات»). */
export function dayCounts(deps: readonly Pick<DepartureCard, 'departAt'>[], days: readonly BoardDay[], offsetMin: number = IRAQ_UTC_OFFSET_MIN): Record<BoardDayId, number> {
  const out: Record<BoardDayId, number> = { today: 0, tomorrow: 0, after: 0 };
  for (const d of deps) {
    const day = days.find((x) => onDay(d, x, offsetMin));
    if (day) out[day.id] += 1;
  }
  return out;
}

/** Parts of a day still ahead (today's morning is gone by the afternoon). */
export function partsAhead(day: BoardDay, now: Date): DayPartId[] {
  return DAY_PART_IDS.filter((p) => partSpan(day, p).end.getTime() - now.getTime() > 5 * MIN);
}

/**
 * The day chart (x3): cars leaving in each hour from 4 in the morning to 4 the next, so the busy
 * hours show at a glance. `hours[i]` is the hour 4 + i (Baghdad).
 */
export function hourBars(deps: readonly Pick<DepartureCard, 'departAt'>[], day: BoardDay): number[] {
  const bars = Array.from({ length: 24 }, () => 0);
  const from = day.start.getTime() + 4 * HOUR;
  for (const d of deps) {
    const i = Math.floor((d.departAt.getTime() - from) / HOUR);
    if (i >= 0 && i < 24) bars[i]! += 1;
  }
  return bars;
}

/** When the car reaches the city (s6): the announced time plus the corridor's travel minutes. */
export function arrivalAt(dep: Pick<DepartureCard, 'departAt'>, travelMin: number): Date {
  return new Date(dep.departAt.getTime() + travelMin * MIN);
}

/**
 * The one-tap «نبّهني» wish (s7) for a day, or a part of it: the span still ahead, at most 12 hours
 * (the server's limit), or null when nothing of it is left.
 */
export function wishWindow(day: BoardDay, part: DayPartId | null, now: Date): { start: Date; end: Date } | null {
  const span = part ? partSpan(day, part) : { start: new Date(day.start.getTime() + 4 * HOUR), end: new Date(day.start.getTime() + 28 * HOUR) };
  const start = Math.max(span.start.getTime(), now.getTime());
  if (span.end.getTime() - start <= 5 * MIN) return null;
  // A whole day is longer than a wish may be: from the start, 12 hours.
  const end = Math.min(span.end.getTime(), start + 12 * HOUR);
  return { start: new Date(start), end: new Date(end) };
}

/** The part of the day a time falls in (to open the board on the part of a preset trip). */
export function partOf(at: Date, offsetMin: number = IRAQ_UTC_OFFSET_MIN): DayPartId {
  const h = Math.floor(((at.getTime() + offsetMin * MIN) % DAY) / HOUR);
  if (h >= 4 && h < 12) return 'morning';
  if (h >= 12 && h < 15) return 'noon';
  if (h >= 15 && h < 18) return 'afternoon';
  return 'night';
}
