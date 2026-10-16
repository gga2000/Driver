import type { MerchantInsights } from '@driver/contracts';

/**
 * Insights logic (pure, tested): verdicts that turn the numbers into a sentence the owner can act on,
 * the busiest window, heat levels and the hours worth drawing.
 */

export type Verdict = 'good' | 'watch' | 'bad' | 'none';

export interface PrepVerdict {
  kind: 'honest' | 'late' | 'uneven' | 'early' | 'none';
  tone: Verdict;
  /** Whole minutes between the average promise and the average actual time. */
  gapMin: number;
}

/** Within ±2 min of the promise is honest (the courier arrives 2 min before "ready"). */
export const PREP_HONEST_MIN = 2;

export function prepVerdict(p: MerchantInsights['prepHonesty']): PrepVerdict {
  if (!p.samples || p.quotedAvgMin === null || p.actualAvgMin === null) return { kind: 'none', tone: 'none', gapMin: 0 };
  const gap = p.actualAvgMin - p.quotedAvgMin;
  const gapMin = Math.round(Math.abs(gap));
  const onTime = p.onTimeShare ?? 1;
  if (gap > PREP_HONEST_MIN) return { kind: 'late', tone: gap > 6 || onTime < 0.5 ? 'bad' : 'watch', gapMin };
  // Right on average but often late: the average hides orders that come out well after the promise.
  if (onTime < 0.75) return { kind: 'uneven', tone: onTime < 0.5 ? 'bad' : 'watch', gapMin };
  if (gap < -4) return { kind: 'early', tone: 'watch', gapMin };
  return { kind: 'honest', tone: 'good', gapMin };
}

/** Rejection rate bands: ≤ 3 % fine, ≤ 8 % watch, above that it hurts ranking. */
export function rejectionVerdict(rate: number | null): Verdict {
  if (rate === null) return 'none';
  if (rate <= 0.03) return 'good';
  if (rate <= 0.08) return 'watch';
  return 'bad';
}

/** Last full week against the one before ("down" is good). */
export function rejectionTrend(trend: MerchantInsights['rejection']['trend']): 'up' | 'down' | 'flat' | null {
  const rated = trend.filter((b) => b.rate !== null);
  if (rated.length < 2) return null;
  const last = rated.at(-1)!.rate!;
  const prev = rated.at(-2)!.rate!;
  if (Math.abs(last - prev) < 0.005) return 'flat';
  return last < prev ? 'down' : 'up';
}

/** "1.5%" style percent with one decimal under 10, none above. */
export function percent(rate: number): string {
  const p = rate * 100;
  return p < 10 && p % 1 !== 0 ? p.toFixed(1) : String(Math.round(p));
}

/**
 * The busiest window of `width` consecutive hours (wrapping past midnight, a grill's late night),
 * as [from, to) local hours; null with no orders.
 */
export function busiestWindow(hours: readonly number[], width = 2): { from: number; to: number; orders: number } | null {
  if (hours.length !== 24 || hours.every((h) => h === 0)) return null;
  let best = { from: 0, orders: -1 };
  for (let start = 0; start < 24; start++) {
    let sum = 0;
    for (let i = 0; i < width; i++) sum += hours[(start + i) % 24]!;
    if (sum > best.orders) best = { from: start, orders: sum };
  }
  return { from: best.from, to: (best.from + width) % 24, orders: best.orders };
}

/**
 * Hours worth drawing: from the first to the last hour with orders, going round midnight when the
 * store works late (10:00 → 02:00), so the chart isn't half empty. Always at least 8 hours.
 */
export function activeHours(hours: readonly number[]): number[] {
  if (hours.every((h) => h === 0)) return Array.from({ length: 24 }, (_, i) => i);
  // The longest run of empty hours is when the store is closed; start right after it.
  let bestStart = 0;
  let bestLen = -1;
  for (let s = 0; s < 24; s++) {
    if (hours[s] !== 0 || hours[(s + 23) % 24] === 0) continue;
    let len = 0;
    while (len < 24 && hours[(s + len) % 24] === 0) len++;
    if (len > bestLen) {
      bestLen = len;
      bestStart = s;
    }
  }
  if (bestLen <= 0) return Array.from({ length: 24 }, (_, i) => i);
  const first = (bestStart + bestLen) % 24;
  const count = Math.max(8, 24 - bestLen);
  const start = count > 24 - bestLen ? (first - Math.ceil((count - (24 - bestLen)) / 2) + 24) % 24 : first;
  return Array.from({ length: Math.min(24, count) }, (_, i) => (start + i) % 24);
}

/** Heat level 0–4 of a cell against the grid's busiest cell (0 = no orders). */
export function heatLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const r = count / max;
  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1;
}

/** Rating tone: under 3.5 needs attention, under 4.2 is fine, above is great. */
export function ratingTone(avg: number): Verdict {
  if (avg < 3.5) return 'bad';
  if (avg < 4.2) return 'watch';
  return 'good';
}

export type BestSellerMode = 'qty' | 'sales';

export interface BestSellerRow {
  itemId: string;
  nameAr: string | null;
  qty: number;
  salesIqd: number | null;
  rank: number;
  /** Bar length 0…1: this row's value over the largest in the list (the chart's own measure). */
  share: number;
}

/** Whether the "بالعدد / بالفلوس" switch can offer sales (every row carries them — owners). */
export function canRankBySales(list: MerchantInsights['bestSellers']): boolean {
  return list.length > 0 && list.every((b) => b.salesIqd !== null);
}

/**
 * The best-seller list (M-13): ranked by the measure the bars draw and scaled by its largest value,
 * so a bar never contradicts its number. "بالعدد" ranks and scales by quantity (the title "الأكثر
 * طلباً"); "بالفلوس" by sales — only when every row has sales, otherwise by quantity.
 */
export function bestSellerRows(list: MerchantInsights['bestSellers'], mode: BestSellerMode, limit = 8): BestSellerRow[] {
  const bySales = mode === 'sales' && canRankBySales(list);
  const value = (b: MerchantInsights['bestSellers'][number]) => (bySales ? (b.salesIqd ?? 0) : b.qty);
  const sorted = [...list].sort((a, b) => value(b) - value(a) || b.qty - a.qty || (a.nameAr ?? '').localeCompare(b.nameAr ?? '')).slice(0, limit);
  const max = Math.max(0, ...sorted.map(value));
  return sorted.map((b, i) => ({ itemId: b.itemId, nameAr: b.nameAr, qty: b.qty, salesIqd: b.salesIqd, rank: i + 1, share: max > 0 ? value(b) / max : 0 }));
}

/** m4: a Baghdad clock time (minutes since midnight) as an instant whose city clock reads it, for clock12. */
export function cityMinute(minute: number): Date {
  return new Date(Date.UTC(2026, 0, 1) + (minute - 180) * 60_000);
}
