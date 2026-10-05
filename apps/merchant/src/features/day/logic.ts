import type { MerchantDaySummary } from '@driver/contracts';
import type { TKey } from '@/lib/i18n-core';

/**
 * S-M6 · the end-of-day card (UI/UX audit merchant-and-console §8), free of React Native so it is
 * unit-tested: when the board shows it, its four facts, the advice line and the image it shares.
 * The numbers come from the server (`merchantAdmin.daySummary`); nothing here computes money.
 */

export const DAY_DISMISSED_KEY = 'driver.merchant.day_dismissed';
const KEEP = 14;

/** One card per store and day: "تمام" hides it on this device. */
export function dayCardKey(merchantOrgId: string, localDate: string): string {
  return `${merchantOrgId}:${localDate}`;
}

export function parseDismissed(raw: string | null): string[] {
  try {
    const v: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-KEEP) : [];
  } catch {
    return [];
  }
}

export function addDismissed(list: readonly string[], key: string): string[] {
  return [...list.filter((k) => k !== key), key].slice(-KEEP);
}

/** The board shows the card when the server says it is due and this device hasn't said "تمام". */
export function showDayCard(s: Pick<MerchantDaySummary, 'merchantOrgId' | 'localDate' | 'due'> | undefined, dismissed: readonly string[]): boolean {
  return Boolean(s?.due) && !dismissed.includes(dayCardKey(s!.merchantOrgId, s!.localDate));
}

export interface DayFact {
  key: 'orders' | 'missed' | 'on_time' | 'net';
  label: TKey;
  /** What the fact says, ready for `t()`: a counted phrase or an amount. */
  value: { key: TKey; params: Record<string, number> } | { amountIqd: number };
  tone: 'text' | 'danger' | 'success' | 'muted';
  /** The one bold number of the card. */
  hero?: boolean;
}

/** "42 طلب · فاتك 0 · وقتك مضبوط 91% · الصافي 512,000 دينار" as four facts (the net only for the owner). */
export function dayFacts(s: Pick<MerchantDaySummary, 'orders' | 'missed' | 'onTimeShare' | 'netIqd'>): DayFact[] {
  const out: DayFact[] = [
    { key: 'orders', label: 'merchant.day.orders_label', value: { key: 'merchant.day.orders', params: { count: s.orders } }, tone: 'text' },
    { key: 'missed', label: 'merchant.day.missed_label', value: { key: 'merchant.day.missed', params: { count: s.missed } }, tone: s.missed > 0 ? 'danger' : 'success' },
  ];
  if (s.onTimeShare !== null) {
    const pct = Math.round(s.onTimeShare * 100);
    out.push({ key: 'on_time', label: 'merchant.day.on_time_label', value: { key: 'merchant.day.on_time', params: { percent: pct } }, tone: pct >= 75 ? 'success' : 'danger' });
  } else {
    out.push({ key: 'on_time', label: 'merchant.day.on_time_label', value: { key: 'merchant.day.on_time_none', params: {} }, tone: 'muted' });
  }
  if (s.netIqd !== null) out.push({ key: 'net', label: 'merchant.day.net_label', value: { amountIqd: s.netIqd }, tone: 'text', hero: true });
  return out;
}

const ADVICE: Record<NonNullable<MerchantDaySummary['advice']>['kind'], TKey> = {
  missed: 'merchant.day.advice_missed',
  prep_late: 'merchant.day.advice_prep_late',
  prep_uneven: 'merchant.day.advice_prep_uneven',
  prep_early: 'merchant.day.advice_prep_early',
  rejected: 'merchant.day.advice_rejected',
  honest: 'merchant.day.advice_honest',
};

/** The one advice line (Insights' verdicts on the day's own numbers), or null. */
export function adviceLine(a: MerchantDaySummary['advice']): { key: TKey; params: Record<string, number> } | null {
  if (!a) return null;
  const params: Record<string, number> = {};
  if (a.minutes !== null) params['minutes'] = a.minutes;
  if (a.percent !== null) params['percent'] = a.percent;
  return { key: ADVICE[a.kind], params };
}

/** "اليوم" at close; "البارحة" when the card shows after midnight for the day that ended. */
export function dayTitleKey(s: Pick<MerchantDaySummary, 'reason' | 'localDate'>, todayKey: string): TKey {
  return s.localDate === todayKey ? 'merchant.day.title_today' : 'merchant.day.title_yesterday';
}
