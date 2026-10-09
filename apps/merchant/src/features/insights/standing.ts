import type { MerchantInsights } from '@driver/contracts';
import type { Verdict } from './logic';

/**
 * «وضعك» (Ali 2026-10-08, x6): instead of the vague «الرفض ينزّل ترتيبك», the shop's honest standing
 * over the last 30 days in three real numbers the owner and his staff both see — how many orders came
 * out on time, how many it accepted, and the customers' food score. Pure, tested.
 */

/** Below this many orders offered to the kitchen the numbers swing on one order: «بعد ما عندك طلبات كافية». */
export const STANDING_MIN_ORDERS = 10;
/** The window the card reads (the insights call's `days`). */
export const STANDING_DAYS = 30;

export interface StandingRow {
  key: 'on_time' | 'accepted' | 'rating';
  /** 0–100 for the shares; the 1–5 score to one decimal for the rating; null when nothing to count. */
  value: number | null;
  /** 0–1, for the bar. */
  fill: number;
  tone: Verdict;
  /** How many orders (or ratings) the number is made of. */
  count: number;
}

export type Standing = { state: 'empty'; offered: number } | { state: 'ready'; rows: StandingRow[] };

function band(value: number, good: number, watch: number): Verdict {
  return value >= good ? 'good' : value >= watch ? 'watch' : 'bad';
}

export function standingOf(i: MerchantInsights): Standing {
  const offered = i.rejection.offered;
  if (offered < STANDING_MIN_ORDERS) return { state: 'empty', offered };
  const share = i.prepHonesty.onTimeShare;
  const onTime = share === null || i.prepHonesty.samples === 0 ? null : Math.round(share * 100);
  const accepted = Math.round(((offered - i.rejection.rejected) / offered) * 100);
  const rating = i.foodRating && i.foodRating.count > 0 ? i.foodRating.avg : null;
  return {
    state: 'ready',
    rows: [
      { key: 'on_time', value: onTime, fill: onTime === null ? 0 : onTime / 100, tone: onTime === null ? 'none' : band(onTime, 80, 60), count: i.prepHonesty.samples },
      { key: 'accepted', value: accepted, fill: accepted / 100, tone: band(accepted, 95, 85), count: offered },
      { key: 'rating', value: rating, fill: rating === null ? 0 : rating / 5, tone: rating === null ? 'none' : band(rating, 4.5, 4), count: i.foodRating?.count ?? 0 },
    ],
  };
}

/** "4.6" with one decimal, "5" when whole (Western digits). */
export function ratingText(avg: number): string {
  return avg % 1 === 0 ? String(avg) : avg.toFixed(1);
}
