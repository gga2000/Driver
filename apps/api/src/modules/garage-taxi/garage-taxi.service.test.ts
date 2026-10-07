import { describe, expect, it } from 'vitest';
import { DriverError, GARAGE_TAXI_EVENTS, type Actor, type DeliveryPoint, type LatLng, type Order } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { InMemoryGarageTaxisRepository } from './garage-taxi.repository.js';
import { GarageTaxiService, type CarFacts, type GarageFacts, type GarageTaxiSources, type PlaceFacts, type RidePlacement, type SeatFacts } from './garage-taxi.service.js';

const RIDER: Actor = { personId: 'p_ali', sessionId: 's1' };
const MIN = 60_000;
const NOW = new Date('2026-10-08T05:00:00Z'); // 8:00 Baghdad

const BAB1: GarageFacts = { id: 'mp_garage_bab1', cityId: 'aziziyah', nameAr: 'كراج البوابة 1', nameEn: 'Gate 1 garage', lat: 32.9032, lng: 45.0578, draft: false };
const BAB2: GarageFacts = { id: 'mp_garage_bab2', cityId: 'aziziyah', nameAr: 'كراج البوابة 2', nameEn: 'Gate 2 garage', lat: 32.9088, lng: 45.0648, draft: false };
const NAHDHA: GarageFacts = { id: 'mp_garage_nahdha', cityId: 'baghdad', nameAr: 'كراج النهضة', nameEn: 'Al-Nahdha garage', lat: 33.3344, lng: 44.4165, draft: false };
const HOME: PlaceFacts = { id: 'pl_home', label: 'home', name: 'البيت', zoneName_ar: 'الزكور', zoneId: 'zakur', pin: { lat: 32.915, lng: 45.07 } };
const WORK: PlaceFacts = { id: 'pl_work', label: 'work', name: 'الدائرة', zoneName_ar: 'المركز', zoneId: 'centre', pin: { lat: 32.905, lng: 45.06 } };

const at = (min: number) => new Date(NOW.getTime() + min * MIN);

function seat(over: Partial<SeatFacts> = {}): SeatFacts {
  return { id: 'bk_out', riderId: RIDER.personId, departureId: 'dep_out', state: 'booked', seatIds: ['back_right'], pickupKind: 'garage', movedToBookingId: null, ...over };
}

function car(over: Partial<CarFacts> = {}): CarFacts {
  return { id: 'dep_out', driverId: 'drv_1', corridorId: 'aziziyah_baghdad', direction: 'from_aziziyah', garageId: BAB1.id, departAt: at(90), state: 'scheduled', departedAt: null, arrivedAt: null, lastFix: null, ...over };
}

function order(id: string, over: Partial<Order> = {}): Order {
  return { id, state: 'placed', totalIqd: 3_000, paymentMethod: 'cash', scheduledFor: null, ...over } as Order;
}

function harness(opts: { rideMin?: number; places?: PlaceFacts[]; usual?: 'cash' | 'wallet' | null; refuse?: DriverError; heldUntil?: Date } = {}) {
  const clock = new FakeClock(NOW);
  const repo = new InMemoryGarageTaxisRepository();
  const seats = new Map<string, SeatFacts>([['bk_out', seat()]]);
  const cars = new Map<string, CarFacts>([['dep_out', car()]]);
  const orders = new Map<string, Order>();
  const arrivals = new Map<string, Date>();
  const placed: Array<{ personId: string; input: RidePlacement }> = [];
  const emitted: Array<{ type: string; payload: Record<string, unknown>; idempotencyKey?: string }> = [];
  const minutesTo = new Map<string, number>();
  let places = opts.places ?? [WORK, HOME];
  let seq = 0;
  const taxiLate: { riderId: string; bookingId: string; until: Date | null }[] = [];
  const key = (p: LatLng) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
  const sources: GarageTaxiSources = {
    seat: async (id) => seats.get(id) ?? null,
    car: async (id) => cars.get(id) ?? null,
    garages: () => [BAB1, BAB2, NAHDHA],
    travelMin: () => 120,
    places: async () => places,
    zoneOf: (pin) => (pin.lat > 33 ? null : 'centre'),
    minutes: async (from) => minutesTo.get(key(from)) ?? opts.rideMin ?? 15,
    // 3,000 by day; a ride at 1:00–5:00 Baghdad costs more (the fare depends on the time asked for).
    fare: (_pickup: DeliveryPoint, _dropoff: DeliveryPoint, when: Date) => {
      const h = (when.getUTCHours() + 3) % 24;
      const fareIqd = h >= 1 && h < 5 ? 4_000 : 3_000;
      return { fareIqd, totalIqd: fareIqd };
    },
    place: async (personId, input) => {
      if (opts.refuse) throw opts.refuse;
      if (input.fareIqd !== 3_000) throw new DriverError('price_changed');
      placed.push({ personId, input });
      const prior = [...orders.values()].find((o) => (o as Order & { key?: string }).key === input.clientRequestId);
      if (prior) return prior;
      const o = { ...order(`ord_${++seq}`, { scheduledFor: input.scheduledFor ?? null, paymentMethod: input.paymentMethod }), key: input.clientRequestId } as Order;
      orders.set(o.id, o);
      return o;
    },
    order: async (id) => orders.get(id) ?? null,
    usualPayment: async () => (opts.usual === undefined ? null : opts.usual),
    rideArrival: async (id) => arrivals.get(id) ?? null,
    taxiLate: async (riderId, bookingId, until) => void taxiLate.push({ riderId, bookingId, until }),
    seatHeldUntil: async () => opts.heldUntil ?? null,
  };
  const service = new GarageTaxiService(repo, sources, { emit: async (e) => void emitted.push(e) }, clock);
  return {
    clock,
    repo,
    seats,
    cars,
    orders,
    arrivals,
    placed,
    emitted,
    taxiLate,
    minutesTo,
    service,
    setPlaces: (p: PlaceFacts[]) => (places = p),
  };
}

describe('x2: a taxi timed to the الرجعة car', () => {
  it('offers a pickup that reaches the garage 10 minutes before the car, from home first, on the 5-minute grid', async () => {
    const h = harness({ rideMin: 13 });
    const plan = await h.service.toGarage(RIDER, { bookingId: 'bk_out' });
    // 9:30 − 10 − 13 = 9:07 → 9:05 Baghdad.
    expect(plan).toMatchObject({ status: 'offer', mode: 'later', fromPlaceId: 'pl_home', fromName: 'البيت', rideMin: 13, bufferMin: 10, fareIqd: 3_000, totalIqd: 3_000, paymentMethod: 'cash' });
    expect(plan.pickupAt).toEqual(at(65));
    expect(plan.arriveAt).toEqual(at(78));
    expect(plan.places.map((p) => p.id)).toEqual(['pl_home', 'pl_work']);
    expect(plan.garage).toEqual({ id: BAB1.id, nameAr: BAB1.nameAr, nameEn: BAB1.nameEn });
  });

  it('times it from another saved place or a pin; a pin outside the city or a place not his is refused', async () => {
    const h = harness();
    h.minutesTo.set('32.9050,45.0600', 5);
    expect((await h.service.toGarage(RIDER, { bookingId: 'bk_out', from: { placeId: 'pl_work' } })).pickupAt).toEqual(at(75));
    expect((await h.service.toGarage(RIDER, { bookingId: 'bk_out', from: { pin: { lat: 32.905, lng: 45.06 } } })).fromPlaceId).toBeNull();
    await expect(h.service.toGarage(RIDER, { bookingId: 'bk_out', from: { pin: { lat: 33.4, lng: 44.4 } } })).rejects.toMatchObject({ code: 'outside_zone' });
    await expect(h.service.toGarage(RIDER, { bookingId: 'bk_out', from: { placeId: 'pl_x' } })).rejects.toMatchObject({ code: 'place_not_found' });
  });

  it('closer than a ride can be booked ahead: a ride now while it still makes the car, else too late', async () => {
    const h = harness({ rideMin: 15 });
    h.cars.set('dep_out', car({ departAt: at(35) }));
    const now = await h.service.toGarage(RIDER, { bookingId: 'bk_out' });
    expect(now).toMatchObject({ status: 'offer', mode: 'now', pickupAt: null });
    expect(now.arriveAt).toEqual(at(22));
    h.cars.set('dep_out', car({ departAt: at(20) }));
    expect(await h.service.toGarage(RIDER, { bookingId: 'bk_out' })).toMatchObject({ status: 'unavailable', unavailable: 'too_late', fareIqd: null });
  });

  it('is only for a booked garage seat on a car still to leave Aziziyah, and only the rider’s own', async () => {
    const cases: Array<[Partial<SeatFacts>, Partial<CarFacts>, string]> = [
      [{}, { direction: 'to_aziziyah', garageId: NAHDHA.id }, 'not_from_aziziyah'],
      [{ state: 'held' }, {}, 'not_booked'],
      [{ state: 'checked_in' }, {}, 'not_booked'],
      [{ pickupKind: 'door' }, {}, 'door_pickup'],
      [{}, { state: 'departed' }, 'car_left'],
    ];
    for (const [s, c, why] of cases) {
      const h = harness();
      h.seats.set('bk_out', seat(s));
      h.cars.set('dep_out', car(c));
      expect(await h.service.toGarage(RIDER, { bookingId: 'bk_out' })).toMatchObject({ status: 'unavailable', unavailable: why });
    }
    const none = harness({ places: [] });
    expect(await none.service.toGarage(RIDER, { bookingId: 'bk_out' })).toMatchObject({ status: 'unavailable', unavailable: 'no_place', places: [] });
    await expect(harness().service.toGarage({ personId: 'p_other', sessionId: 's' }, { bookingId: 'bk_out' })).rejects.toMatchObject({ code: 'booking_not_found' });
  });

  it('books an ordinary ride for that time, home → garage, his usual payment; a retry is the same ride; a cancelled one can be booked again', async () => {
    const h = harness({ rideMin: 13, usual: 'wallet' });
    const booked = await h.service.bookToGarage(RIDER, { bookingId: 'bk_out', fareIqd: 3_000, clientRequestId: 'gtaxi-test-1' });
    expect(booked).toMatchObject({ status: 'booked', mode: 'later', paymentMethod: 'wallet', order: { orderId: 'ord_1', state: 'placed' } });
    expect(h.placed[0]!.input).toMatchObject({ paymentMethod: 'wallet', scheduledFor: at(65), pickup: { zoneKey: 'zakur', placeId: 'pl_home' }, dropoff: { zoneKey: 'centre', pin: { lat: BAB1.lat, lng: BAB1.lng } } });
    expect((await h.service.bookToGarage(RIDER, { bookingId: 'bk_out', fareIqd: 3_000, clientRequestId: 'gtaxi-test-1' })).order?.orderId).toBe('ord_1');
    expect(h.placed).toHaveLength(1);
    h.orders.set('ord_1', { ...h.orders.get('ord_1')!, state: 'customer_cancelled' });
    expect((await h.service.toGarage(RIDER, { bookingId: 'bk_out' })).status).toBe('offer');
    expect((await h.service.bookToGarage(RIDER, { bookingId: 'bk_out', fareIqd: 3_000, clientRequestId: 'gtaxi-test-2' })).order?.orderId).toBe('ord_2');
  });

  it('a fare that moved is price_changed; an unavailable seat cannot book', async () => {
    const h = harness();
    await expect(h.service.bookToGarage(RIDER, { bookingId: 'bk_out', fareIqd: 2_500, clientRequestId: 'gtaxi-test-3' })).rejects.toMatchObject({ code: 'price_changed' });
    h.seats.set('bk_out', seat({ state: 'held' }));
    await expect(h.service.bookToGarage(RIDER, { bookingId: 'bk_out', fareIqd: 3_000, clientRequestId: 'gtaxi-test-4' })).rejects.toMatchObject({ code: 'booking_state_conflict' });
  });
});

describe('x3: the الرجعة driver hears when our taxi runs late', () => {
  async function booked() {
    const h = harness({ rideMin: 13 });
    await h.service.bookToGarage(RIDER, { bookingId: 'bk_out', fareIqd: 3_000, clientRequestId: 'gtaxi-late-1' });
    return h;
  }

  it('says nothing before the booked ride starts its search, nor while it is on time', async () => {
    const h = await booked();
    await h.service.tick();
    expect(h.emitted).toEqual([]);
    h.clock.set(at(55)); // search started (9:05 − 15); still placed: earliest 9:05 + 13 = 9:18, on time
    await h.service.tick();
    expect(h.emitted).toEqual([]);
    expect(await h.service.forOrder(RIDER, { orderId: 'ord_1' })).toMatchObject({ lateMin: 0, driverTold: false, expectedAt: at(78) });
  });

  it('tells the rider and the driver once 3+ minutes late, again only when it grew by 5', async () => {
    const h = await booked();
    h.orders.set('ord_1', { ...h.orders.get('ord_1')!, state: 'matched' });
    h.clock.set(at(70));
    h.arrivals.set('ord_1', at(94)); // 4 min after 9:30
    await h.service.tick();
    expect(h.emitted.map((e) => [e.type, e.payload['lateMin'], e.payload['driverId'], e.payload['bookingId']])).toEqual([[GARAGE_TAXI_EVENTS.late, 4, 'drv_1', 'bk_out']]);
    expect(h.emitted[0]!.payload).toMatchObject({ departureId: 'dep_out', orderId: 'ord_1', riderId: RIDER.personId, seats: ['back_right'], garageAr: BAB1.nameAr });
    h.arrivals.set('ord_1', at(97));
    await h.service.tick();
    expect(h.emitted).toHaveLength(1);
    h.arrivals.set('ord_1', at(99));
    await h.service.tick();
    expect(h.emitted.map((e) => e.payload['lateMin'])).toEqual([4, 9]);
    expect(await h.service.forOrder(RIDER, { orderId: 'ord_1' })).toMatchObject({ lateMin: 9, driverTold: true, toldMin: 9, seatHeldUntil: null });
    expect(await h.service.forOrder({ personId: 'p_other', sessionId: 's' }, { orderId: 'ord_1' })).toBeNull();
    expect(await h.service.forOrder(RIDER, { orderId: 'ord_other' })).toBeNull();
  });

  it('stops once he boarded, the car left or the ride ended — and never changes the seat', async () => {
    for (const end of ['boarded', 'left', 'cancelled'] as const) {
      const h = await booked();
      h.orders.set('ord_1', { ...h.orders.get('ord_1')!, state: 'matched' });
      h.arrivals.set('ord_1', at(110));
      if (end === 'boarded') h.seats.set('bk_out', seat({ state: 'checked_in' }));
      if (end === 'left') h.cars.set('dep_out', car({ state: 'departed' }));
      if (end === 'cancelled') h.orders.set('ord_1', { ...h.orders.get('ord_1')!, state: 'customer_cancelled' });
      await h.service.tick();
      expect(h.emitted).toEqual([]);
      expect((await h.repo.byOrder('ord_1'))?.state).toBe('closed');
    }
  });

  it('tells the seat when our late taxi is due, and clears it once the taxi is on time or gone (seat hold)', async () => {
    const h = await booked();
    h.orders.set('ord_1', { ...h.orders.get('ord_1')!, state: 'matched' });
    h.clock.set(at(70));
    h.arrivals.set('ord_1', at(91)); // 1 min late: nothing for the seat
    await h.service.tick();
    expect(h.taxiLate).toEqual([]);
    h.arrivals.set('ord_1', at(96)); // 6 min late
    await h.service.tick();
    expect(h.taxiLate).toEqual([{ riderId: RIDER.personId, bookingId: 'bk_out', until: at(96) }]);
    h.arrivals.set('ord_1', at(89)); // caught up
    await h.service.tick();
    expect(h.taxiLate.at(-1)).toEqual({ riderId: RIDER.personId, bookingId: 'bk_out', until: null });
    h.arrivals.set('ord_1', at(98));
    await h.service.tick();
    h.orders.set('ord_1', { ...h.orders.get('ord_1')!, state: 'customer_cancelled' });
    await h.service.tick();
    expect(h.taxiLate.slice(-2).map((c) => c.until)).toEqual([at(98), null]);
  });

  it('the rider’s notice carries the seat hold the routes module reports', async () => {
    const h = harness({ rideMin: 13, heldUntil: at(96) });
    await h.service.bookToGarage(RIDER, { bookingId: 'bk_out', fareIqd: 3_000, clientRequestId: 'gtaxi-late-2' });
    expect(await h.service.forOrder(RIDER, { orderId: 'ord_1' })).toMatchObject({ seatHeldUntil: at(96) });
  });
});

describe('x4 / n10: a taxi waiting at the Aziziyah garage', () => {
  function inbound(h: ReturnType<typeof harness>, over: Partial<CarFacts> = {}) {
    h.seats.set('bk_in', seat({ id: 'bk_in', departureId: 'dep_in', state: 'checked_in' }));
    h.cars.set('dep_in', car({ id: 'dep_in', driverId: 'drv_2', direction: 'to_aziziyah', garageId: NAHDHA.id, departAt: at(-100), state: 'departed', departedAt: at(-90), ...over }));
  }

  it('offers it on a trip back with today’s estimate (priced when ordered), home first, his usual payment', async () => {
    const h = harness({ usual: 'cash' });
    inbound(h, { lastFix: { lat: 33.0, lng: 44.9, at: at(-1) } });
    h.minutesTo.set('33.0000,44.9000', 25);
    const v = await h.service.arrival(RIDER, { bookingId: 'bk_in' });
    expect(v).toMatchObject({ status: 'off', toPlaceId: 'pl_home', toName: 'البيت', estimateIqd: 3_000, paymentMethod: 'cash', carEtaMin: 25, placeAtEtaMin: 10, orderId: null });
    expect(v.garage?.id).toBe(BAB1.id); // the nearest home garage to the car coming down from Baghdad
  });

  it('is not offered on a trip leaving Aziziyah, for a seat not booked, or after arrival', async () => {
    const h = harness();
    expect(await h.service.arrival(RIDER, { bookingId: 'bk_out' })).toMatchObject({ status: 'unavailable', unavailable: 'not_to_aziziyah' });
    inbound(h, { state: 'arrived', arrivedAt: at(-1) });
    expect(await h.service.arrival(RIDER, { bookingId: 'bk_in' })).toMatchObject({ status: 'unavailable', unavailable: 'arrived' });
    await expect(h.service.arm(RIDER, { bookingId: 'bk_in', to: { placeId: 'pl_home' } })).rejects.toMatchObject({ code: 'booking_state_conflict' });
  });

  it('armed, it books garage → home when the car is 10 minutes out (not before), once', async () => {
    const h = harness({ usual: 'wallet' });
    inbound(h, { lastFix: { lat: 33.0, lng: 44.9, at: at(0) } });
    h.minutesTo.set('33.0000,44.9000', 25);
    expect(await h.service.arm(RIDER, { bookingId: 'bk_in', to: { placeId: 'pl_home' } })).toMatchObject({ status: 'armed', paymentMethod: 'wallet' });
    await h.service.tick();
    expect(h.placed).toEqual([]);
    h.cars.set('dep_in', { ...h.cars.get('dep_in')!, lastFix: { lat: 32.95, lng: 45.0, at: at(14) } });
    h.minutesTo.set('32.9500,45.0000', 9);
    h.clock.set(at(14));
    expect(await h.service.tick()).toMatchObject({ placed: 1 });
    expect(h.placed[0]!.input).toMatchObject({ paymentMethod: 'wallet', pickup: { zoneKey: 'centre', pin: { lat: BAB1.lat, lng: BAB1.lng } }, dropoff: { zoneKey: 'zakur', placeId: 'pl_home' }, fareIqd: 3_000 });
    expect(h.placed[0]!.input.scheduledFor).toBeUndefined();
    expect(h.emitted.map((e) => e.type)).toEqual([GARAGE_TAXI_EVENTS.placed]);
    await h.service.tick();
    expect(h.placed).toHaveLength(1);
    expect(await h.service.arrival(RIDER, { bookingId: 'bk_in' })).toMatchObject({ status: 'placed', orderId: 'ord_1' });
    await expect(h.service.disarm(RIDER, { bookingId: 'bk_in' })).rejects.toMatchObject({ code: 'order_state_conflict' });
  });

  it('without a live fix the car’s minutes come from its departure and the corridor’s travel time', async () => {
    const h = harness();
    inbound(h, { departedAt: at(-112), lastFix: { lat: 33.0, lng: 44.9, at: at(-30) } });
    await h.service.arm(RIDER, { bookingId: 'bk_in', to: { placeId: 'pl_work' } });
    // 120 − 112 = 8 minutes: booked at once, when armed.
    expect(h.placed).toHaveLength(1);
    expect(h.placed[0]!.input.dropoff).toMatchObject({ placeId: 'pl_work' });
  });

  it('disarming is free before it is booked; a cancelled trip drops it; a moved seat keeps it', async () => {
    const h = harness();
    inbound(h, { state: 'scheduled', departedAt: null, departAt: at(30) });
    await h.service.arm(RIDER, { bookingId: 'bk_in', to: { placeId: 'pl_home' } });
    expect(await h.service.disarm(RIDER, { bookingId: 'bk_in' })).toMatchObject({ status: 'off' });
    await h.service.tick();
    expect(h.placed).toEqual([]);

    await h.service.arm(RIDER, { bookingId: 'bk_in', to: { placeId: 'pl_home' } });
    // The driver cancelled; the rider was moved to another car on the same corridor.
    h.seats.set('bk_in', seat({ id: 'bk_in', departureId: 'dep_in', state: 'moved', movedToBookingId: 'bk_in2' }));
    h.seats.set('bk_in2', seat({ id: 'bk_in2', departureId: 'dep_in2', state: 'booked' }));
    h.cars.set('dep_in2', car({ id: 'dep_in2', direction: 'to_aziziyah', garageId: NAHDHA.id, departAt: at(60) }));
    await h.service.tick();
    expect(await h.service.arrival(RIDER, { bookingId: 'bk_in' })).toMatchObject({ status: 'armed' });
    expect((await h.repo.byBooking('bk_in2', 'from_garage'))?.state).toBe('armed');

    h.seats.set('bk_in2', seat({ id: 'bk_in2', departureId: 'dep_in2', state: 'cancelled' }));
    expect(await h.service.tick()).toMatchObject({ dropped: 1 });
    expect(h.emitted.map((e) => [e.type, e.payload['reason']])).toEqual([[GARAGE_TAXI_EVENTS.dropped, 'trip_cancelled']]);
    expect(await h.service.arrival(RIDER, { bookingId: 'bk_in' })).toMatchObject({ status: 'dropped' });
  });

  it('a refused booking (a cash limit) fails it and tells him; he can arm it again', async () => {
    const h = harness({ refuse: new DriverError('new_customer_cash_cap') });
    inbound(h, { departedAt: at(-115) });
    await h.service.arm(RIDER, { bookingId: 'bk_in', to: { placeId: 'pl_home' } });
    expect(await h.service.arrival(RIDER, { bookingId: 'bk_in' })).toMatchObject({ status: 'failed', failCode: 'new_customer_cash_cap' });
    expect(h.emitted.map((e) => [e.type, e.payload['code']])).toEqual([[GARAGE_TAXI_EVENTS.failed, 'new_customer_cash_cap']]);
    expect((await h.service.arm(RIDER, { bookingId: 'bk_in', to: { placeId: 'pl_home' } })).status).toBe('failed');
    expect(h.emitted).toHaveLength(2);
  });

  it('a car that arrived long ago without it booked drops it as missed', async () => {
    const h = harness();
    inbound(h, { state: 'scheduled', departedAt: null });
    await h.service.arm(RIDER, { bookingId: 'bk_in', to: { placeId: 'pl_home' } });
    h.cars.set('dep_in', { ...h.cars.get('dep_in')!, state: 'arrived', arrivedAt: at(-20) });
    expect(await h.service.tick()).toMatchObject({ dropped: 1 });
    expect(h.emitted[0]!.payload['reason']).toBe('missed');
  });
});
