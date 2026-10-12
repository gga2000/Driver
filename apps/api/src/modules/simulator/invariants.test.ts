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

describe('merchant_cash_held_within_courier_cash', () => {
  const line = (type: LedgerEvent['type'], amount: number, fromAccount: string, toAccount: string): LedgerEvent => ({ id: `le_${type}_${amount}_${fromAccount}`, kind: 'money', type, amount, currency: 'IQD', fromAccount, toAccount, occurredAt: AT, recordedAt: AT });
  const check = (s: SimSnapshot) => checkInvariants(s).find((r) => r.name === 'merchant_cash_held_within_courier_cash')!;

  it('passes while the restaurants show no more with a courier than he holds, fails once they do', () => {
    // He collected 16,500 and handed 15,500 in to the company: he holds 1,000.
    const ledger = [line('cash_collected', 16_500, 'cash:k1', 'customer:c1'), line('driver_settlement', 15_500, 'bank', 'cash:k1')];
    const ok = { ...snapshot([], ledger), merchants: [{ merchantId: 'm1', balanceIqd: 12_750, holders: [{ courierId: 'k1', amountIqd: 1_000 }] }] };
    expect(check(ok)).toMatchObject({ checked: 1, violations: 0 });
    const stale = { ...snapshot([], ledger), merchants: [{ merchantId: 'm1', balanceIqd: 12_750, holders: [{ courierId: 'k1', amountIqd: 12_750 }] }] };
    expect(check(stale)).toMatchObject({ violations: 1 });
  });

  it('fails when one hand-in is taken off every restaurant he carried for (cash shown with the company that is still in his hand)', () => {
    const g = (id: string, type: LedgerEvent['type'], amount: number, fromAccount: string, toAccount: string, postingGroupId?: string): LedgerEvent => ({ id, kind: 'money', type, amount, currency: 'IQD', fromAccount, toAccount, occurredAt: AT, recordedAt: AT, ...(postingGroupId ? { postingGroupId } : {}) });
    // Two cash orders, one for m1 and one for m2 (12,750 net each), then 12,750 handed in to the company.
    const ledger = [
      g('a1', 'cash_collected', 16_500, 'cash:k1', 'customer:c1', 'order:o1:money'),
      g('a2', 'merchant_payable', 12_750, 'platform', 'merchant_cash:m1', 'order:o1:money'),
      g('b1', 'cash_collected', 16_500, 'cash:k1', 'customer:c2', 'order:o2:money'),
      g('b2', 'merchant_payable', 12_750, 'platform', 'merchant_cash:m2', 'order:o2:money'),
      g('h1', 'driver_settlement', 12_750, 'bank', 'cash:k1'),
    ];
    const merchants = (m1: number, m2: number) => [
      { merchantId: 'm1', balanceIqd: 12_750, holders: m1 ? [{ courierId: 'k1', amountIqd: m1 }] : [] },
      { merchantId: 'm2', balanceIqd: 12_750, holders: m2 ? [{ courierId: 'k1', amountIqd: m2 }] : [] },
    ];
    expect(check({ ...snapshot([], ledger), merchants: merchants(5_500, 12_750) })).toMatchObject({ violations: 0 });
    // The hand-in counted against both restaurants: neither shows him holding anything.
    expect(check({ ...snapshot([], ledger), merchants: merchants(0, 0) })).toMatchObject({ violations: 1 });
  });
});

describe('courier_delivery_line_matches_offer (money §2 batch rate)', () => {
  const trip = (id: string) => ({ id, vertical: 'food', state: 'completed', courierId: 'd1', stops: [], orders: [{ orderId: `o_${id}`, detachedAt: null }] }) as unknown as SimSnapshot['trips'][number];
  const line = (tripId: string, amount: number): LedgerEvent => ({ id: `dl_${tripId}`, kind: 'money', type: 'delivery_fee', amount, currency: 'IQD', fromAccount: 'customer:c1', toAccount: 'driver:d1', tripId, orderId: `o_${tripId}`, occurredAt: AT, recordedAt: AT });
  const check = (ledger: LedgerEvent[], batched: boolean[]) =>
    checkInvariants({
      ...snapshot([order({ id: 'o_t1', deliveryFeeIqd: 2000 }), order({ id: 'o_t2', deliveryFeeIqd: 2000 })], ledger),
      trips: [trip('t1'), trip('t2')],
      acceptedOffers: batched.map((b, i) => ({ tripId: `t${i + 1}`, driverId: 'd1', batched: b })),
    }).find((r) => r.name === 'courier_delivery_line_matches_offer')!;

  it('passes the whole fee on a first job and 70 % on a batched second', () => {
    expect(check([line('t1', 2000), line('t2', 1400)], [false, true])).toMatchObject({ checked: 2, violations: 0 });
  });

  it('flags a batched second paid the whole fee', () => {
    const r = check([line('t1', 2000), line('t2', 2000)], [false, true]);
    expect(r.violations).toBe(1);
    expect(r.examples[0]).toMatch(/o_t2: courier d1 paid 2000 delivery, his offer showed 1400/);
  });

  it('errands too (Ali 2026-10-12): the errand fee line matches the offer, 70 % on a batched second, the receipt aside', () => {
    const errandLine = (tripId: string, amount: number, type: LedgerEvent['type'] = 'errand_fee'): LedgerEvent => ({ ...line(tripId, amount), id: `${type}_${tripId}`, type });
    const run = (ledger: LedgerEvent[]) =>
      checkInvariants({
        ...snapshot([order({ id: 'o_t1', type: 'errand', deliveryFeeIqd: 2000 } as Partial<Order> & { id: string }), order({ id: 'o_t2', type: 'errand', deliveryFeeIqd: 2000 } as Partial<Order> & { id: string })], ledger),
        trips: [trip('t1'), trip('t2')],
        acceptedOffers: [
          { tripId: 't1', driverId: 'd1', batched: false },
          { tripId: 't2', driverId: 'd1', batched: true },
        ],
      }).find((r) => r.name === 'courier_delivery_line_matches_offer')!;
    expect(run([errandLine('t1', 2000), errandLine('t2', 1400), errandLine('t2', 7000, 'errand_cost_actual')])).toMatchObject({ checked: 2, violations: 0 });
    const r = run([errandLine('t1', 2000), errandLine('t2', 2000)]);
    expect(r.violations).toBe(1);
    expect(r.examples[0]).toMatch(/o_t2: courier d1 paid 2000 errand fee, his offer showed 1400/);
  });
});
