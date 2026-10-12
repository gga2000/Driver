import { describe, expect, it } from 'vitest';
import { ledgerHarness, workedExample } from '../ledger/test-harness.js';
import { CASH_HOLD_MS } from './offer.orchestrator.js';
import { dispatchHarness, north } from './test-harness.js';

/**
 * Simulator near-miss: a courier's cash drop-off completed in the same millisecond a ride went out.
 * Dispatch frees him on `trip.completed`, but the cash he just took reaches the ledger only after
 * that (order.cash_collected → ledger posting, through the outbox). In that gap his cap check read
 * the old position and he was offered a cash ride while, with the cash in hand, he owed more than
 * his 75,000 cap. Dispatch now keeps the finished job's cash as a hold until the posting lands.
 */
describe('cash of a finished job counts toward the cap until the ledger posts it', () => {
  // Each worked-example order leaves a bronze courier owing 15,500 (cash 16,500 minus his 1,000 fee).
  const order = (i: number, tripId = `old${i}`) => workedExample({ orderId: `o${i}`, tripId, courierId: 'k1' });

  async function setup() {
    const ledger = ledgerHarness({ start: '2026-10-03T09:00:00Z' });
    const h = dispatchHarness('2026-10-03T09:00:00Z', undefined, { caps: ledger.caps });
    for (let i = 0; i < 4; i++) await ledger.posting.orderMoney(order(i)); // owes 62,000 of 75,000
    await h.online('k1', 0.2, { vehicle: 'tuktuk' });
    // His fifth cash order: 16,500 at the door.
    await h.service.request({ tripId: 'f5', cityId: 'aziziyah', vertical: 'food', zoneId: 'centre', pickup: north(0), dropoffZoneId: 'centre', readyAt: h.clock.now(), hot: true, cashIqd: 16_500 });
    const offer = await h.openOffer('f5', 'k1');
    await h.service.respond(h.actor('k1'), { offerId: offer!.id, accept: true });
    return { h, ledger };
  }

  const ride = (h: ReturnType<typeof dispatchHarness>, tripId: string) =>
    h.service.request({ tripId, cityId: 'aziziyah', vertical: 'tuktuk', zoneId: 'centre', pickup: north(0.1), dropoffZoneId: 'centre', cashIqd: 5_000 });

  it('a ride sent between trip.completed and the cash posting does not reach him', async () => {
    const { h, ledger } = await setup();
    await h.orchestrator.jobFinished('f5'); // trip.completed: free again; the posting is still in the outbox
    expect((await ledger.caps.status('k1')).owedIqd).toBe(62_000); // the ledger has not seen the cash yet
    await ride(h, 'r1');
    expect(h.trips.offeredTo('r1')).not.toContain('k1');
    expect(await h.orchestrator.isOverCap('k1')).toBe(true);

    await ledger.posting.orderMoney(order(5, 'f5')); // the posting lands
    expect((await ledger.caps.status('k1')).owedIqd).toBe(77_500);
    expect(await h.orchestrator.isOverCap('k1')).toBe(true);
    expect(await h.store.cashHolds('k1')).toEqual([]); // posted: the hold is gone, nothing counted twice
  });

  it('a hold whose posting never comes (nothing collected) lapses after CASH_HOLD_MS', async () => {
    const { h } = await setup();
    await h.orchestrator.jobFinished('f5');
    expect(await h.orchestrator.isOverCap('k1')).toBe(true);
    h.keepAlive.add('k1');
    await h.advance(CASH_HOLD_MS / 1000);
    expect(await h.orchestrator.isOverCap('k1')).toBe(false);
    expect(await h.store.cashHolds('k1')).toEqual([]);
    await ride(h, 'r2');
    expect(h.trips.offeredTo('r2')).toContain('k1');
  });

  it('a prepaid job leaves no hold', async () => {
    const ledger = ledgerHarness({ start: '2026-10-03T09:00:00Z' });
    const h = dispatchHarness('2026-10-03T09:00:00Z', undefined, { caps: ledger.caps });
    await h.online('k1', 0.2, { vehicle: 'tuktuk' });
    await h.service.request({ tripId: 'p1', cityId: 'aziziyah', vertical: 'food', zoneId: 'centre', pickup: north(0), dropoffZoneId: 'centre', readyAt: h.clock.now(), hot: true });
    const offer = await h.openOffer('p1', 'k1');
    await h.service.respond(h.actor('k1'), { offerId: offer!.id, accept: true });
    await h.orchestrator.jobFinished('p1');
    expect(await h.store.cashHolds('k1')).toEqual([]);
  });
});
