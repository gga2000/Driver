/**
 * A live order or ride outside the app (joy l1, research S-1): what the Android ongoing (sticky)
 * notification says at each step. Pure: no React Native, unit-tested; `ongoing.native.ts` only shows
 * what this returns. Same shape as the الرجعة pass (`features/rajaa/lockscreen`).
 *
 *   title  the live screen's own status line («يحضّرون طلبك», «حيدر جايبلك طلبك», «عباس وصل»)
 *   body   what helps from the lock screen: the kitchen and the ETA («مطعم خالد · يوصلك ~7:05 م»),
 *          the cash to have ready at the door, a ride's car and plate
 *   sub    the steps as dots («●●●○○○»): food sent → accepted → cooking → ready → on the way → door;
 *          a ride searching → coming → at the pickup → on the trip
 *   end    delivered / arrived: one dismissible «وصل طلبك · قيّم حيدر», then nothing
 *   none   cancelled, failed, disputed, closed: the notification goes
 *
 * iOS: a Live Activity is designed in docs/superpowers/plans/2026-10-07-j5b-live-moments.md (not built).
 */
import type { OrderTracking } from '@driver/contracts';
import { formatClock, type MessageKey } from '@driver/i18n';
import { cashAtDoor } from '../arrival-logic';
import { courierAtDoor, phaseOf, statusLine } from '../timeline';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

export interface LiveNoticeCard {
  /** One notification per order: updates replace it in place. */
  id: string;
  orderId: string;
  title: string;
  body: string;
  /** Android sub text: the steps as dots; null on the end card. */
  sub: string | null;
  /** Ongoing (can't be swiped away) while the order is live; the end card is dismissible. */
  sticky: boolean;
  /** The order screen, through the push deep-link handler. */
  deepLink: string;
}

export const FOOD_STEPS = 6;
export const RIDE_STEPS = 4;

export function liveNoticeId(orderId: string): string {
  return `live-order-${orderId}`;
}

/** «●●●○○○»: `done` filled of `of`. */
export function stepDots(done: number, of: number): string {
  const n = Math.max(0, Math.min(of, done));
  return '●'.repeat(n) + '○'.repeat(of - n);
}

/** How far a food order is, from real events only (1 sent … 6 at the door). */
export function foodStep(v: OrderTracking): number {
  const o = v.order;
  if (o.pickedUpAt) return courierAtDoor(v) ? 6 : 5;
  if (o.readyAt) return 4;
  if (o.preparingAt) return 3;
  if (o.acceptedAt) return 2;
  return 1;
}

/** How far a ride is (1 searching … 4 on the trip). */
export function rideStep(phase: ReturnType<typeof phaseOf>): number {
  if (phase === 'on_the_way') return 4;
  if (phase === 'at_pickup') return 3;
  if (phase === 'to_pickup') return 2;
  return 1;
}

const ENDED: ReadonlySet<ReturnType<typeof phaseOf>> = new Set(['cancelled', 'failed', 'disputed', 'done']);

/**
 * The card for this read of the order, or null when there should be none. `eta` is the screen's one
 * ETA (the server's when it has one); `amount` formats دينار amounts like the app does.
 */
export function liveNoticeCard(v: OrderTracking, i: { eta: Date | null; now: number; t: T; amount: (iqd: number) => string }): LiveNoticeCard | null {
  const phase = phaseOf(v);
  if (ENDED.has(phase)) return null;
  const { t } = i;
  const ride = v.order.type === 'ride';
  const base = { id: liveNoticeId(v.order.id), orderId: v.order.id, deepLink: `driver://order/${v.order.id}` };
  const name = v.courier?.firstName ?? t(ride ? 'track.driver_fallback' : 'track.courier_fallback');
  const title = statusLine(v, t, { now: i.now });
  if (phase === 'arrived') {
    return { ...base, title, body: v.courier ? t('live_notice.rate', { name }) : t('live_notice.open'), sub: null, sticky: false };
  }
  const time = i.eta && i.eta.getTime() > i.now ? formatClock(i.eta) : null;
  const parts: string[] = [];
  if (ride) {
    if (phase === 'to_pickup' || phase === 'at_pickup') {
      const car = [v.courier?.vehicleLabel, v.courier?.plate].filter((x): x is string => Boolean(x));
      parts.push(...car);
    } else if (phase === 'on_the_way' && time) {
      parts.push(t('live_notice.eta_ride', { time }));
    }
    return { ...base, title, body: parts.join(' · '), sub: stepDots(rideStep(phase), RIDE_STEPS), sticky: true };
  }
  if (courierAtDoor(v)) {
    const pay = cashAtDoor(v.order);
    parts.push(pay.kind === 'cash' ? t('track.cash_ready', { amount: i.amount(pay.cashIqd) }) : t('track.door_paid'));
  } else {
    if (v.merchant?.name && !v.order.pickedUpAt) parts.push(v.merchant.name);
    if (time) parts.push(t('live_notice.eta', { time }));
  }
  return { ...base, title, body: parts.join(' · '), sub: stepDots(foodStep(v), FOOD_STEPS), sticky: true };
}

/** Same key → the same words on screen: don't re-post. */
export function liveNoticeKey(card: LiveNoticeCard): string {
  return [card.id, card.title, card.body, card.sub ?? '', card.sticky ? 'live' : 'end'].join('|');
}
