import { HOME_KITCHEN_UTC_OFFSET_MIN, type ReserveRule } from '@driver/contracts';
import { clock12 } from '@/lib/time';

type T = (key: never, params?: Record<string, string | number>) => string;

const DAY_MS = 86_400_000;

/** Local day number on the city clock (Iraq keeps UTC+3). */
function localDay(at: Date): number {
  return Math.floor((at.getTime() + HOME_KITCHEN_UTC_OFFSET_MIN * 60_000) / DAY_MS);
}

/** «اليوم» / «باچر» / the weekday, and «1:00 م», for a pickup time. */
export function dayWhen(at: Date, now: Date, t: T): { day: string; time: string } {
  const diff = localDay(at) - localDay(now);
  const dow = new Date(localDay(at) * DAY_MS).getUTCDay();
  const day =
    diff === 0
      ? t('merchant.home_kitchen.today' as never)
      : diff === 1
        ? t('merchant.home_kitchen.tomorrow' as never)
        : t(`merchant.date.dow_${dow}` as never);
  return { day, time: clock12(at) };
}

/** The week as she reads it: Saturday first. */
export const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;

/** Pickup times she can pick from (a home cook's usual hours: breakfast, lunch, dinner). */
export const TIME_CHOICES = [
  '07:00',
  '12:00',
  '13:00',
  '14:00',
  '18:00',
  '19:00',
  '20:00',
] as const;

/** How far ahead a reserved dish must be booked (minutes): 4 hours, a day, two days. */
export const AHEAD_CHOICES = [240, 1440, 2880] as const;

/** A reservation rule that can be saved: at least one day and one time. */
export function ruleReady(rule: ReserveRule): boolean {
  return rule.days.length > 0 && rule.times.length > 0;
}

/** «الصحن يكفي»: one, two, three or four, a family — as the dish's serves range. */
export const SERVES = {
  '1': [1, 1],
  '2': [2, 2],
  '3-4': [3, 4],
  family: [5, 8],
} as const satisfies Record<string, readonly [number, number]>;
export type Serves = keyof typeof SERVES;

/** The chip for a dish's serves range (a range set elsewhere lands on the nearest). */
export function servesOf(min: number | null, max: number | null): Serves {
  const top = max ?? min ?? 1;
  return top <= 1 ? '1' : top <= 2 ? '2' : top <= 4 ? '3-4' : 'family';
}

/** What the customer reads about a reserved dish: «احجز قبل يوم · كل يوم · 1:00 م و 7:00 م». */
export function ruleLine(rule: ReserveRule, t: T): string {
  const days =
    rule.days.length === 7
      ? t('merchant.home_kitchen.every_day' as never)
      : WEEK_ORDER.filter((d) => rule.days.includes(d))
          .map((d) => t(`merchant.date.dow_${d}` as never))
          .join('، ');
  const times = [...rule.times]
    .sort()
    .map((hm) => t(`merchant.home_kitchen.time_${hm.slice(0, 2)}` as never))
    .join(t('merchant.home_kitchen.and' as never));
  return [t(`merchant.home_kitchen.ahead_line_${rule.aheadMin}` as never), days, times].join(' · ');
}
