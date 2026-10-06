import { describe, expect, it } from 'vitest';
import { DriverError, LATE_PROMISE_MEMO, type LedgerEvent } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { savedBetween } from '../ledger/index.js';
import { InsightsService, type InsightsSources } from './insights.service.js';
import { MonthCardJob } from './month-card.job.js';
import { monthCounts, pointsEarnedBetween, type MonthOrder } from './month.js';

const day = (iso: string) => new Date(iso);
const meal = (id: string, merchantOrgId: string, at: string, lines: Array<[string, number]>, patch: Partial<MonthOrder> = {}): MonthOrder => ({
  id,
  type: 'food',
  state: 'closed',
  merchantOrgId,
  placedAt: day(at),
  deliveredAt: day(at),
  lines: lines.map(([catalogItemId, qty]) => ({ catalogItemId, qty, removed: false })),
  ...patch,
});

let seq = 0;
const ev = (e: Partial<LedgerEvent> & Pick<LedgerEvent, 'type' | 'amount'>): LedgerEvent =>
  ({ id: `ev_${++seq}`, kind: 'money', fromAccount: 'platform', toAccount: 'customer:me', occurredAt: day('2026-09-10T10:00:00Z'), memo: null, postingGroupId: null, orderId: null, tripId: null, ...e }) as LedgerEvent;

describe('monthCounts (joy w6)', () => {
  it('meals delivered, kitchens tried, the top kitchen and the dish on the most orders', () => {
    const c = monthCounts([
      meal('o1', 'khalid', '2026-09-02T10:00:00Z', [['tikka', 2], ['salad', 1]]),
      meal('o2', 'khalid', '2026-09-09T10:00:00Z', [['tikka', 1]]),
      meal('o3', 'sham', '2026-09-12T10:00:00Z', [['shawarma', 4], ['shawarma', 1]]),
      meal('o4', 'sham', '2026-09-20T10:00:00Z', [['falafel', 1]]),
      meal('o5', 'haj', '2026-09-21T10:00:00Z', [['tikka', 9]], { deliveredAt: null, state: 'customer_cancelled' }),
      meal('o6', 'khalid', '2026-09-22T10:00:00Z', [], { lines: [{ catalogItemId: 'salad', qty: 9, removed: true }] }),
      { ...meal('r1', 'x', '2026-09-05T10:00:00Z', []), type: 'ride', merchantOrgId: null, state: 'completed', deliveredAt: null },
      { ...meal('r2', 'x', '2026-09-06T10:00:00Z', []), type: 'ride', merchantOrgId: null, state: 'customer_cancelled', deliveredAt: null },
    ]);
    expect(c).toEqual({
      meals: 5,
      kitchens: 2,
      topKitchen: { merchantOrgId: 'khalid', orders: 3 },
      // تكة is on two orders (3 portions); شاورما on one even with 5 portions; a removed line never counts.
      topDish: { merchantOrgId: 'khalid', catalogItemId: 'tikka', orders: 2 },
      rides: 1,
    });
  });

  it('ties go to the latest kitchen; an empty month is all zero', () => {
    expect(monthCounts([meal('a', 'k1', '2026-09-01T10:00:00Z', [['x', 1]]), meal('b', 'k2', '2026-09-03T10:00:00Z', [['y', 1]])]).topKitchen).toEqual({ merchantOrgId: 'k2', orders: 1 });
    expect(monthCounts([])).toEqual({ meals: 0, kitchens: 0, topKitchen: null, topDish: null, rides: 0 });
  });

  it('points earned count earned and organiser bonus in the month only', () => {
    const points = [
      ev({ kind: 'points', type: 'points_earned', amount: 120, toAccount: 'points:me', fromAccount: 'points_pool' }),
      ev({ kind: 'points', type: 'organizer_bonus', amount: 12, toAccount: 'points:me', fromAccount: 'points_pool' }),
      ev({ kind: 'points', type: 'points_redeemed', amount: 300, toAccount: 'points_pool', fromAccount: 'points:me' }),
      ev({ kind: 'points', type: 'points_earned', amount: 50, toAccount: 'points:me', fromAccount: 'points_pool', occurredAt: day('2026-10-01T10:00:00Z') }),
    ];
    expect(pointsEarnedBetween('points:me', points, day('2026-08-31T21:00:00Z'), day('2026-09-30T21:00:00Z'))).toBe(132);
  });
});

describe('savedBetween (w10 and w6 share it)', () => {
  it('points used, the delay credit and change kept, inside the range only; a top-up is not a saving', () => {
    const events = [
      ev({ type: 'promo_funded', amount: 1_000 }),
      ev({ type: 'credit_issued', amount: 1_500, memo: LATE_PROMISE_MEMO }),
      ev({ type: 'credit_issued', amount: 25_000, memo: 'topup:agent' }),
      ev({ type: 'cash_change_to_wallet', amount: 750 }),
      ev({ type: 'promo_funded', amount: 2_000, occurredAt: day('2026-10-02T10:00:00Z') }),
    ];
    expect(savedBetween('customer:me', events, day('2026-08-31T21:00:00Z'), day('2026-09-30T21:00:00Z'))).toBe(3_250);
  });
});

function sources(over: Partial<InsightsSources> = {}): InsightsSources & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    ordersPlacedBy: async (personId, from) => {
      asked.push(`${personId}:${from.toISOString()}`);
      return [meal('o1', 'khalid', '2026-09-02T10:00:00Z', [['tikka', 2]]), meal('o2', 'khalid', '2026-09-09T10:00:00Z', [['tikka', 1]])];
    },
    merchantName: async (id) => (id === 'khalid' ? 'مطعم خالد' : null),
    itemNames: async () => new Map([['tikka', 'تكة']]),
    seatsTravelled: async () => 2,
    eventsFor: async (account) =>
      account.startsWith('points:')
        ? [ev({ kind: 'points', type: 'points_earned', amount: 85, toAccount: account, fromAccount: 'points_pool' })]
        : [ev({ type: 'promo_funded', amount: 1_000, toAccount: account })],
    saved: (personId, events, from, to) => savedBetween(`customer:${personId}`, events, from, to),
    customerAccount: (p) => `customer:${p}`,
    pointsAccount: (p) => `points:${p}`,
    ...over,
  };
}

describe('wallet.month (InsightsService)', () => {
  const clock = new FakeClock('2026-10-07T09:00:00Z');
  const actor = { personId: 'me', sessionId: 's' };

  it('names the top kitchen and dish, counts الرجعة, saved and points; reads only the caller', async () => {
    const src = sources();
    const v = await new InsightsService(src, clock).month(actor, { month: '2026-09' });
    expect(v).toEqual({
      month: '2026-09',
      earliestMonth: '2025-10',
      meals: 2,
      kitchens: 1,
      topKitchen: { name: 'مطعم خالد', orders: 2 },
      topDish: { name: 'تكة', kitchen: 'مطعم خالد', orders: 2 },
      rides: 0,
      rajaaTrips: 2,
      savedIqd: 1_000,
      pointsEarned: 85,
      hasActivity: true,
    });
    expect(src.asked).toEqual(['me:2026-08-31T21:00:00.000Z']);
  });

  it('defaults to this month; refuses the future and more than 12 months back', async () => {
    const svc = new InsightsService(sources({ ordersPlacedBy: async () => [], seatsTravelled: async () => 0, eventsFor: async () => [] }), clock);
    const now = await svc.month(actor, {});
    expect(now).toMatchObject({ month: '2026-10', hasActivity: false, topKitchen: null, topDish: null, savedIqd: 0 });
    await expect(svc.month(actor, { month: '2026-11' })).rejects.toBeInstanceOf(DriverError);
    await expect(svc.month(actor, { month: '2025-09' })).rejects.toBeInstanceOf(DriverError);
    expect((await svc.month(actor, { month: '2025-10' })).month).toBe('2025-10');
  });
});

describe('MonthCardJob (the once-a-month card)', () => {
  function job(at: string, people: string[]) {
    const emitted: Array<{ key: string | undefined; person: string }> = [];
    const clock = new FakeClock(at);
    const j = new MonthCardJob(
      {
        activePeople: async () => people,
        emit: async (e, a) => {
          emitted.push({ key: e.idempotencyKey, person: a.id });
        },
      },
      clock,
    );
    return { j, emitted, clock };
  }

  it('only on the 1st from 10:00 Baghdad, one keyed event per person for last month', async () => {
    const early = job('2026-11-01T06:59:00Z', ['a']); // 09:59 Baghdad
    expect(await early.j.tick()).toBe(0);
    const second = job('2026-11-02T09:00:00Z', ['a']);
    expect(await second.j.tick()).toBe(0);
    const due = job('2026-11-01T07:00:00Z', ['b', 'a', 'b']);
    expect(await due.j.tick()).toBe(2);
    expect(due.emitted).toEqual([
      { key: 'insights.month_ready:a:2026-10', person: 'a' },
      { key: 'insights.month_ready:b:2026-10', person: 'b' },
    ]);
  });
});
