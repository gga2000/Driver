import type { DayAdviceKind, MerchantDaySummary, Order } from '@driver/contracts';
import { t } from '@driver/i18n';
import { localDateKey, localMinutes } from '../../shared/local-time.js';
import { PREP_ON_TIME_GRACE_MIN } from './insights.js';

/**
 * S-M6 · the end-of-day card (UI/UX audit merchant-and-console §8): pure, so the day rules, the
 * advice and the WhatsApp text (Iraqi plurals) are unit-tested without the rest of the API.
 */

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
/** The card for a day that has ended shows from 00:30 (a grill open past midnight has had its last orders)… */
export const DAY_END_SHOW_FROM_MIN = 30;
/** …until 05:00, when the next day's kitchen starts. Before 05:00 "the day" is still yesterday's. */
export const DAY_START_MIN = 5 * 60;

/** States in which the kitchen never took the order, or it was called off. */
const NOT_TAKEN: ReadonlySet<string> = new Set(['placed', 'merchant_rejected', 'customer_cancelled', 'platform_cancelled']);

/**
 * Which day the card is about now, and whether it is due: from 00:30 to 05:00 it is the day before
 * and due by itself (`day_end`); otherwise it is today and due once the store is closed for the day
 * (closed by hand or out of its hours: `closed`).
 */
export function summaryDay(now: Date, closedNow: boolean): { localDate: string; due: boolean; reason: MerchantDaySummary['reason'] } {
  const m = localMinutes(now);
  if (m < DAY_START_MIN) {
    const localDate = localDateKey(new Date(now.getTime() - DAY_MS));
    if (closedNow) return { localDate, due: true, reason: 'closed' };
    return m >= DAY_END_SHOW_FROM_MIN ? { localDate, due: true, reason: 'day_end' } : { localDate, due: false, reason: null };
  }
  return { localDate: localDateKey(now), due: closedNow, reason: closedNow ? 'closed' : null };
}

export interface DayCounts {
  orders: number;
  missed: number;
  rejected: number;
  onTimeShare: number | null;
  onTimeSamples: number;
  /** Average minutes "جاهز" came after the promise (negative = early); null without a sample. */
  gapMin: number | null;
}

/** The day's numbers from its orders. `inPause(at)`: a miss inside a declared pause doesn't count (review A.1). */
export function dayCounts(orders: readonly Order[], inPause: (at: Date) => boolean = () => false): DayCounts {
  let taken = 0;
  let missed = 0;
  let rejected = 0;
  let samples = 0;
  let onTime = 0;
  let gap = 0;
  for (const o of orders) {
    if (!NOT_TAKEN.has(o.state)) taken += 1;
    if (o.state === 'merchant_rejected') {
      if (o.cancellationReason === 'merchant_timeout') {
        if (!inPause(o.cancelledAt ?? o.placedAt)) missed += 1;
      } else rejected += 1;
    }
    if (o.acceptedAt && o.promisedReadyAt && o.readyAt) {
      samples += 1;
      gap += (o.readyAt.getTime() - o.promisedReadyAt.getTime()) / MIN_MS;
      if (o.readyAt.getTime() <= o.promisedReadyAt.getTime() + PREP_ON_TIME_GRACE_MIN * MIN_MS) onTime += 1;
    }
  }
  return {
    orders: taken,
    missed,
    rejected,
    onTimeShare: samples > 0 ? Math.round((onTime / samples) * 1000) / 1000 : null,
    onTimeSamples: samples,
    gapMin: samples > 0 ? Math.round((gap / samples) * 10) / 10 : null,
  };
}

/**
 * The one line to act on tomorrow, most costly first: a missed order (lost money and score), then
 * promising less time than the kitchen takes, an uneven kitchen, rejections, promising too much;
 * else "keep it so" when there was something to judge. Same thresholds as Insights' verdicts.
 */
export function dayAdvice(c: DayCounts): MerchantDaySummary['advice'] {
  const advice = (kind: DayAdviceKind, minutes: number | null = null, percent: number | null = null) => ({ kind, minutes, percent });
  if (c.missed > 0) return advice('missed');
  if (c.gapMin !== null && c.gapMin > 2) return advice('prep_late', Math.round(c.gapMin));
  if (c.onTimeShare !== null && c.onTimeShare < 0.75) return advice('prep_uneven', null, Math.round((1 - c.onTimeShare) * 100));
  if (c.rejected > 0) return advice('rejected');
  if (c.gapMin !== null && c.gapMin < -4) return advice('prep_early', Math.round(-c.gapMin));
  if (c.onTimeSamples > 0) return advice('honest');
  return null;
}

const digits = (n: number) => n.toLocaleString('en-US');

/** "الأحد 5/10" for a Baghdad local date. */
export function dayLabel(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${t(`time.dow_${dow}` as Parameters<typeof t>[0])} ${t('time.date', { day: d, month: m })}`;
}

/**
 * The WhatsApp text: store and day, "42 طلب · فاتك 0 · وقتك مضبوط 91%", the net for the owner, the
 * sender. Iraqi plurals for طلب (طلب واحد · طلبين · 3 طلبات · 11 طلب), Western digits, دينار.
 */
export function dayShareText(input: { storeName: string; localDate: string; counts: DayCounts; netIqd: number | null }): string {
  const c = input.counts;
  const facts = [t('merchant_day.share_orders', { count: c.orders }), t('merchant_day.share_missed', { count: c.missed })];
  if (c.onTimeShare !== null) facts.push(t('merchant_day.share_on_time', { percent: Math.round(c.onTimeShare * 100) }));
  const lines = [t('merchant_day.share_title', { store: input.storeName, day: dayLabel(input.localDate) }), facts.join(' · ')];
  if (input.netIqd !== null) lines.push(t('merchant_day.share_net', { amount: digits(input.netIqd) }));
  lines.push(t('merchant_day.share_footer'));
  return lines.join('\n');
}

export function composeDaySummary(input: {
  merchantOrgId: string;
  storeName: string;
  day: { localDate: string; due: boolean; reason: MerchantDaySummary['reason'] };
  orders: readonly Order[];
  inPause?: (at: Date) => boolean;
  /** Owner only; null for staff. */
  netIqd: number | null;
}): MerchantDaySummary {
  const counts = dayCounts(input.orders, input.inPause);
  // An order's money is booked when it is delivered: a day whose orders are all still in the kitchen
  // or on the road has no net yet, and "6 طلبات · الصافي 0 دينار" would read as a day of free food.
  const netIqd = input.netIqd === 0 && counts.orders > 0 ? null : input.netIqd;
  return {
    merchantOrgId: input.merchantOrgId,
    storeName: input.storeName,
    localDate: input.day.localDate,
    due: input.day.due && counts.orders + counts.missed > 0,
    reason: input.day.due && counts.orders + counts.missed > 0 ? input.day.reason : null,
    orders: counts.orders,
    missed: counts.missed,
    onTimeShare: counts.onTimeShare,
    onTimeSamples: counts.onTimeSamples,
    rejected: counts.rejected,
    netIqd,
    advice: dayAdvice(counts),
    share_ar: dayShareText({ storeName: input.storeName, localDate: input.day.localDate, counts, netIqd }),
  };
}
