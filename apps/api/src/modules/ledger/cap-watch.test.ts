import { describe, expect, it } from 'vitest';
import { decodeDomainEvent } from '@driver/contracts';
import { applyLines } from './cap-watch.js';
import { ledgerHarness, workedExample } from './test-harness.js';

/** A cash food order of `items` dinars carried by k1 (service 500 + delivery 1,000 on top), collected in full. */
const cashOrder = (orderId: string, items: number) => workedExample({ orderId, itemsSubtotalIqd: items, cashCollectedIqd: items + 1500 });

describe('cash-cap crossings (courier.cash_over_cap / courier.cash_under_cap)', () => {
  it('emits over_cap only on the collection that crosses, and under_cap only on the hand-in that brings him back', async () => {
    const h = ledgerHarness();
    const crossings = () => h.bus.emitted.filter((e) => e.type.startsWith('courier.cash_'));

    await h.posting.orderMoney(cashOrder('o1', 40000));
    expect((await h.caps.status('k1')).overCap).toBe(false);
    expect(crossings()).toHaveLength(0);

    // The second collection takes him past the 75,000 bronze courier cap.
    await h.posting.orderMoney(cashOrder('o2', 40000));
    const over = await h.caps.status('k1');
    expect(over.overCap).toBe(true);
    expect(crossings().map((e) => e.type)).toEqual(['courier.cash_over_cap']);
    const ev = crossings()[0]!;
    expect(decodeDomainEvent('courier.cash_over_cap', ev.payload)).toEqual({ courierId: 'k1', cashIqd: over.owedIqd, capIqd: 75000, cityId: 'aziziyah' });
    expect(ev.aggregate).toEqual({ name: 'driver', id: 'k1' });

    // Still over after another collection, and after a hand-in that leaves him over: nothing new.
    await h.posting.orderMoney(cashOrder('o3', 10000));
    await h.merchantCash.recordDriverSettlement({ driverId: 'k1', amountIqd: 5000, channel: 'agent', reference: 'AG-1' });
    expect((await h.caps.status('k1')).overCap).toBe(true);
    expect(crossings()).toHaveLength(1);

    // A replayed collection posts nothing, so it crosses nothing.
    await h.posting.orderMoney(cashOrder('o2', 40000));
    expect(crossings()).toHaveLength(1);

    // The hand-in that brings him under the cap.
    const owed = (await h.caps.status('k1')).owedIqd;
    await h.merchantCash.recordDriverSettlement({ driverId: 'k1', amountIqd: owed - 70000, channel: 'agent', reference: 'AG-2' });
    const under = await h.caps.status('k1');
    expect(under.overCap).toBe(false);
    expect(crossings().map((e) => e.type)).toEqual(['courier.cash_over_cap', 'courier.cash_under_cap']);
    expect(decodeDomainEvent('courier.cash_under_cap', crossings()[1]!.payload)).toEqual({ courierId: 'k1', cashIqd: 70000, capIqd: 75000, cityId: 'aziziyah' });

    // Another hand-in while under: nothing.
    await h.merchantCash.recordDriverSettlement({ driverId: 'k1', amountIqd: 10000, channel: 'agent', reference: 'AG-3' });
    expect(crossings()).toHaveLength(2);

    // Over again on the next collection: a fresh crossing, a fresh event.
    await h.posting.orderMoney(cashOrder('o4', 20000));
    expect(crossings().map((e) => e.type)).toEqual(['courier.cash_over_cap', 'courier.cash_under_cap', 'courier.cash_over_cap']);
  });

  it('exactly at the cap counts as over; a driver with a bigger cap does not cross where a courier would', async () => {
    const h = ledgerHarness();
    h.profiles.set('k1', { role: 'courier', tier: 'silver' });
    await h.posting.orderMoney(cashOrder('o1', 40000));
    await h.posting.orderMoney(cashOrder('o2', 40000));
    expect(h.bus.emitted.filter((e) => e.type.startsWith('courier.cash_'))).toHaveLength(0);
  });

  it('crosses through the order.cash_collected subscriber too, in the handler that posts', async () => {
    const h = ledgerHarness();
    for (const id of ['o1', 'o2']) {
      const order = cashOrder(id, 40000);
      await h.bus.publish('order.cash_collected', { kind: 'order', order, tripId: `t_${id}`, courierId: 'k1', amountIqd: order.cashCollectedIqd, expectedIqd: order.cashCollectedIqd, discrepancyIqd: 0 });
    }
    expect(h.bus.types().filter((t) => t.startsWith('courier.cash_'))).toEqual(['courier.cash_over_cap']);
  });

  it('applyLines moves cash and earnings the way balances do (inflow +, outflow −)', () => {
    const rows = [
      { type: 'cash_collected' as const, amount: 16500, fromAccount: 'cash:k1', toAccount: 'customer:c1', occurredAt: new Date(), currency: 'IQD' as const },
      { type: 'delivery_fee' as const, amount: 1000, fromAccount: 'platform', toAccount: 'driver:k1', occurredAt: new Date(), currency: 'IQD' as const },
    ];
    expect(applyLines('k1', { cashIqd: 0, earningsIqd: 0 }, rows as never)).toEqual({ cashIqd: -16500, earningsIqd: 1000 });
    expect(applyLines('k2', { cashIqd: 5, earningsIqd: 6 }, rows as never)).toEqual({ cashIqd: 5, earningsIqd: 6 });
  });
});
