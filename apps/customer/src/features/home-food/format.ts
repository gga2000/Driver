import type { HomeDishView, HomeSlot, MenuCategory, MenuItem, RestaurantCard } from '@driver/contracts';
import { cityDayDiff, cityParts, formatClock, formatDay, type MessageKey } from '@driver/i18n';

/**
 * أكل بيت, the words and sorting the screens share (pure, so tests pin them): the list's filters, a
 * dish's «احجز قبل يوم», the next free time «الأحد 1:00», and the menu split into ready now and by
 * reservation.
 */

export type HomeFilter = 'all' | 'ready' | 'reserve' | 'sweets';
export const HOME_FILTERS: readonly HomeFilter[] = ['all', 'ready', 'reserve', 'sweets'];

/** The tag a sweets kitchen carries («حلو البيت»). */
export const SWEETS_TAG = 'sweets';

/** Kitchens a filter keeps: plates ready now, dishes taking reservations, or a sweets kitchen. */
export function filterKitchens(kitchens: readonly RestaurantCard[], filter: HomeFilter): RestaurantCard[] {
  return kitchens.filter((k) => {
    if (filter === 'ready') return (k.home?.readyCount ?? 0) > 0;
    if (filter === 'reserve') return (k.home?.reserveCount ?? 0) > 0;
    if (filter === 'sweets') return k.tags.includes(SWEETS_TAG);
    return true;
  });
}

type Copy = { key: MessageKey; params?: Record<string, string | number> };

/** How far ahead a dish must be booked: «احجز قبل 4 ساعات», «احجز قبل يوم», «احجز قبل يومين». */
export function aheadCopy(aheadMin: number): Copy | null {
  if (aheadMin <= 0) return null;
  if (aheadMin < 1440) {
    const h = Math.max(1, Math.round(aheadMin / 60));
    if (h === 1) return { key: 'home_food.ahead_hour' };
    if (h === 2) return { key: 'home_food.ahead_2hours' };
    return { key: 'home_food.ahead_hours', params: { n: h } };
  }
  const d = Math.round(aheadMin / 1440);
  if (d === 1) return { key: 'home_food.ahead_day' };
  if (d === 2) return { key: 'home_food.ahead_2days' };
  return { key: 'home_food.ahead_days', params: { n: d } };
}

/** A pickup time the way the menu says it: «اليوم 7:00 م», «باچر 1:00 م», «الأحد 1:00 م». */
export function slotWhen(at: Date, now: Date): { day: string; time: string } {
  return { day: formatDay(at, now), time: formatClock(at) };
}

/** A day chip in the reserve sheet: «اليوم» / «باچر» / the weekday's short name, over the day of the month. */
export function dayChip(day: { day: string; dow: number }, now: Date): { label: Copy; date: number } {
  const at = new Date(`${day.day}T12:00:00+03:00`);
  const diff = cityDayDiff(at, now);
  const label: Copy = diff === 0 ? { key: 'time.today' } : diff === 1 ? { key: 'time.tomorrow' } : { key: `home_food.dow_${day.dow}` as MessageKey };
  return { label, date: cityParts(at).day };
}

/** Plates still free across a day's times (0 = the day is fully booked). */
export function dayLeft(slots: readonly HomeSlot[]): number {
  return slots.reduce((a, s) => a + s.left, 0);
}

/** The first time in a day with a plate free, else the day's first time. */
export function firstOpenSlot(slots: readonly HomeSlot[]): HomeSlot | null {
  return slots.find((s) => s.left > 0) ?? slots[0] ?? null;
}

export interface HomeMenu {
  ready: MenuItem[];
  reserve: MenuItem[];
}

/** The menu split by how each dish is sold, in menu order; a dish with no home view goes with the ready ones. */
export function splitMenu(categories: readonly MenuCategory[]): HomeMenu {
  const ready: MenuItem[] = [];
  const reserve: MenuItem[] = [];
  for (const c of categories) for (const i of c.items) (i.home?.mode === 'reserve' ? reserve : ready).push(i);
  return { ready, reserve };
}

/** A ready dish's row: plates cooked (when she said) and left, as dots up to `max`, else a count. */
export function platesOf(view: Extract<HomeDishView, { mode: 'ready' }>, max = 10): { total: number; left: number; dots: boolean } {
  const total = view.cooked ?? view.left;
  return { total, left: Math.min(view.left, total), dots: total > 0 && total <= max };
}
