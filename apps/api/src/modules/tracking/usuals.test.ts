import { describe, expect, it } from 'vitest';
import type { Order } from '@driver/contracts';
import { findUsuals, sameOrder } from './usuals.js';

/** Thursday 2026-10-08 12:00 Baghdad. Fridays before it: 2, 9 (future), 25 Sep, 18 Sep… */
const NOW = new Date('2026-10-08T09:00:00Z');
const DAY = 86_400_000;

let seq = 0;
/** A delivered food order at a Baghdad wall-clock time ("2026-10-02 13:30"). */
function order(at: string, dishes: string[], over: Partial<Order> = {}): Order {
  seq += 1;
  const placedAt = new Date(`${at.replace(' ', 'T')}:00+03:00`);
  return {
    id: `o${seq}`,
    type: 'food',
    state: 'closed',
    ordererId: 'me',
    merchantOrgId: 'kareem',
    placedAt,
    scheduledFor: null,
    deliveredAt: new Date(placedAt.getTime() + 40 * 60_000),
    lines: dishes.map((d, i) => ({ id: `${seq}_${i}`, catalogItemId: d, availability: 'available' })),
    ...over,
  } as unknown as Order;
}

describe('sameOrder', () => {
  const k = (dishes: string[], merchantOrgId = 'kareem') => ({ merchantOrgId, dishes: new Set(dishes) });
  it('needs the same kitchen and 70 % of the dishes over the larger order', () => {
    expect(sameOrder(k(['bamia', 'laban', 'salad']), k(['bamia', 'laban', 'salad']))).toBe(true);
    expect(sameOrder(k(['bamia', 'laban', 'salad']), k(['bamia', 'laban']))).toBe(false); // 2 of 3
    expect(sameOrder(k(['a', 'b', 'c', 'd']), k(['a', 'b', 'c', 'e']))).toBe(true); // 3 of 4
    expect(sameOrder(k(['bamia']), k(['bamia'], 'khalid'))).toBe(false);
  });
});

describe('findUsuals', () => {
  it('two Fridays at lunch with the same order make a weekday usual; the newest is the one offered', () => {
    const a = order('2026-09-25 13:10', ['bamia', 'laban']);
    const b = order('2026-10-02 13:40', ['bamia', 'laban']);
    expect(findUsuals([a, b], 'me', NOW)).toEqual([{ kind: 'weekday', weekday: 5, band: 'lunch', times: 2, atMinute: 13 * 60 + 30, orderId: b.id }]);
  });

  it('one Friday is not a habit', () => {
    expect(findUsuals([order('2026-10-02 13:40', ['bamia'])], 'me', NOW)).toEqual([]);
  });

  it('three dinners on different days make a band usual; two do not', () => {
    const days = ['2026-10-04 20:00', '2026-10-06 20:30', '2026-10-07 21:00'];
    expect(findUsuals(days.slice(0, 2).map((d) => order(d, ['tikka'], { merchantOrgId: 'khalid' })), 'me', NOW)).toEqual([]);
    const all = days.map((d) => order(d, ['tikka'], { merchantOrgId: 'khalid' }));
    expect(findUsuals(all, 'me', NOW)).toEqual([{ kind: 'band', weekday: null, band: 'evening', times: 3, atMinute: 20 * 60 + 30, orderId: all[2]!.id }]);
  });

  it('the scheduled time decides the band and the day (a Thursday-night booking for Friday lunch)', () => {
    const a = order('2026-09-24 21:00', ['bamia'], { scheduledFor: new Date('2026-09-25T13:30:00+03:00') });
    const b = order('2026-10-01 21:00', ['bamia'], { scheduledFor: new Date('2026-10-02T13:30:00+03:00') });
    expect(findUsuals([a, b], 'me', NOW)).toMatchObject([{ kind: 'weekday', weekday: 5, band: 'lunch', atMinute: 13 * 60 + 30 }]);
  });

  it('late-night usuals average across midnight', () => {
    // Two Thursdays, 23:30 and 00:30: the usual time is midnight, not noon.
    const a = order('2026-10-01 23:30', ['shawarma'], { merchantOrgId: 'sham' });
    const b = order('2026-10-08 00:30', ['shawarma'], { merchantOrgId: 'sham' });
    expect(findUsuals([a, b], 'me', NOW)).toMatchObject([{ kind: 'weekday', weekday: 4, band: 'late', atMinute: 0 }]);
  });

  it('ignores old, refused, refunded, undelivered and other people’s orders, and orders that are not food', () => {
    const old = order('2026-08-21 13:30', ['bamia']);
    const refused = order('2026-09-18 13:30', ['bamia'], { state: 'merchant_rejected', deliveredAt: null });
    const refunded = order('2026-09-11 13:30', ['bamia'], { state: 'refunded' });
    const theirs = order('2026-09-25 13:30', ['bamia'], { ordererId: 'brother' });
    const ride = order('2026-09-25 13:30', ['bamia'], { type: 'ride' });
    const mine = order('2026-10-02 13:30', ['bamia']);
    expect(findUsuals([old, refused, refunded, theirs, ride, mine], 'me', new Date(NOW.getTime() + DAY))).toEqual([]);
  });

  it('a different kitchen or a different order never counts toward the same usual', () => {
    const a = order('2026-09-25 13:30', ['bamia', 'laban', 'salad']);
    const b = order('2026-10-02 13:30', ['bamia']);
    const c = order('2026-10-02 13:30', ['bamia', 'laban', 'salad'], { merchantOrgId: 'khalid' });
    expect(findUsuals([a, b, c], 'me', NOW)).toEqual([]);
  });

  it('at most three, weekday usuals first, then the most frequent', () => {
    const fri = [order('2026-09-25 13:30', ['bamia']), order('2026-10-02 13:30', ['bamia'])];
    const tue = [order('2026-09-29 08:00', ['kahi'], { merchantOrgId: 'musafir' }), order('2026-10-06 08:00', ['kahi'], { merchantOrgId: 'musafir' })];
    const dinners = ['2026-10-03 20:00', '2026-10-04 20:00', '2026-10-05 20:00', '2026-10-07 20:00'].map((d) => order(d, ['tikka'], { merchantOrgId: 'khalid' }));
    const lunches = ['2026-10-03 12:00', '2026-10-04 12:00', '2026-10-05 12:00'].map((d) => order(d, ['falafel'], { merchantOrgId: 'sham' }));
    const found = findUsuals([...fri, ...tue, ...dinners, ...lunches], 'me', NOW);
    expect(found.map((u) => [u.kind, u.orderId])).toEqual([
      ['weekday', tue[1]!.id],
      ['weekday', fri[1]!.id],
      ['band', dinners[3]!.id],
    ]);
  });
});
