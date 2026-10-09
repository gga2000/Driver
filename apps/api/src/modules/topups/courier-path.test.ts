import { describe, expect, it } from 'vitest';
import { DriverError, type Actor } from '@driver/contracts';
import { createInMemoryEvents } from '../events/index.js';
import { ledgerHarness } from '../ledger/test-harness.js';
import { ordersHarness } from '../orders/test-harness.js';
import { InMemoryTopUpsRepository } from './topups.repository.js';
import { TopUpService, courierCarriesOrderOf } from './topups.service.js';

const customer: Actor = { personId: 'c1', sessionId: 's-c1' };
const carrier: Actor = { personId: 'd1', sessionId: 's-d1' };
const other: Actor = { personId: 'd2', sessionId: 's-d2' };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

/**
 * `partner.topUpLookup/confirmTopUp` on the production binding of the courier check (orders + trips),
 * not a fake (review 2026-10-04 apps #10 follow-up): only the courier carrying one of the customer's
 * live orders, and the cash then sits on his cap until he settles.
 */
function setup() {
  const o = ordersHarness('2026-10-04T09:00:00Z');
  const lh = ledgerHarness({ start: '2026-10-04T09:00:00Z' });
  const ev = createInMemoryEvents({ clock: o.clock });
  const svc = new TopUpService(
    new InMemoryTopUpsRepository(),
    lh.ledger,
    ev.events,
    ev.uow,
    o.clock,
    { carriesOrderOf: courierCarriesOrderOf(o.orders, o.trips) },
    { cards: async (ids) => Object.fromEntries(ids.map((id) => [id, { name: 'علي', phoneMasked: '0770 ••• 0009' }])) },
  );
  return { o, lh, svc };
}

describe('courier top-up is limited to the courier carrying the customer’s live order', () => {
  it('a courier with no order of the customer, or another customer’s courier, is refused', async () => {
    const { o, svc } = setup();
    const r = await svc.request(customer, { amountIqd: 20_000 });
    expect(await code(svc.lookup(carrier, { code: r.code }, 'courier'))).toBe('topup_courier_not_assigned');
    // d2 carries an order of someone else.
    const theirs = await o.orders.place('c9', o.foodInput());
    await o.orders.merchantAccept('m1', { orderId: theirs.id, prepMinutes: 10 });
    await o.tripFor(theirs.id, { driverId: 'd2' });
    expect(await code(svc.confirm(other, { code: r.code, amountIqd: 20_000 }, 'courier'))).toBe('topup_courier_not_assigned');
  });

  it('the courier on the live order looks it up and confirms; the cash counts on his cap', async () => {
    const { o, lh, svc } = setup();
    const placed = await o.orders.place('c1', o.foodInput());
    await o.orders.merchantAccept('m1', { orderId: placed.id, prepMinutes: 10 });
    await o.tripFor(placed.id, { driverId: 'd1' });
    const r = await svc.request(customer, { amountIqd: 20_000 });
    expect(await code(svc.lookup(other, { code: r.code }, 'courier'))).toBe('topup_courier_not_assigned');
    expect(await svc.lookup(carrier, { code: r.code }, 'courier')).toMatchObject({ amountIqd: 20_000, state: 'pending' });
    const before = await lh.caps.status('d1');
    const done = await svc.confirm(carrier, { code: r.code, amountIqd: 20_000 }, 'courier');
    expect(done).toMatchObject({ channel: 'courier', amountIqd: 20_000 });
    // The customer's balance is never sent to the courier.
    expect(done).not.toHaveProperty('walletBalanceIqd');
    const after = await lh.caps.status('d1');
    expect(after.cashIqd).toBe(before.cashIqd - 20_000);
    expect(after.owedIqd).toBe(before.owedIqd + 20_000);
    expect(after.capRemainingIqd).toBe(before.capRemainingIqd - 20_000);
  });

  it('once the order is delivered and closed, he is no longer the customer’s courier', async () => {
    const { o, svc } = setup();
    const placed = await o.orders.place('c1', o.foodInput());
    await o.orders.merchantAccept('m1', { orderId: placed.id, prepMinutes: 10 });
    const trip = await o.tripFor(placed.id, { driverId: 'd1' });
    await o.pickup(trip.id);
    await o.dropoff(trip.id, { cashCollectedIqd: placed.totalIqd });
    await o.orders.rate('c1', { orderId: placed.id });
    const r = await svc.request(customer, { amountIqd: 10_000 });
    expect(await code(svc.confirm(carrier, { code: r.code, amountIqd: 10_000 }, 'courier'))).toBe('topup_courier_not_assigned');
  });
});
