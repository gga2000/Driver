import type { TFn, TKey } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { dayMonth, lastDay, type ApiDealType, type DealDisplay } from './logic';

/** Copy helpers for deals (need `t`, so they live outside the pure logic). */

const DAY_KEYS: readonly TKey[] = ['merchant.deals.day_0', 'merchant.deals.day_1', 'merchant.deals.day_2', 'merchant.deals.day_3', 'merchant.deals.day_4', 'merchant.deals.day_5', 'merchant.deals.day_6'];

export function dayName(t: TFn, day: number): string {
  return t(DAY_KEYS[day] ?? DAY_KEYS[0]!);
}

/** "خصم 20%", "1,000 دينار خصم", "توصيل ببلاش", "واحد ويا واحد ببلاش". */
export function dealHeadline(t: TFn, type: ApiDealType, value: number): string {
  if (type === 'percent') return t('merchant.deals.headline_percent', { value });
  if (type === 'fixed') return t('merchant.deals.headline_fixed', { amount: amountParam(value) });
  if (type === 'free_delivery') return t('merchant.deals.headline_free_delivery');
  return t('merchant.deals.headline_bogo');
}

/** "19:00" → "7:00". */
export function hour12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${(h ?? 0) % 12 || 12}:${String(m ?? 0).padStart(2, '0')}`;
}

export function daysText(t: TFn, days: readonly number[]): string {
  if (days.length === 0 || days.length === 7) return t('merchant.deals.every_day');
  return days.map((d) => dayName(t, d)).join('، ');
}

export function hoursText(t: TFn, hours: { start: string; end: string } | undefined): string {
  if (!hours) return t('merchant.deals.all_hours');
  return t('merchant.deals.hours_range', { start: hour12(hours.start), end: hour12(hours.end) });
}

export function rangeText(t: TFn, startsAt: Date, endsAt: Date): string {
  return t('merchant.deals.range', { from: dayMonth(startsAt), to: dayMonth(lastDay(endsAt)) });
}

export const DISPLAY_LABEL: Record<DealDisplay, TKey> = {
  active: 'merchant.deals.state_active',
  pending: 'merchant.deals.state_pending',
  scheduled: 'merchant.deals.state_scheduled',
  capped: 'merchant.deals.state_capped',
  paused: 'merchant.deals.state_paused',
  ended: 'merchant.deals.state_ended',
  rejected: 'merchant.deals.state_rejected',
};

export const DISPLAY_TONE: Record<DealDisplay, 'success' | 'warning' | 'info' | 'neutral' | 'danger'> = {
  active: 'success',
  pending: 'warning',
  scheduled: 'neutral',
  capped: 'warning',
  paused: 'neutral',
  ended: 'neutral',
  rejected: 'danger',
};

/** Covered dishes: "كل المنيو" or the first names and "+N". */
export function itemsText(t: TFn, itemIds: readonly string[], names: ReadonlyMap<string, string>, max = 2): string {
  if (itemIds.length === 0) return t('merchant.deals.whole_menu');
  const known = itemIds.map((id) => names.get(id)).filter((n): n is string => !!n);
  const shown = known.slice(0, max).join('، ');
  const more = itemIds.length - Math.min(max, known.length);
  return more > 0 ? t('merchant.deals.items_more', { items: shown, count: more }) : shown;
}
