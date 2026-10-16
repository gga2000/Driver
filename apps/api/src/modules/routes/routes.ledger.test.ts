import { describe, expect, it } from 'vitest';
import { decodeDomainEvent, isDomainEventType } from '@driver/contracts';
import { LEDGER_SUBSCRIBED_EVENTS } from '../ledger/index.js';
import { ledgerHarness } from '../ledger/test-harness.js';
import type { RecordedRoutesEvent } from './events.adapter.js';
import { DEFAULT_GARAGE_WATCH_RULES, DeparturesStaffService } from './departures.staff.js';
import { BAB2, routesHarness } from './test-harness.js';

/** What the ledger's bus delivers: the envelope merged under the payload, JSON round-tripped. */
async function deliver(events: readonly RecordedRoutesEvent[], l = ledgerHarness()) {
  for (const e of events) {
    if (!LEDGER_SUBSCRIBED_EVENTS.includes(e.type)) continue;
    await l.bus.publish(
      e.type,
      JSON.parse(
        JSON.stringify({ actorId: e.actorId, occurredAt: e.occurredAt, ...e.payload }),
      ) as Record<string, unknown>,
    );
  }
  return l;
}

describe('ledger: a full departure settles through the existing posting groups (money §3)', () => {
  /**
   * Saloon to Baghdad, leaves 12:30 (fare 5,000, front +1,000; Ali 2026-10-07): r1 front (wallet), r2
   * back_left (cash), r3 back_right (wallet), a declared walk-up in the middle after the selfie.
   * The driver checks in at 12:20, r2 and r3 at 12:25, r1 at 12:42: 12 minutes on her meter.
   */
  async function fullRun() {
    const h = routesHarness();
    const dep = await h.announce({ departAt: h.at(30), latestDepartureAt: h.at(60) });
    const r1 = await h.book('r1', dep.id, ['front']);
    const r2 = await h.book('r2', dep.id, ['back_left'], { payment: 'cash' });
    const r3 = await h.book('r3', dep.id, ['back_right']);
    h.advance(20);
    await h.driverAt(dep.id);
    await h.departures.selfie('d1', dep.id, 'selfie');
    await h.departures.markWalkUp('d1', dep.id, { seatId: 'back_middle', travellingAs: 'rijal' });
    h.advance(5);
    await h.checkIn(dep.id, r2.id);
    await h.checkIn(dep.id, r3.id);
    h.advance(17);
    await h.checkIn(dep.id, r1.id);
    h.advance(1);
    await h.departures.depart('d1', dep.id);
    h.advance(110);
    await h.departures.arrive('d1', dep.id);
    return { h, dep };
  }

  it('every ledger-facing event decodes with its shared contract', async () => {
    const { h } = await fullRun();
    const contracted = h.events.events.filter((e) => isDomainEventType(e.type));
    expect(new Set(contracted.map((e) => e.type))).toEqual(
      new Set(['seat.late_meter_settled', 'seat.completed']),
    );
    for (const e of contracted)
      expect(() =>
        decodeDomainEvent(e.type as never, {
          actorId: e.actorId,
          occurredAt: e.occurredAt.toISOString(),
          ...e.payload,
        }),
      ).not.toThrow();
  });

  it('seat 10 %, front premium 25 %, late meter 100 % to the wronged; walk-ups carry nothing; balances net to zero; replays add nothing', async () => {
    const { h } = await fullRun();
    const l = await deliver(h.events.events);
    const bal = async (a: string) => (await l.ledger.balance(a)).amount;
    // take: 3 × 500 (10 % of 5,000) + 250 (25 % of 1,000)
    expect(await bal('platform')).toBe(1_750);
    // fares 15,000 + premium 1,000 − take 1,750 + r1's meter (1 block: 12 − 5 grace → 1,000)
    expect(await bal('driver:d1')).toBe(15_250);
    // r2 paid 5,000 cash into the driver's hand
    expect(await bal('cash:d1')).toBe(-5_000);
    // r1: 6,000 seat from the wallet, 1,000 to the driver, 500 to each rider who waited
    expect(await bal('customer:r1')).toBe(-8_000);
    expect(await bal('customer:r2')).toBe(500);
    expect(await bal('customer:r3')).toBe(-4_500);
    const inv = await l.ledger.checkInvariant();
    expect(inv.ok).toBe(true);
    const before = inv.events;
    await deliver(h.events.events, l);
    expect((await l.ledger.checkInvariant()).events).toBe(before);
  });

  it('driver cancel inside 2 h: 2,000 credit per booked rider from the driver; a prepaid no-show leaves the fare with the driver', async () => {
    const h = routesHarness();
    const dep = await h.announce();
    await h.book('r1', dep.id, ['front']);
    await h.book('r2', dep.id, ['back_left'], { payment: 'cash' });
    await h.departures.cancelByDriver('d1', dep.id, 'reason');
    const other = await h.announce({
      driverId: 'd2',
      garageId: BAB2.id,
      departAt: h.at(10),
      latestDepartureAt: h.at(30),
    });
    await h.book('r3', other.id, ['back_right']);
    h.advance(30);
    await h.driverAt(other.id, BAB2, 0, 'd2');
    await h.departures.markNoShow('d2', other.id, (await h.departures.bookings(other.id))[0]!.id);
    const l = await deliver(h.events.events);
    const bal = async (a: string) => (await l.ledger.balance(a)).amount;
    expect(await bal('customer:r1')).toBe(2_000);
    expect(await bal('customer:r2')).toBe(2_000);
    expect(await bal('driver:d1')).toBe(-4_000);
    // r3's prepaid no-show: the driver keeps 5,000 less the 10 % take
    expect(await bal('driver:d2')).toBe(4_500);
    expect(await bal('customer:r3')).toBe(-5_000);
    expect((await l.ledger.checkInvariant()).ok).toBe(true);
  });

  it('M-11 no-show cancel (switch on): each rider gets 2,000 from the driver, a rider with two seats once; switch off: nothing moves', async () => {
    const audit = { record: async () => ({ id: 'a' }) };
    const ops = { personId: 'ops1', sessionId: 's' };
    for (const noShowFee of [true, false]) {
      const h = routesHarness();
      const staff = new DeparturesStaffService(h.departures, audit, { ...DEFAULT_GARAGE_WATCH_RULES, noShowFee });
      const dep = await h.announce();
      await h.book('r1', dep.id, ['front']);
      await h.book('r2', dep.id, ['back_left', 'back_middle'], { payment: 'cash' });
      h.advance(171);
      await staff.cancel(ops, { departureId: dep.id, reason: 'السايق ما إجه' });
      const l = await deliver(h.events.events);
      const bal = async (a: string) => (await l.ledger.balance(a)).amount;
      expect([await bal('customer:r1'), await bal('customer:r2'), await bal('driver:d1')]).toEqual(noShowFee ? [2_000, 2_000, -4_000] : [0, 0, 0]);
      expect((await l.ledger.checkInvariant()).ok).toBe(true);
    }
  });
});
