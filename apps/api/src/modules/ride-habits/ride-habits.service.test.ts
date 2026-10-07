import { describe, expect, it } from 'vitest';
import { DriverError, type Actor, type BookingView, type DepartureCard, type IntercityBoard, type Order, type PlaceOrderInput, type RideFootprint, type SavedPlaceView } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import type { BookedRidePlan, FinishedRide, HabitsEventsPort, HabitsPeoplePort, HabitsRajaaPort, HabitsRidesPort, RideInProgress } from './ports.js';
import { InMemoryRideHabitsRepository } from './ride-habits.repository.js';
import { REGULAR_TRIP_DUE_EVENT, RideHabitsService, SAME_RIDE_DUE_EVENT } from './ride-habits.service.js';

// Wednesday 7 Oct 2026, 18:00 Baghdad.
const START = '2026-10-07T15:00:00Z';
const ME: Actor = { personId: 'c1', sessionId: 's1' } as Actor;
const HOME_PIN = { lat: 32.91, lng: 45.06 };
const WORK_PIN = { lat: 32.92, lng: 45.07 };
const RIDE_PLAN = {
  kind: 'ride' as const,
  rideVertical: 'taxi' as const,
  pickup: { zoneKey: 'centre', pin: HOME_PIN, placeId: 'pl_home', label: 'البيت' },
  dropoff: { zoneKey: 'street_30', pin: WORK_PIN, label: 'الدائرة' },
  doorPickup: false,
};
const RAJAA_PLAN = { kind: 'rajaa' as const, corridorId: 'aziziyah_kut', direction: 'from_aziziyah' as const, garageId: 'mp_garage_bab1', travellingAs: 'rijal' as const };

const code = async (p: Promise<unknown>) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(DriverError);
  return (e as DriverError).code;
};

function booking(over: Partial<BookingView> & { id: string }): BookingView {
  return {
    departureId: 'dep1',
    riderId: 'c1',
    state: 'completed',
    origin: 'rider',
    seatIds: ['back_left'],
    travellingAs: 'rijal',
    seatPriceIqd: 5000,
    frontPremiumIqd: 0,
    pickupFeeIqd: 0,
    totalIqd: 5000,
    payment: null,
    prepaid: false,
    prepayRail: null,
    heldUntil: null,
    pin: null,
    pickup: { kind: 'garage' },
    largeBags: false,
    movedToBookingId: null,
    movedFromBookingId: null,
    checkedInAt: null,
    lateMinutes: null,
    departure: { id: 'dep1', corridorId: 'aziziyah_kut', direction: 'to_aziziyah', garageId: 'mp_garage_kut', departAt: new Date('2026-10-07T12:00:00Z'), latestDepartureAt: new Date('2026-10-07T12:30:00Z'), state: 'arrived', vehicle: { kind: 'sedan', layout: 'sedan_4', plate: '1', model: null, color: null }, driverId: 'd_haidar' },
    createdAt: new Date('2026-10-06T10:00:00Z'),
    completedAt: new Date('2026-10-07T13:30:00Z'),
    rating: { stars: 5, tags: [], at: new Date('2026-10-07T13:40:00Z') },
    pointsEarned: null,
    ...over,
  } as BookingView;
}

function card(id: string, driverId: string, departAt: string): DepartureCard {
  return {
    id,
    corridorId: 'aziziyah_kut',
    direction: 'from_aziziyah',
    garageId: 'mp_garage_bab1',
    fromCityId: 'aziziyah',
    toCityId: 'kut',
    driverId,
    vehicle: { kind: 'sedan', layout: 'sedan_4', plate: '1', model: null, color: null },
    departAt: new Date(departAt),
    latestDepartureAt: new Date(departAt),
    state: 'scheduled',
    familyOnly: false,
    seatPriceIqd: 5000,
    frontPremiumIqd: 2000,
    seats: [
      { id: 'front', state: 'free', premiumIqd: 2000, blocked: null },
      { id: 'back_left', state: 'free', premiumIqd: 0, blocked: null },
    ],
    fill: { seatsTotal: 4, booked: 0, held: 0, walkUps: 0, walkUpsCounted: 0 },
    frontSeat: 'free',
    doorPickupsLeft: 2,
    meetingPoints: [],
  } as unknown as DepartureCard;
}

function setup() {
  const clock = new FakeClock(START);
  const repo = new InMemoryRideHabitsRepository();
  const rides: FinishedRide[] = [
    { orderId: 'r_good', driverId: 'd_abbas', vertical: 'taxi', stars: 5, finishedAt: new Date('2026-10-07T14:00:00Z') },
    { orderId: 'r_meh', driverId: 'd_omar', vertical: 'tuktuk', stars: 3, finishedAt: new Date('2026-10-07T11:00:00Z') },
    { orderId: 'r_old', driverId: 'd_abbas', vertical: 'taxi', stars: 4, finishedAt: new Date('2026-10-01T11:00:00Z') },
  ];
  const placed: Array<{ personId: string; input: PlaceOrderInput }> = [];
  const held: unknown[] = [];
  const demands: unknown[] = [];
  const emitted: Array<{ type: string; payload: Record<string, unknown>; idempotencyKey?: string }> = [];
  const state = { inProgress: null as RideInProgress | null, bookings: [booking({ id: 'bk_done' })], board: [] as DepartureCard[], fare: 3000, unfinished: new Set<string>(), rideOn: false, orders: [] as Order[], bookedPlan: null as BookedRidePlan | null, purposes: [] as Array<string | undefined> };
  const ridesPort: HabitsRidesPort = {
    finishedRides: async (personId, from) => (personId === 'c1' ? rides.filter((r) => r.finishedAt >= from) : []),
    finishedRide: async (personId, orderId) => (personId === 'c1' ? (rides.find((r) => r.orderId === orderId) ?? null) : null),
    fare: (i) => ({ fareIqd: state.fare + (i.doorPickup ? 500 : 0), quoteId: `q_${i.at.toISOString()}` }),
    place: async (personId, input) => {
      if (input.fareIqd !== undefined && input.fareIqd !== state.fare) throw new DriverError('price_changed');
      const prior = placed.findIndex((p) => p.input.clientRequestId === input.clientRequestId);
      if (prior < 0) placed.push({ personId, input });
      return { id: `ord_${prior < 0 ? placed.length : prior + 1}` } as Order;
    },
    order: async (id) => state.orders.find((o) => o.id === id) ?? null,
    rideInProgress: async () => state.inProgress,
    kitchen: async (id) => (id === 'm_khalid' ? { prepMin: 25, leadMin: 10, pin: { lat: 32.9, lng: 45.05 } } : null),
    minutes: async () => 8,
    driverRating: async (id) => (id === 'd_abbas' ? { rating: 4.8, count: 12 } : null),
    finishedOrderIds: async (ids) => new Set(ids.filter((id) => !state.unfinished.has(id))),
    rideOn: async () => state.rideOn,
    bookedRide: async () => state.bookedPlan,
  };
  const rajaa: HabitsRajaaPort = {
    bookings: async () => state.bookings,
    board: async () => ({ departures: state.board }) as unknown as IntercityBoard,
    holdAndBook: async (_a, i) => {
      held.push(i);
      return booking({ id: 'bk_new', state: 'booked' });
    },
    postDemand: async (_a, i) => {
      demands.push(i);
      return { id: 'dm_1' } as Awaited<ReturnType<HabitsRajaaPort['postDemand']>>;
    },
    departedAt: async () => null,
    travelMin: () => 60,
    aziziyahGarages: () => [{ lat: 32.903, lng: 45.058 }],
    routeAr: (_c, d) => (d === 'to_aziziyah' ? 'الكوت ← العزيزية' : 'العزيزية ← الكوت'),
  };
  const people: HabitsPeoplePort = {
    firstNames: async (ids, _accessor, purpose) => {
      state.purposes.push(purpose);
      return Object.fromEntries(ids.map((id) => [id, id === 'd_abbas' ? 'عباس' : id === 'd_haidar' ? 'حيدر' : null]));
    },
    photoUrls: async (ids) => Object.fromEntries(ids.filter((id) => id === 'd_abbas').map((id) => [id, `/files/${id}.jpg`])),
    places: async () => [{ id: 'pl_home', label: 'home', name: 'البيت', pin: HOME_PIN } as SavedPlaceView],
  };
  const events: HabitsEventsPort = {
    emit: async (e) => {
      emitted.push({ type: e.type, payload: e.payload as Record<string, unknown>, ...(e.idempotencyKey ? { idempotencyKey: e.idempotencyKey } : {}) });
    },
  };
  const svc = new RideHabitsService(repo, ridesPort, rajaa, people, events, clock);
  return { clock, repo, svc, placed, held, demands, emitted, state };
}

describe('favourite drivers (l9)', () => {
  it('hearts the driver of my ride rated 5, with his first name, photo and trips together', async () => {
    const { svc } = setup();
    const list = await svc.favourite(ME, { orderId: 'r_good', on: true });
    expect(list).toEqual([expect.objectContaining({ driverId: 'd_abbas', firstName: 'عباس', photoUrl: '/files/d_abbas.jpg', kinds: ['taxi'], rating: 4.8, ratingCount: 12, tripsTogether: 2 })]);
  });

  it('refuses a ride rated 3, and a ride that is not mine', async () => {
    const { svc } = setup();
    expect(await code(svc.favourite(ME, { orderId: 'r_meh', on: true }))).toBe('favourite_needs_good_rating');
    expect(await code(svc.favourite(ME, { orderId: 'someone_elses', on: true }))).toBe('not_found');
  });

  it('hearts a الرجعة driver from a completed trip rated 5; un-hearts', async () => {
    const { svc } = setup();
    const list = await svc.favourite(ME, { bookingId: 'bk_done', on: true });
    expect(list[0]).toMatchObject({ driverId: 'd_haidar', kinds: ['intercity'], tripsTogether: 1 });
    expect(await svc.unfavourite(ME, { favouriteId: list[0]!.id })).toEqual([]);
    expect(await code(svc.unfavourite(ME, { favouriteId: list[0]!.id }))).toBe('favourite_not_found');
  });

  it('caps at 20', async () => {
    const { svc, repo, clock } = setup();
    for (let i = 0; i < 20; i += 1) await repo.addFavourite('c1', `d_${i}`, 'taxi', clock.now());
    expect(await code(svc.favourite(ME, { orderId: 'r_good', on: true }))).toBe('favourite_limit');
  });

  it('suggests the last good driver of the day until he is a favourite', async () => {
    const { svc } = setup();
    expect(await svc.recentGood(ME)).toMatchObject({ orderId: 'r_good', firstName: 'عباس', kind: 'taxi', stars: 5 });
    await svc.favourite(ME, { orderId: 'r_good', on: true });
    expect(await svc.recentGood(ME)).toMatchObject({ bookingId: 'bk_done', firstName: 'حيدر', kind: 'intercity' });
  });

  it('tells orders who a favourite is, only for its owner', async () => {
    const { svc } = setup();
    const [fav] = await svc.favourite(ME, { orderId: 'r_good', on: true });
    expect(await svc.driverFor('c1', fav!.id)).toBe('d_abbas');
    expect(await svc.driverFor('c2', fav!.id)).toBeNull();
  });
});

describe('regular trips (r5)', () => {
  const work = { days: [0, 1, 2, 3, 4], timeMin: 7 * 60 + 30, remind: 'evening' as const, paymentMethod: 'cash' as const, favouriteId: null, active: true, plan: RIDE_PLAN };

  it('saves a trip and shows tomorrow as the next one', async () => {
    const { svc } = setup();
    const t = await svc.regularSave(ME, work);
    expect(t.next).toMatchObject({ date: '2026-10-08', state: 'waiting' });
    expect(await svc.regularList(ME)).toHaveLength(1);
  });

  it('caps at 10 and checks the favourite is mine', async () => {
    const { svc } = setup();
    for (let i = 0; i < 10; i += 1) await svc.regularSave(ME, work);
    expect(await code(svc.regularSave(ME, work))).toBe('regular_trip_limit');
    const other = setup();
    expect(await code(other.svc.regularSave(ME, { ...work, favouriteId: 'fav_nope' }))).toBe('favourite_not_found');
  });

  it('quotes the fare at the trip time and books only on «أكدها», with the favourite', async () => {
    const { svc, placed } = setup();
    const [fav] = await svc.favourite(ME, { orderId: 'r_good', on: true });
    const t = await svc.regularSave(ME, { ...work, favouriteId: fav!.id });
    const occ = await svc.occurrence(ME, { id: t.id, date: '2026-10-08' });
    expect(occ.ride).toEqual({ fareIqd: 3000, quoteId: 'q_2026-10-08T04:30:00.000Z' });
    expect(placed).toHaveLength(0);
    const done = await svc.confirm(ME, { id: t.id, date: '2026-10-08', fareIqd: 3000, clientRequestId: 'rgt-confirm-1' });
    expect(done.occurrence).toMatchObject({ state: 'confirmed', orderId: 'ord_1' });
    expect(placed[0]?.input).toMatchObject({ type: 'ride', scheduledFor: new Date('2026-10-08T04:30:00Z'), favouriteId: fav!.id, fareIqd: 3000, paymentMethod: 'cash' });
    // A second tap answers with the same booking.
    expect((await svc.confirm(ME, { id: t.id, date: '2026-10-08', fareIqd: 3000, clientRequestId: 'rgt-confirm-1' })).occurrence.orderId).toBe('ord_1');
    expect(placed).toHaveLength(1);
  });

  it('a fare that moved is refused, nothing recorded', async () => {
    const { svc } = setup();
    const t = await svc.regularSave(ME, work);
    expect(await code(svc.confirm(ME, { id: t.id, date: '2026-10-08', fareIqd: 2500, clientRequestId: 'rgt-confirm-2' }))).toBe('price_changed');
    expect((await svc.occurrence(ME, { id: t.id, date: '2026-10-08' })).occurrence.state).toBe('waiting');
  });

  it('too close to confirm, or not one of its days', async () => {
    const { svc, clock } = setup();
    const t = await svc.regularSave(ME, work);
    clock.set(new Date('2026-10-08T04:15:00Z'));
    expect(await code(svc.confirm(ME, { id: t.id, date: '2026-10-08', fareIqd: 3000, clientRequestId: 'rgt-confirm-3' }))).toBe('occurrence_closed');
    expect(await code(svc.occurrence(ME, { id: t.id, date: '2026-10-09' }))).toBe('invalid_input');
  });

  it('skips one day; the list moves on', async () => {
    const { svc } = setup();
    const t = await svc.regularSave(ME, work);
    expect((await svc.skip(ME, { id: t.id, date: '2026-10-08' })).occurrence.state).toBe('skipped');
    expect((await svc.regularList(ME))[0]?.next).toMatchObject({ date: '2026-10-08', state: 'skipped' });
  });

  it("someone else's trip is not found", async () => {
    const { svc } = setup();
    const t = await svc.regularSave(ME, work);
    expect(await code(svc.occurrence({ personId: 'c2', sessionId: 's' } as Actor, { id: t.id, date: '2026-10-08' }))).toBe('not_found');
  });

  it('الرجعة: lists that day\'s cars, the favourite\'s first, and books a plain seat on the chosen one', async () => {
    const { svc, state, held } = setup();
    const [fav] = await svc.favourite(ME, { bookingId: 'bk_done', on: true });
    state.board = [card('dep_a', 'd_x', '2026-10-08T05:00:00Z'), card('dep_b', 'd_haidar', '2026-10-08T06:00:00Z')];
    const t = await svc.regularSave(ME, { days: [4], timeMin: 8 * 60, remind: 'evening', paymentMethod: 'wallet', favouriteId: fav!.id, active: true, plan: RAJAA_PLAN });
    const occ = await svc.occurrence(ME, { id: t.id, date: '2026-10-08' });
    expect(occ.rajaa?.departures.map((d) => d.id)).toEqual(['dep_b', 'dep_a']);
    const done = await svc.confirm(ME, { id: t.id, date: '2026-10-08', departureId: 'dep_a', clientRequestId: 'rgt-confirm-4' });
    expect(held[0]).toEqual({ departureId: 'dep_a', seatId: 'back_left', travellingAs: 'rijal', payment: 'wallet' });
    expect(done.occurrence).toMatchObject({ state: 'confirmed', bookingId: 'bk_new' });
  });

  it('الرجعة with no car yet: «أريد أرجع» for the window', async () => {
    const { svc, demands } = setup();
    const t = await svc.regularSave(ME, { days: [4], timeMin: 8 * 60, remind: 'evening', paymentMethod: 'cash', favouriteId: null, active: true, plan: RAJAA_PLAN });
    const done = await svc.confirm(ME, { id: t.id, date: '2026-10-08', waitForCar: true, clientRequestId: 'rgt-confirm-5' });
    expect(demands[0]).toMatchObject({ corridorId: 'aziziyah_kut', direction: 'from_aziziyah', seats: 1, windowStart: new Date('2026-10-08T04:00:00Z'), windowEnd: new Date('2026-10-08T07:00:00Z') });
    expect(done.occurrence).toMatchObject({ state: 'confirmed', demandId: 'dm_1' });
  });

  it('the job reminds once at 20:00 the evening before, never for paused or decided trips', async () => {
    const { svc, clock, emitted } = setup();
    const t = await svc.regularSave(ME, work);
    await svc.regularSave(ME, { ...work, active: false });
    expect(await svc.remindDue()).toBe(0);
    clock.set(new Date('2026-10-07T17:00:00Z'));
    expect(await svc.remindDue()).toBe(1);
    expect(emitted[0]).toMatchObject({ type: REGULAR_TRIP_DUE_EVENT, idempotencyKey: `regular_trip.due:${t.id}:2026-10-08`, payload: { personId: 'c1', regularTripId: t.id, date: '2026-10-08', route: 'البيت ← الدائرة' } });
    await svc.skip(ME, { id: t.id, date: '2026-10-08' });
    expect(await svc.remindDue()).toBe(0);
  });
});

describe('«عشاك يوصل وياك» (r6)', () => {
  it('a ride home in progress: dinner arrives with him when the kitchen can make it', async () => {
    const { svc, state, clock } = setup();
    state.inProgress = { orderId: 'r_live', vertical: 'tuktuk', dropoff: { zoneKey: 'centre', pin: HOME_PIN, placeId: 'pl_home' }, arriveAt: new Date(clock.now().getTime() + 50 * 60_000) };
    const chance = await svc.dinnerChance(ME);
    expect(chance).toMatchObject({ source: { kind: 'ride', orderId: 'r_live' }, vehicle: 'tuktuk', place: { placeId: 'pl_home', label: 'home' } });
    const t = await svc.dinnerTime(ME, { source: { kind: 'ride', orderId: 'r_live' }, merchantOrgId: 'm_khalid' });
    expect(t).toMatchObject({ deliverAt: new Date('2026-10-07T15:50:00Z'), kitchenReadyAt: new Date('2026-10-07T15:40:00Z'), lateByMin: 0 });
  });

  it('a short ride: the kitchen needs longer, and says by how much', async () => {
    const { svc, state, clock } = setup();
    state.inProgress = { orderId: 'r_live', vertical: 'taxi', dropoff: { zoneKey: 'centre', pin: HOME_PIN, placeId: 'pl_home' }, arriveAt: new Date(clock.now().getTime() + 12 * 60_000) };
    const t = await svc.dinnerTime(ME, { source: { kind: 'ride', orderId: 'r_live' }, merchantOrgId: 'm_khalid' });
    expect(t).toMatchObject({ deliverAt: new Date('2026-10-07T15:35:00Z'), lateByMin: 23 });
  });

  it('no chance for a ride to a pin, or one arriving in more than 150 minutes', async () => {
    const { svc, state, clock } = setup();
    state.inProgress = { orderId: 'r_live', vertical: 'taxi', dropoff: { zoneKey: 'centre', pin: HOME_PIN }, arriveAt: new Date(clock.now().getTime() + 20 * 60_000) };
    expect(await svc.dinnerChance(ME)).toBeNull();
    state.inProgress = { orderId: 'r_live', vertical: 'taxi', dropoff: { zoneKey: 'centre', pin: HOME_PIN, placeId: 'pl_home' }, arriveAt: new Date(clock.now().getTime() + 151 * 60_000) };
    expect(await svc.dinnerChance(ME)).toBeNull();
    await expect(svc.dinnerTime(ME, { source: { kind: 'ride', orderId: 'r_live' }, merchantOrgId: 'm_khalid' })).rejects.toMatchObject({ code: 'dinner_not_available' });
  });

  it('الرجعة to Aziziyah: the car left + travel + garage → home', async () => {
    const { svc, state } = setup();
    state.bookings = [booking({ id: 'bk_live', state: 'checked_in', completedAt: null, rating: null, departure: { ...booking({ id: 'x' }).departure, state: 'boarding', departAt: new Date('2026-10-07T15:10:00Z') } })];
    expect(await svc.dinnerChance(ME)).toMatchObject({ source: { kind: 'rajaa', bookingId: 'bk_live' }, vehicle: 'intercity', arriveAt: new Date('2026-10-07T16:18:00Z') });
  });

  it('a seat leaving Aziziyah gets nothing', async () => {
    const { svc, state } = setup();
    state.bookings = [booking({ id: 'bk_out', state: 'booked', departure: { ...booking({ id: 'x' }).departure, direction: 'from_aziziyah', state: 'scheduled', departAt: new Date('2026-10-07T15:30:00Z') } })];
    expect(await svc.dinnerChance(ME)).toBeNull();
  });
});

describe('«نفس مشوار البارحة؟» (step 4, o4)', () => {
  // Thursday 8 Oct 2026: he took the taxi home → work at about 7:30 on Monday, Tuesday and Wednesday.
  const at = (iso: string) => new Date(iso);
  const ride = (orderId: string, when: string, over: Partial<RideFootprint> = {}): RideFootprint => ({
    orderId,
    vertical: 'taxi',
    doorPickup: true,
    pickup: { zoneKey: 'centre', pin: HOME_PIN, placeId: 'pl_home' },
    dropoff: { zoneKey: 'street_30', pin: WORK_PIN },
    at: at(when),
    ...over,
  });
  async function habit(rides: RideFootprint[]) {
    const h = setup();
    for (const r of rides) await h.svc.recordRide('c1', r);
    return h;
  }
  const WEEK = [ride('o_mon', '2026-10-05T04:25:00Z'), ride('o_tue', '2026-10-06T04:30:00Z'), ride('o_wed', '2026-10-07T04:40:00Z')];

  it('offers the same ride ten minutes before his usual time, once a day, with the link that fills choose', async () => {
    const h = await habit(WEEK);
    h.clock.set('2026-10-08T04:20:00Z'); // Thursday 7:20
    expect(await h.svc.sameRideDue()).toBe(1);
    expect(h.emitted).toEqual([
      {
        type: SAME_RIDE_DUE_EVENT,
        payload: {
          personId: 'c1',
          date: '2026-10-08',
          at: '2026-10-08T04:30:00.000Z',
          vertical: 'taxi',
          doorPickup: true,
          from: '32.910000,45.060000,centre,pl_home',
          to: '32.920000,45.070000,street_30',
          route: 'البيت ← شارع 30',
          afterWeekend: false,
        },
        idempotencyKey: 'same_ride.due:c1:2026-10-08',
      },
    ]);
  });

  it('only inside its window: 10 to 3 minutes before', async () => {
    const h = await habit(WEEK);
    h.clock.set('2026-10-08T04:19:00Z');
    expect(await h.svc.sameRideDue()).toBe(0);
    h.clock.set('2026-10-08T04:28:00Z');
    expect(await h.svc.sameRideDue()).toBe(0);
    h.clock.set('2026-10-08T04:27:00Z');
    expect(await h.svc.sameRideDue()).toBe(1);
  });

  it('needs 3 of the last 4 working days, yesterday included, and finished rides only', async () => {
    const twoDays = await habit(WEEK.slice(1));
    twoDays.clock.set('2026-10-08T04:20:00Z');
    expect(await twoDays.svc.sameRideDue()).toBe(0);

    const notYesterday = await habit([ride('o_thu', '2026-10-01T04:30:00Z'), ...WEEK.slice(0, 2)]);
    notYesterday.clock.set('2026-10-08T04:20:00Z');
    expect(await notYesterday.svc.sameRideDue()).toBe(0);

    const cancelled = await habit(WEEK);
    cancelled.state.unfinished.add('o_tue');
    cancelled.clock.set('2026-10-08T04:20:00Z');
    expect(await cancelled.svc.sameRideDue()).toBe(0);

    const elsewhere = await habit([...WEEK.slice(0, 2), ride('o_wed', '2026-10-07T04:40:00Z', { dropoff: { zoneKey: 'street_30', pin: { lat: 32.925, lng: 45.07 } } })]);
    elsewhere.clock.set('2026-10-08T04:20:00Z');
    expect(await elsewhere.svc.sameRideDue()).toBe(0);
  });

  it('stays quiet with a ride on, the ride already taken today, or a regular trip for it', async () => {
    const busy = await habit(WEEK);
    busy.state.rideOn = true;
    busy.clock.set('2026-10-08T04:20:00Z');
    expect(await busy.svc.sameRideDue()).toBe(0);

    const early = await habit([...WEEK, ride('o_today', '2026-10-08T04:12:00Z')]);
    early.clock.set('2026-10-08T04:20:00Z');
    expect(await early.svc.sameRideDue()).toBe(0);

    const regular = await habit(WEEK);
    await regular.svc.regularSave(ME, { days: [0, 1, 2, 3, 4], timeMin: 7 * 60 + 30, remind: 'evening', paymentMethod: 'cash', favouriteId: null, active: true, plan: RIDE_PLAN });
    regular.clock.set('2026-10-08T04:20:00Z');
    expect(await regular.svc.sameRideDue()).toBe(0);
  });

  it('on Sunday it is Thursday\'s ride; never on the weekend', async () => {
    const h = await habit([ride('o_tue', '2026-10-06T04:30:00Z'), ride('o_wed', '2026-10-07T04:30:00Z'), ride('o_thu', '2026-10-08T04:35:00Z')]);
    h.clock.set('2026-10-09T04:20:00Z'); // Friday
    expect(await h.svc.sameRideDue()).toBe(0);
    h.clock.set('2026-10-11T04:20:00Z'); // Sunday
    expect(await h.svc.sameRideDue()).toBe(1);
    expect(h.emitted[0]?.payload).toMatchObject({ date: '2026-10-11', afterWeekend: true });
  });
});

describe('booked rides: what the rider is told (review #28)', () => {
  const AT = new Date('2026-10-08T02:00:00Z');
  const ride = (over: Partial<Order> = {}) => ({ id: 'ord_b', type: 'ride', ordererId: 'c1', state: 'placed', scheduledFor: AT, ...over }) as Order;

  it('confirmed: his first name and photo, read for the rider (logged purpose booked_ride_driver)', async () => {
    const { svc, state } = setup();
    state.orders = [ride()];
    state.bookedPlan = { state: 'confirmed', driverId: 'd_abbas', confirmBy: new Date('2026-10-07T19:00:00Z'), searchAt: new Date('2026-10-08T01:30:00Z') };
    expect(await svc.bookedRide(ME, { orderId: 'ord_b' })).toEqual({
      orderId: 'ord_b',
      state: 'confirmed',
      confirmBy: new Date('2026-10-07T19:00:00Z'),
      searchAt: new Date('2026-10-08T01:30:00Z'),
      driver: { firstName: 'عباس', photoUrl: '/files/d_abbas.jpg' },
    });
    expect(state.purposes).toEqual(['booked_ride_driver']);
  });

  it('looking: until when drivers are asked, and no name', async () => {
    const { svc, state } = setup();
    state.orders = [ride()];
    state.bookedPlan = { state: 'looking', driverId: null, confirmBy: new Date('2026-10-07T19:00:00Z'), searchAt: new Date('2026-10-08T01:30:00Z') };
    expect(await svc.bookedRide(ME, { orderId: 'ord_b' })).toMatchObject({ state: 'looking', confirmBy: new Date('2026-10-07T19:00:00Z'), driver: null });
  });

  it('later: no pre-assignment (or nobody by the deadline) — the search time, 30 min before', async () => {
    const { svc, state } = setup();
    state.orders = [ride()];
    expect(await svc.bookedRide(ME, { orderId: 'ord_b' })).toEqual({ orderId: 'ord_b', state: 'later', confirmBy: null, searchAt: new Date('2026-10-08T01:30:00Z'), driver: null });
  });

  it("only his own ride booked for later", async () => {
    const { svc, state } = setup();
    state.orders = [ride({ ordererId: 'someone' }), ride({ id: 'ord_now', scheduledFor: null }), ride({ id: 'ord_food', type: 'food' })];
    expect(await code(svc.bookedRide(ME, { orderId: 'ord_b' }))).toBe('not_found');
    expect(await code(svc.bookedRide(ME, { orderId: 'ord_now' }))).toBe('not_found');
    expect(await code(svc.bookedRide(ME, { orderId: 'ord_food' }))).toBe('not_found');
  });
});
