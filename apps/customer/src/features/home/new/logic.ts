import type { DepartureCard, Order, OrderTracking, Usual } from '@driver/contracts';
import { cityDayDiff, dayPart, formatClock, formatHourPart, type MessageKey } from '@driver/i18n';
import type { Departure, HomeChip, HomeDish, OrderNotice, OrderStage, UsualOrder } from '@driver/ui/home';
import { boardSummary } from '@/features/rajaa/logic';
import { itemsSummary } from '@/features/orders/reorder';
import type { TFn } from '@/lib/i18n';
import type { RestaurantSummary } from '../restaurant-summary';

/**
 * The new home's data rules (docs/specs/2026-11-01-home-redesign.md §12, step 4): plain functions from
 * the server's reads to the props of the `@driver/ui/home` pieces, so the screen only lays them out.
 */

/** The four steps the panel draws, from the order's state. Rides read the same way: asked, coming, on the way, there. */
export function orderStage(o: Pick<Order, 'state'>): OrderStage {
  switch (o.state) {
    case 'placed':
    case 'merchant_accepted':
      return 'placed';
    case 'preparing':
    case 'ready':
      return 'preparing';
    case 'matched':
    case 'picked_up':
      return 'on_way';
    case 'delivered':
    case 'completed':
    case 'closed':
    case 'disputed':
    case 'refunded':
      return 'arrived';
    case 'customer_cancelled':
    case 'platform_cancelled':
    case 'merchant_rejected':
    case 'failed':
      return 'cancelled';
    default:
      return 'placed';
  }
}

/** Whole minutes from now to the arrival time; null when there is none yet (never below 0). */
export function minutesTo(eta: Date | null, now: number): number | null {
  if (!eta) return null;
  return Math.max(0, Math.round((eta.getTime() - now) / 60_000));
}

/**
 * The honest-delay band: only once the one apology went out (with its new time), and the rule's line
 * from the order's own promise («إذا تعدّى التأخير 20 دقيقة، نرجعلك أجرة التوصيل رصيد»). Nothing before.
 */
export function lateNotice(v: Pick<OrderTracking, 'latePromise'> | null | undefined, t: TFn): Extract<OrderNotice, { tone: 'late' }> | undefined {
  const p = v?.latePromise;
  if (!p?.apology) return undefined;
  const text = p.basis === 'delivery_fee' ? t('track.note_late_credit', { minutes: p.afterMin }) : t('track.note_late_credit_flat', { minutes: p.afterMin, amount: p.creditIqd });
  return { tone: 'late', title: t('home.panel.late_title'), time: formatHourPart(p.apology.etaAt), text };
}

/** Cash to hand at the door: the cash order's rounded total; nothing for wallet orders. */
export function cashToHand(o: Pick<Order, 'paymentMethod' | 'totalIqd'>): number | undefined {
  return o.paymentMethod === 'cash' && o.totalIqd > 0 ? o.totalIqd : undefined;
}

/** The courier or driver on the panel: first name and approved photo; nobody until one is on it. */
export function personOf(v: Pick<OrderTracking, 'courier'> | null | undefined, o: Pick<Order, 'type'>): { name: string; photo?: string; kind: 'courier' | 'driver' } | undefined {
  const c = v?.courier;
  if (!c?.firstName) return undefined;
  return { name: c.firstName, ...(c.photoUrl ? { photo: c.photoUrl } : {}), kind: o.type === 'ride' ? 'driver' : 'courier' };
}

/**
 * The next cars to Baghdad and Kut (up to two), with «باچر» when the first bookable one is tomorrow,
 * so a morning time is never read as today.
 */
export function boardDepartures(cards: readonly DepartureCard[], now: Date, t: TFn): Departure[] {
  const open = cards.filter((d) => boardSummary([d], now).count > 0);
  const sorted = [...open].sort((a, b) => a.departAt.getTime() - b.departAt.getTime());
  return sorted.slice(0, 2).map((d) => ({
    id: d.id,
    city: t(d.toCityId === 'kut' ? 'rajaa.city_kut' : d.toCityId === 'baghdad' ? 'rajaa.city_baghdad' : 'rajaa.city_aziziyah'),
    time: formatClock(d.departAt, { period: false }),
    part: t(`time.part_${dayPart(d.departAt)}` as MessageKey),
    tomorrow: cityDayDiff(d.departAt, now) === 1,
    seats: d.fill.seatsTotal,
    free: d.fill.free,
  }));
}

/** A kitchen's minutes to the door: the longest of its estimate, else its longest prep. */
export function kitchenMinutes(r: Pick<RestaurantSummary, 'etaMaxMinutes' | 'prepMaxMinutes'>): number {
  return r.etaMaxMinutes ?? r.prepMaxMinutes;
}

/** A catalog dish as a home card dish, with its kitchen's minutes; dishes from closed or unknown kitchens drop out. */
export function homeDishes(
  picks: readonly { id: string; name: string; priceIqd: number; photoUrl: string | null; restaurantId: string; restaurantName: string; restaurantOpen: boolean; available: boolean }[],
  kitchens: readonly RestaurantSummary[],
): HomeDish[] {
  const byId = new Map(kitchens.map((k) => [k.id, k]));
  return picks.flatMap((p) => {
    const k = byId.get(p.restaurantId);
    if (!k || !k.open || !p.restaurantOpen || !p.available) return [];
    return [{ id: p.id, name: p.name, restaurant: p.restaurantName, minutes: kitchenMinutes(k), price: p.priceIqd, ...(p.photoUrl ? { picture: { uri: p.photoUrl } } : {}) }];
  });
}

/** The fastest of the hour's dishes (the calm panel's one dish). */
export function fastestDish(dishes: readonly HomeDish[]): HomeDish | null {
  return dishes.reduce<HomeDish | null>((best, d) => (!best || d.minutes < best.minutes ? d : best), null);
}

/** The regular's usual order as the calm panel shows it, with its kitchen's minutes today when it is open. */
export function usualOrder(u: Usual, kitchens: readonly RestaurantSummary[], friday: boolean): UsualOrder | null {
  const row = u.row;
  if (!row.merchantName || row.items.length === 0) return null;
  const k = kitchens.find((x) => x.id === row.order.merchantOrgId);
  if (k && !k.open) return null;
  return {
    id: row.order.id,
    restaurant: row.merchantName,
    items: itemsSummary(row.items, 3),
    price: row.order.totalIqd,
    friday,
    ...(k ? { minutes: kitchenMinutes(k) } : {}),
  };
}

/** «مفتوح هسة» chips: the kinds of open kitchens, most common first, at most `max`, only kinds with 2+ kitchens. */
export function kitchenChips(kitchens: readonly RestaurantSummary[], max = 6): HomeChip[] {
  const counts = new Map<string, number>();
  for (const k of kitchens) if (k.open && k.cuisine) counts.set(k.cuisine, (counts.get(k.cuisine) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([label]) => ({ id: label, label }));
}
