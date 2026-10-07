import { describe, expect, it } from 'vitest';
import { DriverError, NUDGE_RULES, RIDE_HABIT_RULES } from '@driver/contracts';
import { DispatchSubscribers } from './events.subscribers.js';
import { FAVOURITE_OFFER_POLICY } from './offer.orchestrator.js';
import type { RiderPrefsPort } from './ports.js';
import { dispatchHarness, north } from './test-harness.js';

type H = ReturnType<typeof dispatchHarness>;
const DAY = 86_400_000;

const code = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DriverError);
  return (e as DriverError).code;
};

/** The rider's lists and drivers' standing, as ride habits would bind them. */
function riders(h: H, over: { avoided?: string[]; favourites?: string[]; standing?: Record<string, { rating: number | null; days: number | null }> } = {}): RiderPrefsPort {
  const port: RiderPrefsPort = {
    avoided: async (personId) => (personId === 'c1' ? (over.avoided ?? []) : []),
    favourites: async (personId) => (personId === 'c1' ? (over.favourites ?? []) : []),
    standing: async (ids) =>
      new Map(
        ids.map((id) => {
          const s = over.standing?.[id];
          return [id, { rating: s?.rating ?? null, driverSince: s?.days == null ? null : new Date(h.clock.now().getTime() - s.days * DAY) }];
        }),
      ),
  };
  h.service.bindRiders(port);
  return port;
}

const ride = (h: H, extra: Record<string, unknown> = {}) => h.service.request({ tripId: 't1', cityId: 'aziziyah', vertical: 'taxi', zoneId: 'centre', pickup: north(0), riderId: 'c1', ...extra });

async function fleet(h: H, drivers: ReadonlyArray<readonly [string, number]>) {
  for (const [id, km] of drivers) {
    await h.online(id, km);
    h.keepAlive.add(id);
  }
}

describe('«ما أريده مرة ثانية» (ride step 3, s5)', () => {
  it('never offers the rider’s ride to a driver he avoids, in any wave or the re-broadcast', async () => {
    const h = dispatchHarness();
    riders(h, { avoided: ['a1'] });
    await fleet(h, [
      ['a1', 0.2],
      ['a2', 0.5],
      ['a3', 3],
    ]);
    await ride(h);
    await h.advance(90);
    const offered = new Set(h.trips.offeredTo('t1'));
    expect(offered.has('a1')).toBe(false);
    expect(offered.has('a2')).toBe(true);
    expect(offered.has('a3')).toBe(true);
  });

  it('a dispatcher cannot hand him the ride either, not even forced', async () => {
    const h = dispatchHarness();
    riders(h, { avoided: ['a1'] });
    await fleet(h, [['a1', 0.2]]);
    await ride(h);
    expect(await code(h.service.override(h.actor('ops'), { tripId: 't1', driverId: 'a1', force: true, reason: 'only one nearby' }))).toBe('override_invalid');
  });

  it('another rider’s list does not apply', async () => {
    const h = dispatchHarness();
    riders(h, { avoided: ['a1'] });
    await fleet(h, [['a1', 0.2]]);
    await ride(h, { riderId: 'c2' });
    expect(h.trips.offeredTo('t1')).toEqual(['a1']);
  });
});

describe('favourite first when close by (ride step 3, s4)', () => {
  it('a favourite free within 2 km gets the ride first, alone, then the normal waves', async () => {
    const h = dispatchHarness();
    riders(h, { favourites: ['fav'] });
    await fleet(h, [
      ['a1', 0.2],
      ['fav', 1.8],
    ]);
    await ride(h);
    expect(h.trips.offers).toEqual([{ tripId: 't1', driverIds: ['fav'], timeoutSec: RIDE_HABIT_RULES.favourite.offerWindowSec }]);
    expect((await h.offers('t1'))[0]).toMatchObject({ policy: FAVOURITE_OFFER_POLICY, wave: 0 });
    expect(h.events.ofType('dispatch.wave_sent')[0]?.payload).toMatchObject({ favourite: true, auto: true, radiusKm: RIDE_HABIT_RULES.favourite.autoFirstKm });
    await h.advance(RIDE_HABIT_RULES.favourite.offerWindowSec);
    expect(h.trips.offers[1]?.driverIds).toEqual(['a1']);
  });

  it('a favourite further than 2 km waits his turn in the waves', async () => {
    const h = dispatchHarness();
    riders(h, { favourites: ['fav'] });
    await fleet(h, [
      ['a1', 0.2],
      ['fav', 2.5],
    ]);
    await ride(h);
    expect(h.trips.offers[0]?.driverIds).toEqual(['a1']);
  });

  it('the nearest of two close favourites is the one asked', async () => {
    const h = dispatchHarness();
    riders(h, { favourites: ['fav_far', 'fav_near'] });
    await fleet(h, [
      ['fav_far', 1.5],
      ['fav_near', 0.3],
    ]);
    await ride(h);
    expect(h.trips.offers[0]?.driverIds).toEqual(['fav_near']);
  });

  it('a favourite he also avoids is never asked', async () => {
    const h = dispatchHarness();
    riders(h, { favourites: ['fav'], avoided: ['fav'] });
    await fleet(h, [
      ['a1', 0.2],
      ['fav', 0.4],
    ]);
    await ride(h);
    expect(h.trips.offeredTo('t1')).toEqual(['a1']);
  });
});

describe('«عوائل» (ride step 3, s6)', () => {
  async function familyCity(h: H) {
    riders(h, {
      standing: {
        fam: { rating: 4.9, days: 200 },
        fam_new: { rating: 4.9, days: 30 },
        fam_low: { rating: 4.5, days: 400 },
        plain: { rating: 5, days: 400 },
      },
    });
    for (const id of ['fam', 'fam_new', 'fam_low']) h.facts.register(id, { vehicleClass: 'car', confirmedFeatures: ['family'] });
    await fleet(h, [
      ['plain', 0.1],
      ['fam_new', 0.2],
      ['fam_low', 0.3],
      ['fam', 0.9],
    ]);
  }

  it('the first wave goes only to family-tagged, long-standing, well-rated drivers', async () => {
    const h = dispatchHarness();
    await familyCity(h);
    await ride(h, { familyPreferred: true });
    expect(h.trips.offers[0]?.driverIds).toEqual(['fam']);
  });

  it('from the second wave everyone is asked as usual', async () => {
    const h = dispatchHarness();
    await familyCity(h);
    await ride(h, { familyPreferred: true });
    await h.advance(15);
    expect(h.trips.offers[1]?.driverIds).toEqual(expect.arrayContaining(['plain', 'fam_new', 'fam_low']));
  });

  it('with nobody family-fit free, the first wave is the normal one', async () => {
    const h = dispatchHarness();
    riders(h);
    await fleet(h, [
      ['plain', 0.1],
      ['other', 0.2],
    ]);
    await ride(h, { familyPreferred: true });
    expect(h.trips.offers[0]?.driverIds).toEqual(['plain', 'other']);
  });

  it('a claimed but unconfirmed tag does not count', async () => {
    const h = dispatchHarness();
    riders(h, { standing: { fam: { rating: 4.9, days: 200 } } });
    h.facts.register('fam', { vehicleClass: 'car', confirmedFeatures: [] });
    await fleet(h, [
      ['plain', 0.1],
      ['fam', 0.2],
    ]);
    await ride(h, { familyPreferred: true });
    expect(h.trips.offers[0]?.driverIds).toEqual(['plain', 'fam']);
  });
});

describe('the weather (ride step 3, n6)', () => {
  // 14 July 2026, 14:00 Baghdad: a hot afternoon.
  const SUMMER = '2026-07-14T11:00:00Z';
  // 14 January 2026, 10:00 Baghdad: a cold day.
  const WINTER = '2026-01-14T07:00:00Z';

  async function cars(h: H) {
    h.facts.register('ac', { vehicleClass: 'car', confirmedFeatures: ['ac'] });
    h.facts.register('heat', { vehicleClass: 'car', confirmedFeatures: ['heating'] });
    await fleet(h, [
      ['near', 0.1],
      ['near2', 0.2],
      ['near3', 0.3],
      ['ac', 1.2],
      ['heat', 1.3],
    ]);
  }

  it('on a hot day cars with confirmed AC are offered the ride first', async () => {
    const h = dispatchHarness(SUMMER);
    await cars(h);
    await ride(h);
    expect(h.trips.offers[0]?.driverIds).toEqual(['ac', 'near', 'near2']);
  });

  it('on a cold day cars with confirmed heating are', async () => {
    const h = dispatchHarness(WINTER);
    await cars(h);
    await ride(h);
    expect(h.trips.offers[0]?.driverIds).toEqual(['heat', 'near', 'near2']);
  });

  it('on a mild day the ranking alone decides', async () => {
    const h = dispatchHarness();
    await cars(h);
    await ride(h);
    expect(h.trips.offers[0]?.driverIds).toEqual(['near', 'near2', 'near3']);
  });

  it('food is never reordered by the weather', async () => {
    const h = dispatchHarness(SUMMER);
    h.facts.register('ac_bike', { vehicleClass: 'bike', confirmedFeatures: ['ac'] });
    await h.online('bike1', 0.1, { vehicle: 'bike' });
    await h.online('ac_bike', 1, { vehicle: 'bike' });
    await h.service.request({ tripId: 'f1', cityId: 'aziziyah', vertical: 'food', zoneId: 'centre', pickup: north(0) });
    expect(h.trips.offers[0]?.driverIds).toEqual(['bike1']);
  });
});

describe('«نبّهه» (ride step 3, n4)', () => {
  async function searching(h: H) {
    riders(h);
    await fleet(h, [
      ['a1', 0.2],
      ['a2', 0.5],
    ]);
    await ride(h);
    return (await h.offers('t1')).map((o) => o.id);
  }

  it('marks the offer, tells the driver once, and refuses a second nudge', async () => {
    const h = dispatchHarness();
    const [o1] = await searching(h);
    const at = await h.service.nudgeOffer('t1', o1!, 'c1');
    expect(at).toEqual(h.clock.now());
    expect((await h.repo.getOffer(o1!))?.nudgedAt).toEqual(at);
    expect(h.events.ofType('dispatch.offer_nudged')).toHaveLength(1);
    expect(h.events.ofType('dispatch.offer_nudged')[0]).toMatchObject({ actorId: 'c1', payload: { offerId: o1, driverId: 'a1', vertical: 'taxi' } });
    expect(NUDGE_RULES.perDriver).toBe(1);
    expect(await code(h.service.nudgeOffer('t1', o1!, 'c1'))).toBe('nudge_already');
  });

  it('counts per driver: a nudged driver offered again in the re-broadcast is not nudged twice', async () => {
    const h = dispatchHarness();
    const [o1] = await searching(h);
    await h.service.nudgeOffer('t1', o1!, 'c1');
    await h.advance(60);
    const again = (await h.offers('t1')).filter((o) => o.driverId === 'a1' && o.id !== o1);
    expect(again.length).toBeGreaterThan(0);
    expect(await code(h.service.nudgeOffer('t1', again.at(-1)!.id, 'c1'))).toBe('nudge_already');
  });

  it('refuses a declined or expired offer and an offer of another ride', async () => {
    const h = dispatchHarness();
    const [o1, o2] = await searching(h);
    await h.service.respond(h.actor('a2'), { offerId: o2!, accept: false });
    expect(await code(h.service.nudgeOffer('t1', o2!, 'c1'))).toBe('nudge_offer_closed');
    await h.advance(15);
    expect(await code(h.service.nudgeOffer('t1', o1!, 'c1'))).toBe('nudge_offer_closed');
    expect(await code(h.service.nudgeOffer('t1', 'do_999', 'c1'))).toBe('nudge_offer_closed');
  });

  it('refuses once the ride has its driver', async () => {
    const h = dispatchHarness();
    const [o1, o2] = await searching(h);
    await h.service.respond(h.actor('a1'), { offerId: o1!, accept: true });
    expect(await h.service.searchOf('t1')).toBeNull();
    expect(await code(h.service.nudgeOffer('t1', o2!, 'c1'))).toBe('ride_not_searching');
  });

  it('the search lists every offer while it looks for a driver', async () => {
    const h = dispatchHarness();
    await searching(h);
    const search = await h.service.searchOf('t1');
    expect(search?.offers.map((o) => o.driverId)).toEqual(['a1', 'a2']);
    expect(search?.request.pickup).toEqual(north(0));
  });
});

describe('the ride request carries the rider (ride step 3)', () => {
  it('order.placed gives dispatch the orderer and «عوائل»', async () => {
    const h = dispatchHarness();
    riders(h, { avoided: ['a1'] });
    await fleet(h, [
      ['a1', 0.2],
      ['a2', 0.4],
    ]);
    const subs = new DispatchSubscribers(h.orchestrator, h.trips, h.zones);
    await subs.onRidePlaced({
      orderId: 'o1',
      aggregateId: 'o1',
      actorId: 'c1',
      payload: { type: 'ride', cityId: 'aziziyah', paymentMethod: 'cash', totalIqd: 3000, ride: { vertical: 'taxi', pickup: { zoneKey: 'centre', pin: north(0) }, dropoff: null, quoteId: null, familyPreferred: true } },
    });
    const r = await h.service.getRequest('trip-o1');
    expect(r).toMatchObject({ riderId: 'c1', familyPreferred: true, avoidDriverIds: ['a1'] });
    expect(h.trips.offeredTo('trip-o1')).toEqual(['a2']);
  });
});
