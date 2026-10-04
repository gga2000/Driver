import type { MissedOrder } from '@driver/contracts';

/**
 * "طلبات فاتتك" (UI/UX audit M-01): an order that left the board without the kitchen's answer never
 * vanishes silently. The board lists today's misses (from `merchant.board`) in a danger strip until the
 * kitchen taps "تمام", keeps a "فاتك اليوم" counter in the header, and after two misses in 30 minutes
 * suggests busy mode or a short close. Pure, so it is unit-tested.
 */

/** Two misses in this window → "تشغّل وضع الزحمة أو تسد المحل شوية؟". */
export const MISS_NUDGE_WINDOW_MS = 30 * 60_000;
export const MISS_NUDGE_COUNT = 2;
/** Seen ids kept on the device (today's list is at most a few). */
export const SEEN_MAX = 50;
export const MISSED_SEEN_KEY = 'driver.merchant.missed-seen';

/** Misses the kitchen hasn't acknowledged yet, newest first. */
export function unseenMissed(missed: readonly MissedOrder[], seen: ReadonlySet<string>): MissedOrder[] {
  return missed.filter((m) => !seen.has(m.orderId));
}

/**
 * The nudge: at least two of the kitchen's own misses (nobody accepted in 90 s) in the last 30 minutes,
 * and the newest of them not yet acknowledged — once the kitchen taps "تمام" the nudge goes too.
 */
export function missNudge(missed: readonly MissedOrder[], seen: ReadonlySet<string>, now: number): boolean {
  const recent = missed.filter((m) => m.reason === 'merchant_timeout' && now - m.missedAt.getTime() <= MISS_NUDGE_WINDOW_MS);
  if (recent.length < MISS_NUDGE_COUNT) return false;
  return recent.some((m) => !seen.has(m.orderId));
}

/** Reads the stored seen-ids list (bad or missing data = nothing seen). */
export function parseSeen(raw: string | null): Set<string> {
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Adds ids, keeping the newest `SEEN_MAX`. */
export function addSeen(seen: ReadonlySet<string>, ids: readonly string[]): string[] {
  const all = [...seen].filter((id) => !ids.includes(id));
  return [...all, ...ids].slice(-SEEN_MAX);
}
