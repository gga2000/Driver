import { monthNumber, type MonthKey, type StatsMonth, type StatsPeriod, type StatsSaved } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

/**
 * «دفترك ويا درايفر»: which words and shapes the page draws. Every figure is the server's
 * (`wallet.stats`); these only add, order and pick labels.
 */

/** The four services of the month columns, bottom of the stack first (the colour order the chart was checked in). */
export const STACK = ['food', 'tuktuk', 'taxi', 'rajaa'] as const;
export type StackKey = (typeof STACK)[number];

/** «ك2», «شباط» … : the short month name under a column. */
export const shortMonthKey = (m: MonthKey): MessageKey => `stats.mon_${monthNumber(m)}` as MessageKey;

export const columnTotal = (c: StatsMonth): number => c.food + c.taxi + c.tuktuk + c.rajaa;

/** The period's counts per service (the legend when no month is picked). */
export function periodTotals(months: readonly StatsMonth[]): Record<StackKey, number> {
  const out = { food: 0, tuktuk: 0, taxi: 0, rajaa: 0 };
  for (const c of months) for (const k of STACK) out[k] += c[k];
  return out;
}

/**
 * Which columns carry a month name: every one when there are six or fewer, else every third counted
 * back from the latest (so this month is always named and no two names touch at 12 px).
 */
export function labelledColumn(index: number, count: number): boolean {
  return count <= 6 || (count - 1 - index) % 3 === 0;
}

/** The parts of «وفّرت», biggest first, without the empty ones. */
export function savedParts(s: StatsSaved): Array<{ key: MessageKey; amount: number }> {
  const parts: Array<{ key: MessageKey; amount: number }> = [
    { key: 'stats.part_deals', amount: s.dealsIqd },
    { key: 'stats.part_promos', amount: s.promosIqd },
    { key: 'stats.part_points', amount: s.pointsIqd },
    { key: 'stats.part_return', amount: s.returnTripIqd },
  ];
  return parts.filter((p) => p.amount > 0).sort((a, b) => b.amount - a.amount);
}

/** The hero's label: «وفّرت هالشهر», «وفّرت بـأيلول», «وفّرت هالسنة», «وفّرت ويانا». */
export function savedLabel(period: StatsPeriod, month: MonthKey | null, current: MonthKey): { key: MessageKey; monthKey?: MessageKey } {
  if (period === 'year') return { key: 'stats.saved_year' };
  if (period === 'all') return { key: 'stats.saved_all' };
  if (!month || month === current) return { key: 'stats.saved_month' };
  return { key: 'stats.saved_month_past', monthKey: `time.month_${monthNumber(month)}` as MessageKey };
}

/** The dish the food tile shows: the top one when it was ordered at least twice («رجعتلها»), else none. */
export function comebackDish<T extends { orders: number }>(dishes: readonly T[]): T | null {
  const top = dishes[0];
  return top && top.orders >= 2 ? top : null;
}

/** The busiest cell of the "when you order" grid: weekday (0 = Saturday) and band index, or null when empty. */
export function busiest(grid: readonly (readonly number[])[]): { day: number; band: number; n: number } | null {
  let best: { day: number; band: number; n: number } | null = null;
  grid.forEach((row, day) =>
    row.forEach((n, band) => {
      if (n > 0 && (!best || n > best.n)) best = { day, band, n };
    }),
  );
  return best;
}

/** The weekday key of a grid row (0 = Saturday … 6 = Friday) in `time.dow_*` (0 = Sunday). */
export const gridDayKey = (day: number): MessageKey => `time.dow_${(day + 6) % 7}` as MessageKey;

/** «من كل 10,000 دينار صرفتها، X رجعتلك توفير»: whole دينار, null when nothing was spent. */
export function savedPer10k(savedIqd: number, spentIqd: number): number | null {
  if (spentIqd <= 0) return null;
  return Math.round((savedIqd * 10_000) / spentIqd);
}

/** Share of promised orders that arrived in time, as a whole percent (null without a promise). */
export function onTimePercent(p: { promised: number; onTime: number }): number | null {
  return p.promised > 0 ? Math.round((p.onTime * 100) / p.promised) : null;
}

const BAGHDAD_MS = 3 * 3_600_000;

/** A date's Baghdad day, month (1–12) and year, for «3 كانون الثاني 2026». */
export function baghdadDate(at: Date): { day: number; month: number; year: number } {
  const l = new Date(at.getTime() + BAGHDAD_MS);
  return { day: l.getUTCDate(), month: l.getUTCMonth() + 1, year: l.getUTCFullYear() };
}

/** Whole Baghdad days from `first` to `now` (the first day counts as day 1). */
export function daysWithUs(first: Date, now: Date): number {
  const day = (d: Date) => Math.floor((d.getTime() + BAGHDAD_MS) / 86_400_000);
  return Math.max(1, day(now) - day(first) + 1);
}
