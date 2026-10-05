import { t, type MessageKey } from '@driver/i18n';
import { formatClock } from './format';

/**
 * Days and periods on the city's one clock (Asia/Baghdad, UTC+3 all year, no DST): the time presets
 * on /orders, the period picker on the driver ledger, day separators and "أمس 10:08 م" stamps.
 * Pure: every function takes `now`.
 */

const DAY_MS = 86_400_000;
/** Baghdad is UTC+3 all year. */
const OFFSET_MS = 3 * 3_600_000;

/** Midnight in Baghdad of the day `d` falls on. */
export function startOfDay(d: Date): Date {
  return new Date(Math.floor((d.getTime() + OFFSET_MS) / DAY_MS) * DAY_MS - OFFSET_MS);
}

/** `YYYY-MM-DD` of the Baghdad day. */
export function dayKey(d: Date): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight in Baghdad of a `YYYY-MM-DD` key. */
export function dayStart(key: string): Date {
  return new Date(`${key}T00:00:00+03:00`);
}

/** Whole Baghdad days from `d` back to `now` (0 = today, 1 = yesterday). */
export function daysAgo(d: Date, now: Date): number {
  return Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / DAY_MS);
}

/** "4 تشرين الأول" (Iraqi month names, Western digits); the year only when it isn't this year. */
export function dayMonth(d: Date, now: Date = d): string {
  const key = dayKey(d);
  const [y, m, day] = key.split('-').map(Number) as [number, number, number];
  const month = t(`console.month_${m}` as MessageKey);
  return y === Number(dayKey(now).slice(0, 4)) ? `${day} ${month}` : `${day} ${month} ${y}`;
}

/** "الأحد" — the Baghdad weekday. */
export function weekday(d: Date): string {
  return new Intl.DateTimeFormat('ar-IQ-u-nu-latn', { weekday: 'long', timeZone: 'Asia/Baghdad' }).format(d);
}

/** "اليوم" / "أمس" / "الأحد 4 تشرين الأول": a day heading (statement separators). */
export function dayHeading(d: Date, now: Date): string {
  const n = daysAgo(d, now);
  if (n === 0) return t('console.day_today');
  if (n === 1) return t('console.day_yesterday');
  return `${weekday(d)} ${dayMonth(d, now)}`;
}

/** "10:08 م" today, "أمس 10:08 م", else "4 تشرين الأول · 10:08 م": a stamp that never says "4/10". */
export function stamp(d: Date, now: Date): string {
  const n = daysAgo(d, now);
  if (n === 0) return formatClock(d);
  if (n === 1) return `${t('console.day_yesterday')} ${formatClock(d)}`;
  return `${dayMonth(d, now)} · ${formatClock(d)}`;
}

// ───────────────────────── presets ─────────────────────────

export const PERIOD_PRESETS = ['today', 'yesterday', 'week', 'month', 'all', 'custom'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export interface Period {
  preset: PeriodPreset;
  /** Custom range, as Baghdad day keys (inclusive). */
  fromDay?: string | undefined;
  toDay?: string | undefined;
}

/** `[from, to)` of a period in Baghdad days; `all` has no bounds. `week` is today and the 6 days before. */
export function periodRange(p: Period, now: Date): { from?: Date; to?: Date } {
  const today = startOfDay(now);
  switch (p.preset) {
    case 'today':
      return { from: today };
    case 'yesterday':
      return { from: new Date(today.getTime() - DAY_MS), to: today };
    case 'week':
      return { from: new Date(today.getTime() - 6 * DAY_MS) };
    case 'month': {
      const key = dayKey(now);
      return { from: dayStart(`${key.slice(0, 8)}01`) };
    }
    case 'custom': {
      const a = p.fromDay ? dayStart(p.fromDay) : undefined;
      const b = p.toDay ? new Date(dayStart(p.toDay).getTime() + DAY_MS) : undefined;
      // Picked backwards: swap so the range still means what they saw.
      if (a && b && a.getTime() >= b.getTime()) return { from: dayStart(p.toDay!), to: new Date(dayStart(p.fromDay!).getTime() + DAY_MS) };
      return { ...(a ? { from: a } : {}), ...(b ? { to: b } : {}) };
    }
    default:
      return {};
  }
}

/** The last `n` Baghdad days, newest first, for the custom range pickers. */
export function recentDays(now: Date, n = 60): Array<{ key: string; label: string }> {
  const today = startOfDay(now).getTime();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today - i * DAY_MS + 12 * 3_600_000);
    return { key: dayKey(d), label: dayHeading(d, now) };
  });
}

/** The range said back in words: "من 2 تشرين الأول لحد 4 تشرين الأول", "4 تشرين الأول". */
export function rangeWords(p: Period, now: Date): string {
  if (p.preset !== 'custom') return t(`console.period_${p.preset}` as MessageKey);
  const { from, to } = periodRange(p, now);
  if (!from && !to) return t('console.period_all');
  const last = to ? new Date(to.getTime() - 1) : now;
  if (from && dayKey(from) === dayKey(last)) return dayMonth(from, now);
  if (!from) return t('console.period_until', { day: dayMonth(last, now) });
  return t('console.period_between', { from: dayMonth(from, now), to: dayMonth(last, now) });
}
