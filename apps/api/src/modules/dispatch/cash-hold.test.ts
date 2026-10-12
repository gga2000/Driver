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

  it('every offer path sees the hold, not only the retry on jobFinished (supersedes the narrower wouldBeOverCap guard)', async () => {
    // The same case as the retry-only guard's test, with fake caps: room 20,000 → the red ride is his; 12,000 → it is not.
    for (const [room, expected] of [[20_000, ['a1']], [12_000, []]] as const) {
      const h = dispatchHarness();
      await h.online('a1', 0.2);
      h.keepAlive.add('a1');
      await h.service.request({ tripId: 't1', cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0), cashIqd: 12_000 });
      const offer = await h.openOffer('t1', 'a1');
      await h.service.respond(h.actor('a1'), { offerId: offer!.id, accept: true });
      await h.service.request({ tripId: 't2', cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0) });
      await h.advance(15 * 60);
      expect(h.trips.offeredTo('t2')).toEqual([]);
      h.caps.remaining.set('a1', room);
      await h.service.jobFinished('t1');
      expect(h.trips.offeredTo('t2')).toEqual(expected);
      if (room === 12_000) {
        // A brand-new ride in the same instant, before the posting: not his either.
        await h.service.request({ tripId: 't3', cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0) });
        expect(h.trips.offeredTo('t3')).toEqual([]);
        // The posting lands (room now reflects it): the hold goes and nothing is counted twice.
        h.caps.posted.add('a1:t1');
        h.caps.remaining.set('a1', 8_000);
        expect(await h.orchestrator.isOverCap('a1')).toBe(false);
      }
    }
  });

  it('holds the cash recorded at the door when it is more than the total (a whole note, change to the wallet)', async () => {
    // Simulator seed 20: a 17,500 order paid with a 20,000 note (2,500 to the wallet). Holding only the
    // order's total left him under his cap by dispatch's count, while the posting took him over it.
    const ledger = ledgerHarness({ start: '2026-10-03T09:00:00Z' });
    const h = dispatchHarness('2026-10-03T09:00:00Z', undefined, { caps: ledger.caps });
    for (let i = 0; i < 3; i++) await ledger.posting.orderMoney(order(i));
    await ledger.posting.orderMoney(workedExample({ orderId: 'o3', tripId: 'old3', courierId: 'k1', itemsSubtotalIqd: 10_000 }));
    expect((await ledger.caps.status('k1')).owedIqd).toBe(57_000);
    await h.online('k1', 0.2, { vehicle: 'tuktuk' });
    await h.service.request({ tripId: 'f5', cityId: 'aziziyah', vertical: 'food', zoneId: 'centre', pickup: north(0), dropoffZoneId: 'centre', readyAt: h.clock.now(), hot: true, cashIqd: 17_500 });
    const offer = await h.openOffer('f5', 'k1');
    await h.service.respond(h.actor('k1'), { offerId: offer!.id, accept: true });

    await h.orchestrator.cashCollected('f5', 'drop-1', 20_000); // stop.completed, before trip.completed
    await h.orchestrator.cashCollected('f5', 'drop-1', 20_000); // a redelivery changes nothing
    await h.orchestrator.jobFinished('f5'); // the request's 17,500 does not lower it
    expect((await h.store.cashHolds('k1')).map((x) => x.amountIqd)).toEqual([20_000]);
    expect(await ledger.caps.isOverCap('k1', 17_500)).toBe(false); // 74,500: the total alone let him through
    expect(await h.orchestrator.isOverCap('k1')).toBe(true); // 77,000 with the note in his hand
    await ride(h, 'r3');
    expect(h.trips.offeredTo('r3')).not.toContain('k1');
  });
});
