import { describe, expect, it } from 'vitest';
import type { LedgerEvent, Order } from '@driver/contracts';
import { checkInvariants, type SimSnapshot } from './invariants.js';

const AT = new Date('2026-10-06T10:00:00Z');

function order(over: Partial<Order> & { id: string }): Order {
  return { type: 'food', state: 'closed', ordererId: 'c1', deliveryFeeIqd: 1000, discount: null, ...over } as Order;
}

function lateCredit(orderId: string, amount: number, over: Partial<LedgerEvent> = {}): LedgerEvent {
  return {
    id: `le_${orderId}_${amount}`,
    kind: 'money',
    type: 'credit_issued',
    amount,
    currency: 'IQD',
    fromAccount: 'platform',
    toAccount: 'customer:c1',
    orderId,
    postingGroupId: `late_promise:${orderId}`,
    occurredAt: AT,
    recordedAt: AT,
    memo: 'late_promise',
    ...over,
  };
}

function snapshot(orders: Order[], ledger: LedgerEvent[]): SimSnapshot {
  return { orders, trips: [], ledger, quarantined: [], outbox: { pending: 0, published: 0, failed: 0 }, offers: [], replays: [], hotWaits: [], handovers: [], merchants: [], errors: [] };
}

const lateCheck = (s: SimSnapshot) => checkInvariants(s).find((r) => r.name === 'late_credit_once_per_delivery')!;

describe('late_credit_once_per_delivery (honest-delay promise, Ali 2026-10-06)', () => {
  it('passes the fee back on a paid delivery and the fixed 1,000 on a free one', () => {
    const paid = order({ id: 'o1', deliveryFeeIqd: 1500 });
    const free = order({ id: 'o2', deliveryFeeIqd: 1000, discount: { target: 'delivery', amountIqd: 1000 } as Order['discount'] });
    const r = lateCheck(snapshot([paid, free], [lateCredit('o1', 1500), lateCredit('o2', 1000)]));
    expect(r).toMatchObject({ checked: 2, violations: 0 });
  });

  it('flags a second credit, a wrong amount, a wrong payer and a ride', () => {
    const r = lateCheck(
      snapshot(
        [order({ id: 'o1' }), order({ id: 'o2', deliveryFeeIqd: 0 }), order({ id: 'o3' }), order({ id: 'o4', type: 'ride' })],
        [
          lateCredit('o1', 1000),
          lateCredit('o1', 1000, { id: 'dup' }),
          lateCredit('o2', 500),
          lateCredit('o3', 1000, { fromAccount: 'merchant_cash:rest_1' }),
          lateCredit('o4', 1000),
        ],
      ),
    );
    expect(r.violations).toBe(4);
    expect(r.examples.join('\n')).toMatch(/o1: 2 late-credit lines/);
    expect(r.examples.join('\n')).toMatch(/o2: late credit 500 ≠ 1000/);
    expect(r.examples.join('\n')).toMatch(/o3: late credit credit_issued merchant_cash:rest_1/);
    expect(r.examples.join('\n')).toMatch(/o4 \(ride\): late credit on a non-delivery/);
  });
});

describe('scheduled_ride_dispatched_once (review #28)', () => {
  const booked = order({ id: 'r1', type: 'ride', scheduledFor: new Date('2026-10-06T11:00:00Z') });
  const trip = { id: 't1', state: 'completed', stops: [], orders: [{ orderId: 'r1' }] } as unknown as SimSnapshot['trips'][number];
  const m = (type: string, driverId: string | null = null) => ({ tripId: 't1', type, driverId, at: 0 });
  const check = (dispatchLog: NonNullable<SimSnapshot['dispatchLog']>) => checkInvariants({ ...snapshot([booked], []), trips: [trip], dispatchLog }).find((r) => r.name === 'scheduled_ride_dispatched_once')!;

  it('passes one request, one assignment, and a second driver only after the first dropped it', () => {
    expect(check([m('dispatch.requested'), m('dispatch.booked_confirmed', 'd1'), m('dispatch.booked_released', 'd1'), m('dispatch.booked_confirmed', 'd2'), m('dispatch.assigned', 'd2')])).toMatchObject({ checked: 1, violations: 0 });
  });

  it('flags a second dispatch, a second assignment and two confirmed drivers', () => {
    expect(check([m('dispatch.requested'), m('dispatch.requested')]).violations).toBe(1);
    expect(check([m('dispatch.assigned', 'd1'), m('dispatch.assigned', 'd2')]).violations).toBe(1);
    expect(check([m('dispatch.booked_confirmed', 'd1'), m('dispatch.booked_confirmed', 'd2')]).examples[0]).toMatch(/two confirmed drivers/);
  });
});

describe('booked_ride_waits_for_its_search (step 4, c10)', () => {
  const booked = order({ id: 'r1', type: 'ride', scheduledFor: new Date('2026-10-06T11:00:00Z') });
  const trip = { id: 't1', state: 'completed', stops: [], orders: [{ orderId: 'r1' }] } as unknown as SimSnapshot['trips'][number];
  const offer = (at: string) => ({ tripId: 't1', driverId: 'd1', at: Date.parse(at), kind: 'broadcast', overCap: false, owedIqd: 0, capIqd: 0 });
  const check = (offers: SimSnapshot['offers']) => checkInvariants({ ...snapshot([booked, order({ id: 'o1' })], []), trips: [trip], offers }).find((r) => r.name === 'booked_ride_waits_for_its_search')!;

  it('passes offers from 30 minutes before the booked time (review #28)', () => {
    expect(check([offer('2026-10-06T10:30:00Z'), offer('2026-10-06T10:50:00Z')])).toMatchObject({ checked: 1, violations: 0 });
  });

  it('flags an offer before the search starts', () => {
    const r = check([offer('2026-10-06T10:20:00Z')]);
    expect(r.violations).toBe(1);
    expect(r.examples[0]).toMatch(/r1: 1 offer\(s\) from 2026-10-06T10:20:00.000Z, search starts 2026-10-06T10:30:00.000Z/);
  });
});
