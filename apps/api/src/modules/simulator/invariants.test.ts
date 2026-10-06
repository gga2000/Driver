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
