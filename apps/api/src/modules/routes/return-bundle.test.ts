import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, HoldSeatInput, lapChildrenAllowed, type DriverError, type MoneyRules } from '@driver/contracts';
import { LEDGER_SUBSCRIBED_EVENTS } from '../ledger/index.js';
import { ledgerHarness } from '../ledger/test-harness.js';
import type { RecordedRoutesEvent } from './events.adapter.js';
import { returnDiscount } from './model.js';
import { NAHDHA, routesHarness } from './test-harness.js';

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as DriverError).code ?? String(err);
  }
  return 'no error';
}

const ON: Partial<MoneyRules> = { intercityReturnBundle: { enabled: true, percent: 10, fundedBy: 'platform' } };

/** r1 books a seat to Baghdad (leaves in 2 h); the car back from النهضة leaves in 6 h. */
async function twoWays(money: Partial<MoneyRules> = ON) {
  const h = routesHarness({ money });
  const out = await h.announce();
  const back = await h.announce({ driverId: 'd2', garageId: NAHDHA.id, departAt: h.at(360), latestDepartureAt: h.at(390) });
  const there = await h.book('r1', out.id, ['back_left'], { payment: 'cash' });
  return { h, out, back, there };
}

describe('step 5: return trip 10 % off (Ali item 51), switch intercityReturnBundle', () => {
  it('rounds each seat down to 250', () => {
    expect(returnDiscount(1, 5_000, 10)).toBe(500);
    expect(returnDiscount(2, 5_000, 10)).toBe(1_000);
    expect(returnDiscount(1, 6_300, 10)).toBe(500);
    expect(returnDiscount(1, 2_000, 10)).toBe(0);
  });

  it('off (as shipped): no offer on the ticket and the seat back costs the full price', async () => {
    const { h, back, there } = await twoWays(AZIZIYAH_MONEY_RULES);
    expect(AZIZIYAH_MONEY_RULES.intercityReturnBundle.enabled).toBe(false);
    expect((await h.rpc.myBookings({ personId: 'r1', roles: ['customer'] } as never)).find((b) => b.id === there.id)?.returnOfferPercent).toBeNull();
    const home = await h.book('r1', back.id, ['back_left'], { payment: 'cash' });
    expect(home).toMatchObject({ returnDiscountIqd: 0, returnPairId: null });
    expect(h.events.ofType('seat.return_paired')).toHaveLength(0);
  });

  it('the seat back booked before the first car leaves: the pair saves 10 % of both seats, all on the later seat', async () => {
    const { h, back, there } = await twoWays();
    const ticket = (await h.rpc.myBookings({ personId: 'r1', roles: ['customer'] } as never)).find((b) => b.id === there.id);
    expect(ticket).toMatchObject({ returnOfferPercent: 10, returnDiscountIqd: 0, totalIqd: 5_000 });
    const held = await h.hold('r1', back.id, ['back_left']);
    // The hold already shows what booking now gives.
    expect(held.returnDiscountIqd).toBe(1_000);
    const home = await h.departures.book('r1', held.id, 'cash');
    expect(home).toMatchObject({ returnDiscountIqd: 1_000, returnPairId: there.id });
    const first = await h.departures.booking(there.id);
    expect(first).toMatchObject({ returnDiscountIqd: 0, returnPairId: home.id });
    const views = await h.rpc.myBookings({ personId: 'r1', roles: ['customer'] } as never);
    expect(views.find((b) => b.id === home.id)).toMatchObject({ totalIqd: 4_000, returnDiscountIqd: 1_000, returnPairBookingId: there.id, returnOfferPercent: null });
    expect(views.find((b) => b.id === there.id)).toMatchObject({ totalIqd: 5_000, returnOfferPercent: null });
    expect(h.events.ofType('seat.return_paired')[0]?.payload).toMatchObject({ bookingId: home.id, pairBookingId: there.id, discountIqd: 1_000, discountedBookingId: home.id });
  });

  it('a wallet seat back is checked against the discounted total', async () => {
    const { h, back } = await twoWays();
    h.wallet.set('r1', 4_000);
    const held = await h.hold('r1', back.id, ['back_left']);
    expect(await h.departures.book('r1', held.id, 'wallet')).toMatchObject({ prepaid: true, returnDiscountIqd: 1_000 });
  });

  it('no pair: same direction, the other road, or the first car already left', async () => {
    const { h, out, there } = await twoWays();
    const again = await h.announce({ driverId: 'd3', departAt: h.at(300), latestDepartureAt: h.at(330) });
    // Same direction: a second seat out is not a way back (and he holds a seat already → conflict on the same car only).
    expect((await h.book('r1', again.id, ['back_left'], { payment: 'cash' })).returnDiscountIqd).toBe(0);
    // The first car left: too late to pair.
    const h2 = routesHarness({ money: ON });
    const o2 = await h2.announce({ departAt: h2.at(30), latestDepartureAt: h2.at(60) });
    const b2 = await h2.announce({ driverId: 'd2', garageId: NAHDHA.id, departAt: h2.at(360), latestDepartureAt: h2.at(390) });
    const t2 = await h2.book('r1', o2.id, ['back_left'], { payment: 'cash' });
    h2.advance(25);
    await h2.driverAt(o2.id);
    await h2.departures.selfie('d1', o2.id, 'selfie');
    await h2.checkIn(o2.id, t2.id);
    h2.advance(6);
    await h2.departures.depart('d1', o2.id);
    expect((await h2.book('r1', b2.id, ['back_left'], { payment: 'cash' })).returnDiscountIqd).toBe(0);
    expect(out.id).not.toBe(again.id);
    expect(there.state).toBe('booked');
  });

  it('cancelling the first seat sends the seat back to full price; cancelling the seat back leaves the first as it was', async () => {
    const { h, back, there } = await twoWays();
    const home = await h.book('r1', back.id, ['back_left'], { payment: 'cash' });
    await h.departures.cancel('r1', there.id);
    expect(await h.departures.booking(home.id)).toMatchObject({ returnDiscountIqd: 0, returnPairId: null });
    expect(h.events.ofType('seat.return_unpaired')[0]?.payload).toMatchObject({ bookingId: home.id, reason: 'rider_cancelled', discountIqd: 1_000 });
    // And his ticket offers the pair again.
    const views = await h.rpc.myBookings({ personId: 'r1', roles: ['customer'] } as never);
    expect(views.find((b) => b.id === home.id)?.returnOfferPercent).toBe(10);

    const t = await twoWays();
    const home2 = await t.h.book('r1', t.back.id, ['back_left'], { payment: 'cash' });
    await t.h.departures.cancel('r1', home2.id);
    expect(await t.h.departures.booking(t.there.id)).toMatchObject({ returnDiscountIqd: 0, returnPairId: null, state: 'booked' });
    expect(t.h.events.ofType('seat.return_unpaired')).toHaveLength(0);
  });

  it('a seat the driver cancelled moves to the next car and keeps its pair', async () => {
    const { h, back, there } = await twoWays();
    await h.announce({ driverId: 'd3', garageId: NAHDHA.id, departAt: h.at(400), latestDepartureAt: h.at(430) });
    const home = await h.book('r1', back.id, ['back_left'], { payment: 'cash' });
    await h.departures.cancelByDriver('d2', back.id, 'car broke');
    const moved = (await h.departures.booking(home.id)).movedToBookingId;
    expect(moved).toBeTruthy();
    expect(await h.departures.booking(moved!)).toMatchObject({ returnDiscountIqd: 1_000, returnPairId: there.id, origin: 'moved' });
    expect((await h.departures.booking(there.id)).returnPairId).toBe(moved);
  });
});

/** What the ledger's bus delivers: the envelope merged under the payload, JSON round-tripped. */
async function deliver(events: readonly RecordedRoutesEvent[], l = ledgerHarness()) {
  for (const e of events) {
    if (!LEDGER_SUBSCRIBED_EVENTS.includes(e.type)) continue;
    await l.bus.publish(e.type, JSON.parse(JSON.stringify({ actorId: e.actorId, occurredAt: e.occurredAt, ...e.payload })) as Record<string, unknown>);
  }
  return l;
}

/** The pair booked, then the car back runs: r1 pays 4,000 cash for the 5,000 seat. */
async function rideBack(money: Partial<MoneyRules>) {
  const { h, back } = await twoWays(money);
  const home = await h.book('r1', back.id, ['back_left'], { payment: 'cash' });
  h.advance(355);
  await h.driverAt(back.id, NAHDHA, 0, 'd2');
  await h.departures.selfie('d2', back.id, 'selfie');
  await h.checkIn(back.id, home.id, 'd2');
  h.advance(6);
  await h.departures.depart('d2', back.id);
  h.advance(120);
  await h.departures.arrive('d2', back.id);
  const l = await deliver(h.events.events);
  const bal = async (a: string) => (await l.ledger.balance(a)).amount;
  return { l, bal };
}

describe('step 5: the return discount in the ledger', () => {
  it('company-funded (recommended): the driver is paid on the full seat, the company covers the 1,000', async () => {
    const { l, bal } = await rideBack(ON);
    expect(await bal('driver:d2')).toBe(4_500); // 5,000 − 10 % take
    expect(await bal('cash:d2')).toBe(-4_000); // what r1 handed over
    expect(await bal('platform')).toBe(500 - 1_000);
    expect(await bal('customer:r1')).toBe(0);
    expect((await l.ledger.checkInvariant()).ok).toBe(true);
  });

  it('driver-funded: the driver gives up his own seat\'s 500 only; the company covers the other car\'s 500', async () => {
    const { l, bal } = await rideBack({ intercityReturnBundle: { enabled: true, percent: 10, fundedBy: 'driver' } });
    expect(await bal('driver:d2')).toBe(4_050); // 4,500 − 10 % take
    expect(await bal('cash:d2')).toBe(-4_000);
    expect(await bal('platform')).toBe(450 - 500);
    expect(await bal('customer:r1')).toBe(0);
    expect((await l.ledger.checkInvariant()).ok).toBe(true);
  });
});

describe('step 5: children on a lap ride free (Ali item 52)', () => {
  it('one per seat, never on the front seat; free; the driver sees them', async () => {
    expect(lapChildrenAllowed(['front'])).toBe(0);
    expect(lapChildrenAllowed(['front', 'back_left', 'back_right'])).toBe(2);
    const h = routesHarness();
    const dep = await h.announce();
    const lap = (seatIds: Parameters<typeof h.hold>[2], n: number, rider: string) =>
      h.departures.hold(rider, HoldSeatInput.parse({ departureId: dep.id, selection: { kind: 'seats', seatIds }, travellingAs: 'aila', lapChildren: n }));
    expect(await code(lap(['front'], 1, 'r1'))).toBe('lap_children_invalid');
    expect(await code(lap(['back_left'], 2, 'r1'))).toBe('lap_children_invalid');
    expect(() => HoldSeatInput.parse({ departureId: dep.id, selection: { kind: 'car' }, travellingAs: 'aila', lapChildren: 4 })).toThrow();
    const held = await lap(['back_left', 'back_right'], 2, 'r1');
    const booked = await h.departures.book('r1', held.id, 'cash');
    expect(booked).toMatchObject({ lapChildren: 2 });
    const views = await h.rpc.myBookings({ personId: 'r1', roles: ['customer'] } as never);
    expect(views[0]).toMatchObject({ lapChildren: 2, totalIqd: 10_000 });
    const driver = await h.rpc.driverDeparture({ personId: 'd1', roles: ['intercity_driver'] } as never, { departureId: dep.id });
    expect(driver.bookings[0]).toMatchObject({ lapChildren: 2 });
  });
});
