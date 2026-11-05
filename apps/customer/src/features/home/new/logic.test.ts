import { describe, expect, it } from 'vitest';
import { t as translate, type MessageKey } from '@driver/i18n';
import type { DepartureCard, OrderTracking, Usual } from '@driver/contracts';
import type { RestaurantSummary } from '../restaurant-summary';
import { ENDED_SHOW_MS, orderHeadlineKey, orderTitleKey, recentlyEnded, boardDepartures, cashToHand, fastestDish, homeDishes, kitchenChips, lateNotice, minutesTo, orderStage, personOf, usualOrder } from './logic';

const t = (key: MessageKey, params?: Record<string, string | number>) => translate(key, params);
const clean = (s: string) => s.replace(/[‎‏⁦-⁩]/g, '');
// 12:00 in Aziziyah (UTC+3) on Wednesday 4 Nov 2026.
const NOW = new Date(Date.UTC(2026, 10, 4, 9, 0));

const kitchen = (id: string, extra: Partial<RestaurantSummary> = {}): RestaurantSummary =>
  ({ id, name: `مطعم ${id}`, cityId: 'aziziyah', pickup: null, cuisine: 'مشاوي', photoUrl: null, zoneId: null, rating: 4.5, ratingCount: 10, prepMinMinutes: 10, prepMaxMinutes: 20, etaMinMinutes: 20, etaMaxMinutes: 30, deliveryFeeIqd: 1500, minOrderIqd: 0, open: true, favourite: false, ...extra }) as RestaurantSummary;

describe('new home: order panel data', () => {
  it('reads the four steps from the order state, and every way an order can end as cancelled', () => {
    expect(orderStage({ state: 'placed' })).toBe('placed');
    expect(orderStage({ state: 'merchant_accepted' })).toBe('placed');
    expect(orderStage({ state: 'ready' })).toBe('preparing');
    expect(orderStage({ state: 'picked_up' })).toBe('on_way');
    expect(orderStage({ state: 'delivered' })).toBe('arrived');
    expect(orderStage({ type: 'ride', state: 'matched' })).toBe('preparing');
    expect(orderStage({ type: 'food', state: 'matched' })).toBe('on_way');
    for (const state of ['customer_cancelled', 'platform_cancelled', 'merchant_rejected', 'failed'] as const) expect(orderStage({ state })).toBe('cancelled');
  });
  it('the panel and the headline say what happened: arrived, cancelled, a ride', () => {
    expect(orderTitleKey({ type: 'food', state: 'picked_up' })).toBe('home.stage.on_the_way');
    expect(orderTitleKey({ type: 'food', state: 'delivered' })).toBe('order.status.delivered');
    expect(orderTitleKey({ type: 'ride', state: 'completed' })).toBe('home.stage.ride_done');
    expect(orderTitleKey({ type: 'food', state: 'customer_cancelled' })).toBe('home.panel.cancelled_title');
    expect(orderHeadlineKey({ type: 'food', state: 'preparing' })).toBe('home.order_headline');
    expect(orderHeadlineKey({ type: 'food', state: 'delivered' })).toBe('home.bye');
    expect(orderHeadlineKey({ type: 'ride', state: 'placed' })).toBe('home.ride_headline');
    expect(orderHeadlineKey({ type: 'food', state: 'merchant_rejected' })).toBeNull();
  });
  it('an order that just arrived or was cancelled stays on the card for ten minutes, the newest first', () => {
    const at = (min: number) => new Date(NOW.getTime() - min * 60_000);
    const a = { id: 'a', state: 'delivered', deliveredAt: at(3), cancelledAt: null } as const;
    const c = { id: 'c', state: 'customer_cancelled', deliveredAt: null, cancelledAt: at(1) } as const;
    const old = { id: 'o', state: 'delivered', deliveredAt: at(11), cancelledAt: null } as const;
    expect(recentlyEnded([a, c, old], NOW.getTime())?.id).toBe('c');
    expect(recentlyEnded([a, old], NOW.getTime())?.id).toBe('a');
    expect(recentlyEnded([old], NOW.getTime())).toBeNull();
    expect(recentlyEnded([a], NOW.getTime() + ENDED_SHOW_MS)).toBeNull();
  });
  it('minutes to the door are whole and never below 0; no time, no minutes', () => {
    expect(minutesTo(new Date(NOW.getTime() + 12.4 * 60_000), NOW.getTime())).toBe(12);
    expect(minutesTo(new Date(NOW.getTime() - 60_000), NOW.getTime())).toBe(0);
    expect(minutesTo(null, NOW.getTime())).toBeNull();
  });
  it('the late band only once the apology went out, with the new time and the order own rule', () => {
    const promise = { afterMin: 20, creditIqd: 1500, basis: 'delivery_fee', deadlineAt: NOW, credit: null, apologyAfterMin: 10, apology: null } as const;
    expect(lateNotice({ latePromise: promise } as Pick<OrderTracking, 'latePromise'>, t)).toBeUndefined();
    const late = lateNotice({ latePromise: { ...promise, apology: { at: NOW, etaAt: new Date(Date.UTC(2026, 10, 4, 10, 40)) } } } as Pick<OrderTracking, 'latePromise'>, t);
    expect(late?.tone).toBe('late');
    expect(clean(late?.time ?? '')).toBe('1:40 الظهر');
    expect(late?.text).toContain('20');
  });
  it('cash only for cash orders; the courier only once a name is on file', () => {
    expect(cashToHand({ paymentMethod: 'cash', totalIqd: 19250 })).toBe(19250);
    expect(cashToHand({ paymentMethod: 'wallet', totalIqd: 19250 })).toBeUndefined();
    expect(personOf({ courier: null }, { type: 'food' })).toBeUndefined();
    expect(personOf({ courier: { firstName: 'حيدر', photoUrl: null } } as unknown as Pick<OrderTracking, 'courier'>, { type: 'ride' })).toEqual({ name: 'حيدر', kind: 'driver' });
  });
});

describe('new home: board, dishes and kitchens', () => {
  const dep = (id: string, at: Date, free: number, to = 'baghdad'): DepartureCard =>
    ({ id, toCityId: to, departAt: at, latestDepartureAt: at, state: 'scheduled', fill: { free, seatsTotal: 7 } }) as unknown as DepartureCard;
  it('the next two cars with seats, and «باچر» on a car tomorrow morning', () => {
    const today = new Date(Date.UTC(2026, 10, 4, 13, 30));
    const tomorrow = new Date(Date.UTC(2026, 10, 5, 4, 0));
    const full = new Date(Date.UTC(2026, 10, 4, 12, 0));
    const out = boardDepartures([dep('t', tomorrow, 5, 'kut'), dep('f', full, 0), dep('a', today, 3)], NOW, t);
    expect(out.map((d) => d.id)).toEqual(['a', 't']);
    expect(out[0]).toMatchObject({ time: '4:30', part: 'العصر', tomorrow: false, free: 3 });
    expect(out[1]).toMatchObject({ time: '7:00', part: 'الصبح', tomorrow: true });
  });
  it('dishes come only from open kitchens, with their kitchen minutes; the fastest is picked for the panel', () => {
    const picks = [
      { id: 'd1', name: 'برياني', priceIqd: 10000, photoUrl: 'p.webp', restaurantId: 'a', restaurantName: 'مطعم a', restaurantOpen: true, available: true },
      { id: 'd2', name: 'بامية', priceIqd: 4000, photoUrl: null, restaurantId: 'b', restaurantName: 'مطعم b', restaurantOpen: true, available: true },
      { id: 'd3', name: 'كبة', priceIqd: 2000, photoUrl: null, restaurantId: 'c', restaurantName: 'مطعم c', restaurantOpen: false, available: true },
    ];
    const dishes = homeDishes(picks, [kitchen('a', { etaMaxMinutes: 35 }), kitchen('b', { etaMaxMinutes: null, prepMaxMinutes: 15 }), kitchen('c', { open: false })]);
    expect(dishes.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(dishes[0]).toMatchObject({ minutes: 35, picture: { uri: 'p.webp' } });
    expect(fastestDish(dishes)?.id).toBe('d2');
    expect(fastestDish([])).toBeNull();
  });
  it('the usual order shows when its kitchen is open, with today minutes', () => {
    const u = { row: { order: { id: 'o1', merchantOrgId: 'a', totalIqd: 4500 }, merchantName: 'مطعم الحجي', items: [{ name: 'تمن', qty: 1 }, { name: 'قيمة', qty: 1 }] } } as unknown as Usual;
    expect(usualOrder(u, [kitchen('a', { etaMaxMinutes: 25 })], false)).toMatchObject({ id: 'o1', restaurant: 'مطعم الحجي', price: 4500, minutes: 25, friday: false });
    expect(usualOrder(u, [kitchen('a', { open: false })], false)).toBeNull();
  });
  it('chips are kinds with two or more open kitchens, most common first', () => {
    const chips = kitchenChips([kitchen('a'), kitchen('b'), kitchen('c', { cuisine: 'فلافل' }), kitchen('d', { cuisine: 'فلافل' }), kitchen('e', { cuisine: 'فلافل' }), kitchen('f', { cuisine: 'حلويات' })]);
    expect(chips.map((c) => c.label)).toEqual(['فلافل', 'مشاوي']);
  });
});
