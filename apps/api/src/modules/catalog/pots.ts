import { localDateKey, localMinutes } from '../../shared/local-time.js';
import type { DailyPotRecord } from './catalog.repository.js';

/**
 * «قدر اليوم» (joy h2) as plain data: which day a pot belongs to, whether it still shows, and what the
 * Merchant app offers as one tap (the same weekday last week, then the recent ones). Pure; the clock is
 * passed in.
 */

const DAY_MS = 86_400_000;

/** Today's Baghdad date key ("YYYY-MM-DD"). */
export function potDay(now: Date): string {
  return localDateKey(now);
}

/** A Baghdad date key `days` days before `localDate`. */
export function daysBefore(localDate: string, days: number): string {
  const t = Date.parse(`${localDate}T00:00:00Z`) - days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Today's pot still shows: posted for today, and its «لحد» time (if any) not passed yet. */
export function potShowing(pot: Pick<DailyPotRecord, 'localDate' | 'until'>, now: Date): boolean {
  if (pot.localDate !== potDay(now)) return false;
  return pot.until === null || localMinutes(now) < toMin(pot.until);
}

/**
 * The Merchant app's one tap: the pot of the same weekday last week (when that dish is still on sale),
 * then the other dishes posted since `sinceDays` ago, newest first, each once, today's excluded.
 */
export function potSuggestions(
  pots: ReadonlyArray<Pick<DailyPotRecord, 'localDate' | 'itemId'>>,
  today: string,
  onSale: (itemId: string) => boolean,
): { lastWeek: string | null; recent: string[] } {
  const weekAgo = daysBefore(today, 7);
  const lastWeekPot = pots.find((p) => p.localDate === weekAgo);
  const lastWeek = lastWeekPot && onSale(lastWeekPot.itemId) ? lastWeekPot.itemId : null;
  const todays = pots.find((p) => p.localDate === today)?.itemId ?? null;
  const recent: string[] = [];
  for (const p of [...pots].sort((a, b) => b.localDate.localeCompare(a.localDate))) {
    if (p.localDate >= today || p.itemId === lastWeek || p.itemId === todays || recent.includes(p.itemId) || !onSale(p.itemId)) continue;
    recent.push(p.itemId);
  }
  return { lastWeek: lastWeek === todays ? null : lastWeek, recent };
}
