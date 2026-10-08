import { hhmmToMinutes, STORE_PAUSE_RULES, type EarlyCloseReason, type StoreHoursView } from '@driver/contracts';
import { localParts, startOfLocalDay } from '@/lib/calendar';

/**
 * «وقفة قصيرة» on المحل (counter step 5, h2): the pauses a shop takes most, one tap each. Pure, tested.
 * Each one closes the shop with a reason and a length, and the server opens it again by itself when
 * the time is up (orders already in keep going). Lengths come from the shop's own day:
 *
 *  - prayer:   on a Friday before the city's prayer pause ends, until it ends («لحد 1:15»); any
 *              other time a short 15 minutes
 *  - power:    20 minutes, the usual wait for the generator line to switch over
 *  - sold_out: until the shop's next opening tomorrow, from its weekly hours; a shop with no hours
 *              on file, or a next opening more than a day and a half away, stays closed until
 *              someone opens it by hand
 */

export type QuickPauseId = 'prayer' | 'power' | 'sold_out';

export interface QuickPause {
  id: QuickPauseId;
  reason: EarlyCloseReason;
  /** Words saved with the close (the reason list has no «صلاة»). */
  note: string | null;
  /** Null: closed until opened by hand. */
  minutes: number | null;
  /** When it opens again, as a Baghdad instant (for «لحد 1:15»); null with `minutes` null. */
  until: number | null;
  /** The prayer pause runs to the end of the city's Friday window («صلاة الجمعة»). */
  friday?: boolean;
}

export const POWER_PAUSE_MIN = 20;
export const PRAYER_PAUSE_MIN = 15;
const DAY_MS = 86_400_000;

type Hours = Pick<StoreHoursView, 'days' | 'pauses' | 'source'>;

/** The end of today's Friday-prayer pause window, if it has not ended yet. */
export function prayerEnd(hours: Hours | undefined, now: number): number | null {
  if (!hours) return null;
  const p = localParts(now);
  const today = startOfLocalDay(now);
  const nowMin = p.hour * 60 + p.minute;
  for (const w of hours.pauses) {
    if (w.dow !== p.dow) continue;
    const end = hhmmToMinutes(w.end);
    if (end > nowMin) return today + end * 60_000;
  }
  return null;
}

/** The shop's first opening on a day after today (from its weekly hours), or null. */
export function nextDayOpening(hours: Hours | undefined, now: number): number | null {
  if (!hours || hours.source === 'none') return null;
  const today = startOfLocalDay(now);
  const dow = localParts(now).dow;
  for (let d = 1; d <= 7; d++) {
    const day = hours.days.find((x) => x.dow === (dow + d) % 7);
    const first = day?.shifts.map((s) => hhmmToMinutes(s.start)).sort((a, b) => a - b)[0];
    if (first !== undefined) return today + d * DAY_MS + first * 60_000;
  }
  return null;
}

/** Whole minutes from now to `until`, or null when it is outside what the server takes. */
export function pauseMinutesUntil(until: number, now: number): number | null {
  const minutes = Math.ceil((until - now) / 60_000);
  return minutes >= STORE_PAUSE_RULES.minMinutes && minutes <= STORE_PAUSE_RULES.maxMinutes ? minutes : null;
}

export function quickPauses(hours: Hours | undefined, now: number, notes: { friday: string; prayer: string }): QuickPause[] {
  const prayerUntil = prayerEnd(hours, now);
  const prayerMin = prayerUntil !== null ? pauseMinutesUntil(prayerUntil, now) : null;
  const opening = nextDayOpening(hours, now);
  const soldOutMin = opening !== null ? pauseMinutesUntil(opening, now) : null;
  return [
    prayerMin !== null
      ? { id: 'prayer', reason: 'other', note: notes.friday, minutes: prayerMin, until: now + prayerMin * 60_000, friday: true }
      : { id: 'prayer', reason: 'other', note: notes.prayer, minutes: PRAYER_PAUSE_MIN, until: now + PRAYER_PAUSE_MIN * 60_000 },
    { id: 'power', reason: 'power_cut', note: null, minutes: POWER_PAUSE_MIN, until: now + POWER_PAUSE_MIN * 60_000 },
    { id: 'sold_out', reason: 'sold_out', note: null, minutes: soldOutMin, until: soldOutMin !== null ? now + soldOutMin * 60_000 : null },
  ];
}

/** Lengths offered under «مدة ثانية» and on the shutter's close sheet; null = until opened by hand. */
export const OTHER_LENGTHS: readonly (number | null)[] = [30, 60, 120, null];

/**
 * j4 «عاشت إيدك»: said when the day's work is done, i.e. the shop closes with no time to come back and
 * either says it is closing for the day or it is evening (8 م onwards, or the small hours).
 */
export function endOfDayClose(reason: EarlyCloseReason, minutes: number | null, now: number): boolean {
  if (minutes !== null) return false;
  if (reason === 'closing_early') return true;
  const hour = localParts(now).hour;
  return hour >= 20 || hour < 5;
}
