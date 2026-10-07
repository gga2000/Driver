import { describe, expect, it } from 'vitest';
import { DriverError, MyRideOffers, DriverProfile, type Actor, type LatLng } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import type { DriverFacts, HabitsEventsPort, HabitsPeoplePort, HabitsRajaaPort, HabitsRidesPort, HabitsSearchPort, SearchOffer } from './ports.js';
import { InMemoryRideHabitsRepository } from './ride-habits.repository.js';
import { RideHabitsService } from './ride-habits.service.js';
import { RiderDriversService, rideOfferState } from './rider-drivers.service.js';

const START = '2026-10-07T15:00:00Z';
const ME: Actor = { personId: 'c1', sessionId: 's1' } as Actor;
const RIDER: Actor = { personId: 'c_mum', sessionId: 's2' } as Actor;
const STRANGER: Actor = { personId: 'c9', sessionId: 's9' } as Actor;
const PICKUP: LatLng = { lat: 32.91, lng: 45.06 };

const code = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DriverError);
  return (e as DriverError).code;
};

function setup() {
  const clock = new FakeClock(START);
  const now = () => clock.now();
  const sec = (s: number) => new Date(now().getTime() + s * 1000);
  const repo = new InMemoryRideHabitsRepository();
  const offer = (id: string, driverId: string, over: Partial<SearchOffer> = {}): SearchOffer => ({ offerId: id, driverId, state: 'sent', sentAt: sec(-5), expiresAt: sec(10), nudgedAt: null, ...over });
  const state = {
    searching: true,
    offers: [offer('o1', 'd_abbas'), offer('o2', 'd_omar', { state: 'seen' }), offer('o3', 'd_ali', { state: 'declined' })] as SearchOffer[],
    assigned: null as { driverId: string; vertical: 'taxi' | 'tuktuk'; plate: string | null; vehicleClass: 'car' | null } | null,
    minutes: { d_abbas: 6, d_omar: 3 } as Record<string, number | null>,
  };
  const nudges: Array<{ tripId: string; offerId: string; riderId: string }> = [];
  const vaultReads: Array<{ ids: readonly string[]; reader: string; purpose: string }> = [];
  const facts: Record<string, DriverFacts> = {
    d_abbas: { vehicleClass: 'car', model: 'Toyota Corolla', colour: 'white', features: ['ac', 'family'], tripCount: 412 },
    d_omar: { vehicleClass: null, model: null, colour: null, features: [], tripCount: 3 },
  };
  const search: HabitsSearchPort = {
    ride: async (orderId) => (orderId === 'r1' ? { orderId, ordererId: 'c1', riderIds: ['c_mum'] } : null),
    search: async (orderId) => (orderId === 'r1' && state.searching ? { tripId: 'trip-r1', vertical: 'taxi', pickup: PICKUP, offers: state.offers } : null),
    nudge: async (tripId, offerId, riderId) => {
      nudges.push({ tripId, offerId, riderId });
      return now();
    },
    minutesAway: async (id) => state.minutes[id] ?? null,
    facts: async (ids) => new Map(ids.flatMap((id) => (facts[id] ? [[id, facts[id]!] as const] : []))),
    assigned: async (orderId) => (orderId === 'r1' ? state.assigned : null),
    cards: async (ids, reader, purpose) => {
      vaultReads.push({ ids, reader, purpose });
      return Object.fromEntries(ids.map((id) => [id, { firstName: id === 'd_abbas' ? 'عباس' : id === 'd_omar' ? 'عمر' : null, photoRef: id === 'd_abbas' ? 'ph/abbas' : null }]));
    },
    photoUrl: (ref) => `/files/${ref}?sig=1`,
    record: async () => ({ driverSince: new Date('2025-03-01T00:00:00Z'), onTimePct: 94, compliments: [{ key: 'polite', count: 9 }, { key: 'clean_car', count: 5 }, { key: 'smooth_ride', count: 4 }, { key: 'fast', count: 2 }, { key: 'found_home', count: 1 }] }),
    driverSince: async () => ({}),
  };
  const rides = {
    driverRating: async (id: string) => (id === 'd_abbas' ? { rating: 4.8, count: 37 } : null),
    finishedRide: async (personId: string, orderId: string) => (personId === 'c1' && orderId === 'r_done' ? { orderId, driverId: 'd_abbas', vertical: 'taxi' as const, stars: 5, finishedAt: now() } : null),
    finishedRides: async () => [],
  } as unknown as HabitsRidesPort;
  const rajaa = { bookings: async () => [] } as unknown as HabitsRajaaPort;
  const people = { firstNames: async () => ({}), photoUrls: async () => ({}) } as unknown as HabitsPeoplePort;
  const drivers = new RiderDriversService(search, rides, repo, clock);
  const habits = new RideHabitsService(repo, rides, rajaa, people, {} as HabitsEventsPort, clock, drivers);
  return { clock, repo, state, nudges, vaultReads, drivers, habits, offer, sec };
}

describe('the drivers my ride was sent to (ride step 3, n3)', () => {
  it('shows first name, photo, rating, car and minutes away — open offers nearest first, never a position', async () => {
    const s = setup();
    await s.repo.addFavourite('c1', 'd_omar', 'taxi', s.clock.now());
    const out = MyRideOffers.parse(await s.habits.myRideOffers(ME, { orderId: 'r1' }));
    expect(out.offers.map((o) => [o.offerId, o.state, o.minutesAway])).toEqual([
      ['o2', 'seen', 3],
      ['o1', 'sent', 6],
      ['o3', 'declined', null],
    ]);
    expect(out.offers[1]).toEqual({
      offerId: 'o1',
      firstName: 'عباس',
      photoUrl: '/files/ph/abbas?sig=1',
      rating: 4.8,
      ratingCount: 37,
      tripCount: 412,
      vehicleClass: 'car',
      vehicleModel: 'Toyota Corolla',
      vehicleColour: 'white',
      features: ['ac', 'family'],
      minutesAway: 6,
      state: 'sent',
      nudgedAt: null,
      favourite: false,
    });
    expect(out.offers[0]).toMatchObject({ firstName: 'عمر', photoUrl: null, rating: null, vehicleClass: 'car', favourite: true });
    expect(JSON.stringify(out)).not.toMatch(/lat|lng|phone|driverId/);
  });

  it('one card per driver (his latest offer), a nudge on any of them stands; accepted ones never show', async () => {
    const s = setup();
    const nudgedAt = s.sec(-20);
    s.state.offers = [
      s.offer('o1', 'd_abbas', { state: 'timed_out', sentAt: s.sec(-40), nudgedAt }),
      s.offer('o4', 'd_abbas', { sentAt: s.sec(-2) }),
      s.offer('o5', 'd_omar', { state: 'accepted' }),
    ];
    const out = await s.habits.myRideOffers(ME, { orderId: 'r1' });
    expect(out.offers.map((o) => [o.offerId, o.state, o.nudgedAt])).toEqual([['o4', 'sent', nudgedAt]]);
  });

  it('an open offer past its time reads expired, withdrawn too', () => {
    const now = new Date(START);
    expect(rideOfferState({ state: 'sent', expiresAt: new Date(now.getTime() - 1) }, now)).toBe('expired');
    expect(rideOfferState({ state: 'withdrawn', expiresAt: new Date(now.getTime() + 1000) }, now)).toBe('expired');
    expect(rideOfferState({ state: 'accepted', expiresAt: now }, now)).toBeNull();
  });

  it('reads each driver from the vault once per search, not once per poll, as the courier card does', async () => {
    const s = setup();
    await s.habits.myRideOffers(ME, { orderId: 'r1' });
    await s.habits.myRideOffers(ME, { orderId: 'r1' });
    expect(s.vaultReads).toEqual([{ ids: ['d_abbas', 'd_omar', 'd_ali'], reader: 'c1', purpose: 'courier_card' }]);
  });

  it('the rider of a ride booked for him may look; nobody else, and only while it searches', async () => {
    const s = setup();
    expect((await s.habits.myRideOffers(RIDER, { orderId: 'r1' })).offers).toHaveLength(3);
    expect(await code(s.habits.myRideOffers(STRANGER, { orderId: 'r1' }))).toBe('forbidden');
    expect(await code(s.habits.myRideOffers(ME, { orderId: 'food1' }))).toBe('not_found');
    s.state.searching = false;
    expect(await code(s.habits.myRideOffers(ME, { orderId: 'r1' }))).toBe('ride_not_searching');
  });
});

describe('«نبّهه» (ride step 3, n4)', () => {
  it('goes to dispatch for a driver this ride was sent to, as the rider', async () => {
    const s = setup();
    expect(await s.habits.nudgeOffer(ME, { orderId: 'r1', offerId: 'o1' })).toEqual({ nudgedAt: s.clock.now() });
    expect(s.nudges).toEqual([{ tripId: 'trip-r1', offerId: 'o1', riderId: 'c1' }]);
  });

  it('refuses a driver not offered this ride, a stranger and a ride no longer searching', async () => {
    const s = setup();
    expect(await code(s.habits.nudgeOffer(ME, { orderId: 'r1', offerId: 'o_other_ride' }))).toBe('nudge_offer_closed');
    expect(await code(s.habits.nudgeOffer(STRANGER, { orderId: 'r1', offerId: 'o1' }))).toBe('forbidden');
    s.state.searching = false;
    expect(await code(s.habits.nudgeOffer(ME, { orderId: 'r1', offerId: 'o1' }))).toBe('ride_not_searching');
    expect(s.nudges).toEqual([]);
  });
});

describe('the driver profile (ride step 3, n5)', () => {
  it('an offered driver while the ride searches: no plate', async () => {
    const s = setup();
    const p = DriverProfile.parse(await s.habits.driverProfile(ME, { orderId: 'r1', offerId: 'o1' }));
    expect(p).toEqual({
      firstName: 'عباس',
      photoUrl: '/files/ph/abbas?sig=1',
      rating: 4.8,
      ratingCount: 37,
      tripCount: 412,
      onTimePct: 94,
      memberSince: new Date('2025-03-01T00:00:00Z'),
      vehicleClass: 'car',
      vehicleModel: 'Toyota Corolla',
      vehicleColour: 'white',
      plate: null,
      features: ['ac', 'family'],
      compliments: [
        { key: 'polite', count: 9 },
        { key: 'clean_car', count: 5 },
        { key: 'smooth_ride', count: 4 },
        { key: 'fast', count: 2 },
      ],
    });
  });

  it('the assigned driver any time, with his plate', async () => {
    const s = setup();
    s.state.searching = false;
    s.state.assigned = { driverId: 'd_abbas', vertical: 'taxi', plate: '12345 واسط', vehicleClass: 'car' };
    expect(await s.habits.driverProfile(RIDER, { orderId: 'r1' })).toMatchObject({ firstName: 'عباس', plate: '12345 واسط' });
  });

  it('refuses an offer of the ride once it stopped searching, an unknown offer and a ride with no driver', async () => {
    const s = setup();
    expect(await code(s.habits.driverProfile(ME, { orderId: 'r1', offerId: 'nope' }))).toBe('not_found');
    expect(await code(s.habits.driverProfile(ME, { orderId: 'r1' }))).toBe('not_found');
    expect(await code(s.habits.driverProfile(STRANGER, { orderId: 'r1', offerId: 'o1' }))).toBe('forbidden');
    s.state.searching = false;
    expect(await code(s.habits.driverProfile(ME, { orderId: 'r1', offerId: 'o1' }))).toBe('ride_not_searching');
  });
});

describe('«ما أريده مرة ثانية» (ride step 3, s5)', () => {
  it('keeps the ride’s driver off my rides, drops him as a favourite, and can be undone', async () => {
    const s = setup();
    s.state.assigned = { driverId: 'd_abbas', vertical: 'taxi', plate: null, vehicleClass: 'car' };
    await s.repo.addFavourite('c1', 'd_abbas', 'taxi', s.clock.now());
    const list = await s.habits.avoid(ME, { orderId: 'r1' });
    expect(list).toEqual([{ id: expect.any(String), firstName: 'عباس', photoUrl: '/files/ph/abbas?sig=1', since: s.clock.now() }]);
    expect(s.vaultReads.at(-1)).toMatchObject({ purpose: 'avoided_driver', reader: 'c1' });
    expect(await s.repo.favouritesOf('c1')).toEqual([]);
    expect(await s.drivers.avoidedDriverIds('c1')).toEqual(['d_abbas']);
    // Twice is the same row.
    expect(await s.habits.avoid(ME, { orderId: 'r1' })).toHaveLength(1);
    expect(await s.habits.unavoid(ME, { avoidId: list[0]!.id })).toEqual([]);
    expect(await s.drivers.avoidedDriverIds('c1')).toEqual([]);
  });

  it('refuses a ride with no driver, someone else’s ride and an unknown row', async () => {
    const s = setup();
    expect(await code(s.habits.avoid(ME, { orderId: 'r1' }))).toBe('not_found');
    s.state.assigned = { driverId: 'd_abbas', vertical: 'taxi', plate: null, vehicleClass: 'car' };
    expect(await code(s.habits.avoid(STRANGER, { orderId: 'r1' }))).toBe('forbidden');
    expect(await code(s.habits.unavoid(ME, { avoidId: 'avd_nope' }))).toBe('avoid_not_found');
    expect(await s.habits.avoided(STRANGER)).toEqual([]);
  });

  it('hearting a driver I avoided takes him off the list', async () => {
    const s = setup();
    s.state.assigned = { driverId: 'd_abbas', vertical: 'taxi', plate: null, vehicleClass: 'car' };
    await s.habits.avoid(ME, { orderId: 'r1' });
    expect(await s.habits.favourite(ME, { orderId: 'r_done', on: true })).toHaveLength(1);
    expect(await s.drivers.avoidedDriverIds('c1')).toEqual([]);
  });
});
