import type { RamadanToday, Timetable, TimetableTimes } from '@driver/contracts';
import { IFTAR_MIN_LEAD_MIN, IFTAR_ORDER_WINDOW_MIN, ramadanLine, timesFor, type RamadanLine } from '@/features/season/ramadan';

/**
 * Home through a Ramadan day (home roast 4, 2026-10-12): at noon on a fasting day home said «وقت
 * الغدا» and offered lunch under the iftar countdown. Instead it follows the fast: iftar food in the
 * day, only the kitchens that still make it in the last hours before the adhan, sweets after iftar
 * and suhoor food at night. Pure, with the clock passed in.
 *
 *   fast (iftar more than 3 h away) · iftar_soon (the last 3 h) · after_iftar (to 23:00) · suhoor
 */
export type RamadanPhase = 'fast' | 'iftar_soon' | 'after_iftar' | 'suhoor';

/** After iftar the evening is for sweets and tea until this Baghdad hour; then it's suhoor. */
const SUHOOR_FROM_HOUR = 23;

/**
 * The times home goes by: the person's timetable, else (before they pick one) the later of the two,
 * so sweets never show while anyone in town is still fasting.
 */
export function homeTimes(ramadan: RamadanToday | null, pick: Timetable | null): TimetableTimes | null {
  if (!ramadan) return null;
  const mine = timesFor(ramadan, pick);
  if (mine) return mine;
  const { sunni, shia } = ramadan.timetables;
  return sunni.iftarAt.getTime() >= shia.iftarAt.getTime() ? sunni : shia;
}

/** Where the day is, from the Ramadan line and the Baghdad hour; null on an ordinary day or the last evening. */
export function ramadanPhase(line: RamadanLine | null, hour: number): RamadanPhase | null {
  if (!line || line.kind === 'none') return null;
  if (line.kind === 'iftar') return line.minutes > IFTAR_ORDER_WINDOW_MIN ? 'fast' : 'iftar_soon';
  return hour >= 12 && hour < SUHOOR_FROM_HOUR ? 'after_iftar' : 'suhoor';
}

export interface RamadanDay {
  phase: RamadanPhase;
  line: RamadanLine;
  times: TimetableTimes;
}

/** Today's place in the fast for home, or null when it isn't a Ramadan day (or the fast is over). */
export function ramadanDay(ramadan: RamadanToday | null, pick: Timetable | null, now: Date, hour: number): RamadanDay | null {
  const times = homeTimes(ramadan, pick);
  if (!times) return null;
  const line = ramadanLine(times, now);
  const phase = ramadanPhase(line, hour);
  return phase ? { phase, line, times } : null;
}

/**
 * The dish button orders for iftar («على الفطور», concept C) while the fast is on and checkout still
 * offers the iftar slot: the person picked a timetable (the slot is theirs, never assumed) and it is at
 * least checkout's lead away.
 */
export function iftarOrderOpen(day: RamadanDay | null, pick: Timetable | null, now: Date): boolean {
  if (!day || !pick || (day.phase !== 'fast' && day.phase !== 'iftar_soon')) return false;
  return day.times.slotAt.getTime() - now.getTime() >= IFTAR_MIN_LEAD_MIN * 60_000;
}
