import { describe, expect, it } from 'vitest';
import { RIDE_HABIT_RULES } from '@driver/contracts';
import { FAVOURITE_OFFER_POLICY } from './offer.orchestrator.js';
import { DispatchSubscribers } from './events.subscribers.js';
import { dispatchHarness, north } from './test-harness.js';

type H = ReturnType<typeof dispatchHarness>;
const WINDOW = RIDE_HABIT_RULES.favourite.offerWindowSec;

const taxi = (h: H, extra: Record<string, unknown> = {}) => h.service.request({ tripId: 't1', cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0), ...extra });

async function fleet(h: H) {
  for (const [id, km] of [['a1', 0.2], ['a2', 0.5], ['fav', 2.5]] as const) {
    await h.online(id, km);
    h.keepAlive.add(id);
  }
}

async function respond(h: H, driverId: string, accept = true) {
  const offer = await h.openOffer('t1', driverId);
  if (!offer) throw new Error(`no open offer for ${driverId}`);
  return h.service.respond(h.actor(driverId), { offerId: offer.id, accept });
}

describe('rides booked for later (joy J7d)', () => {
  it('wait on the board as scheduled and start the waves at their start time', async () => {
    const h = dispatchHarness();
    await fleet(h);
    await taxi(h, { startAt: new Date(h.clock.now().getTime() + 20 * 60_000) });
    expect(h.trips.offers).toEqual([]);
    expect((await h.service.getRequest('t1'))?.status).toBe('scheduled');
    expect((await h.service.board('aziziyah')).cards[0]).toMatchObject({ tripId: 't1', status: 'scheduled' });
    await h.advance(20 * 60 - 1);
    expect(h.trips.offers).toEqual([]);
    await h.advance(1);
    expect(h.trips.offers[0]).toEqual({ tripId: 't1', driverIds: ['a1', 'a2'], timeoutSec: 15 });
    expect((await h.service.getRequest('t1'))?.status).toBe('searching');
  });

  it('cancelled while waiting: nothing is ever offered', async () => {
    const h = dispatchHarness();
    await fleet(h);
    await taxi(h, { startAt: new Date(h.clock.now().getTime() + 60_000) });
    await h.service.cancel('t1');
    await h.advance(120);
    expect(h.trips.offers).toEqual([]);
  });
});

describe('favourite first (joy l9)', () => {
  it('rings the favourite alone for a minute, then the normal waves', async () => {
    const h = dispatchHarness();
    await fleet(h);
    await taxi(h, { preferDriverIds: ['fav'] });
    expect(h.trips.offers).toEqual([{ tripId: 't1', driverIds: ['fav'], timeoutSec: WINDOW }]);
    const first = (await h.offers('t1'))[0]!;
    expect(first).toMatchObject({ policy: FAVOURITE_OFFER_POLICY, wave: 0, driverId: 'fav' });
    expect(h.events.ofType('dispatch.wave_sent')[0]?.payload).toMatchObject({ wave: 0, driverIds: ['fav'], favourite: true });
    await h.advance(WINDOW - 1);
    expect(h.trips.offers).toHaveLength(1);
    await h.advance(1);
    expect(h.trips.offers[1]).toEqual({ tripId: 't1', driverIds: ['a1', 'a2'], timeoutSec: 15 });
    expect((await h.offers('t1')).find((o) => o.driverId === 'fav')?.state).toBe('timed_out');
  });

  it('his accept assigns the ride to him', async () => {
    const h = dispatchHarness();
    await fleet(h);
    await taxi(h, { preferDriverIds: ['fav'] });
    await respond(h, 'fav');
    expect((await h.service.getRequest('t1'))?.assignedDriverId).toBe('fav');
    await h.advance(200);
    expect(h.trips.offers).toHaveLength(1);
  });

  it('his decline starts the waves at once, and he is not asked again in them', async () => {
    const h = dispatchHarness();
    await fleet(h);
    await taxi(h, { preferDriverIds: ['fav'] });
    await respond(h, 'fav', false);
    expect(h.trips.offers[1]).toEqual({ tripId: 't1', driverIds: ['a1', 'a2'], timeoutSec: 15 });
    await h.advance(30);
    expect(h.trips.offers.flatMap((o) => o.driverIds).filter((d) => d === 'fav')).toHaveLength(1);
  });

  it('offline or busy: the normal waves start at once', async () => {
    const h = dispatchHarness();
    await h.online('a1', 0.2);
    await taxi(h, { preferDriverIds: ['away'] });
    expect(h.trips.offers).toEqual([{ tripId: 't1', driverIds: ['a1'], timeoutSec: 15 }]);
    expect(h.events.ofType('dispatch.wave_sent').map((e) => e.payload['wave'])).toEqual([1]);
  });

  it('a booked ride with a favourite rings him when its search starts', async () => {
    const h = dispatchHarness();
    await fleet(h);
    await taxi(h, { startAt: new Date(h.clock.now().getTime() + 60_000), preferDriverIds: ['fav'] });
    await h.advance(60);
    expect(h.trips.offers).toEqual([{ tripId: 't1', driverIds: ['fav'], timeoutSec: WINDOW }]);
  });
});

describe('dispatch:ride-request', () => {
  it('passes the booked time (search 30 min before), the order and the favourite from order.placed', async () => {
    const h = dispatchHarness();
    await fleet(h);
    const subs = new DispatchSubscribers(h.orchestrator, h.trips, h.zones);
    const at = new Date(h.clock.now().getTime() + 60 * 60_000);
    await subs.onRidePlaced({
      orderId: 'o1',
      aggregateId: 'o1',
      payload: {
        type: 'ride',
        cityId: 'aziziyah',
        paymentMethod: 'cash',
        totalIqd: 3000,
        scheduledFor: at.toISOString(),
        ride: { vertical: 'taxi', pickup: { zoneKey: 'centre', pin: north(0) }, dropoff: { zoneKey: 'centre', pin: north(1) }, quoteId: null, preferDriverId: 'fav' },
      },
    });
    const tripId = 'trip-o1';
    const r = await h.service.getRequest(tripId);
    expect(r).toMatchObject({ status: 'scheduled', startAt: at.getTime() - 30 * 60_000, scheduledFor: at.getTime(), preferDriverIds: ['fav'] });
  });
});
