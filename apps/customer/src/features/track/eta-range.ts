import type { EtaBasis } from '@driver/contracts';
import type { TFn } from './timeline';

/** A straight-line estimate can be this much quicker … */
const LOW_FACTOR = 0.8;
/** … or this much slower than its single number (no road route: river, one-way streets, alleys). */
const HIGH_FACTOR = 1.25;
/** The narrowest range worth showing as a range. */
const MIN_SPREAD = 2;

/**
 * Joy f19 / maps spec c3: minutes are one number when the ETA was routed on real roads, and a range
 * when it is the straight-line estimate — an honest "6–10" beats a precise-looking guess.
 */
export function minutesRange(minutes: number, basis: EtaBasis | null): { low: number; high: number } {
  if (basis !== 'estimated') return { low: minutes, high: minutes };
  const low = Math.max(1, Math.round(minutes * LOW_FACTOR));
  return { low, high: Math.max(low + MIN_SPREAD, Math.round(minutes * HIGH_FACTOR)) };
}

/**
 * The pill on the courier: «8 دقايق», or «6–10 دقايق» / «16–25 دقيقة» for an estimate (digits kept
 * left-to-right; `t()` gives the minutes their natural form, joy J-D9).
 */
export function mapMinutesLabel(t: TFn, minutes: number, basis: EtaBasis | null): string {
  const r = minutesRange(minutes, basis);
  if (r.low === r.high) return t('track.map_minutes', { minutes });
  const range = `⁦${r.low}–${r.high}⁩`;
  return t('track.map_minutes_range', { range });
}
