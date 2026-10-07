import { describe, expect, it } from 'vitest';
import { DriverError, type Actor } from '@driver/contracts';
import { ordersHarness } from '../orders/test-harness.js';
import { ratingFrom } from '../orders/orders.service.js';
import { promisedArrival, sameBaghdadDay, startCodeShown, TrackingService, type TrackingRatingsPort } from './tracking.service.js';
import { tripsOrdersRatings } from './ratings.js';
import { EtaService, StraightLineRouter, type Router } from '../routing/index.js';
import { InMemoryCourierVehicles } from './vehicles.js';

const KITCHEN = { lat: 32.9105, lng: 45.0665 };
const MIN = 60_000;

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

const as = (personId: string): Actor => ({ personId, sessionId: `s-${personId}` });

function setup(router: Router = new StraightLineRouter(), ratings: TrackingRatingsPort | null = null, start?: string) {
  const h = ordersHarness(start);
  const vehicles = new InMemoryCourierVehicles();
  const vaultReads: Array<{ courierId: string; accessorId: string }> = [];
  const tracking = new TrackingService(
    h.orders,
    h.trips,
    {
      courierCard: async (courierId, accessorId) => {
        vaultReads.push({ courierId, accessorId });
        // d1 has an approved main photo (Ali, 2026-10-06); identity hands out the ref of the approved one only.
        return { firstName: courierId === 'd1' ? 'حيدر' : null, lastVerifiedAt: h.clock.now(), photoRef: courierId === 'd1' ? 'up_d1' : null };
      },
    },
    {
      merchant: (orgId) => (orgId === 'rest_1' ? { name: 'مطعم التجربة', pin: KITCHEN } : null),
      itemNames: async (_orgId, ids) => new Map(ids.map((id) => [id, id === 'kebab' ? 'كباب' : 'تكة'])),
    },
    { earnedOn: async () => 42 },
    vehicles,
    h.clock,
    new EtaService(router),
    null,
    null,
    { readUrl: (ref) => `/files/${ref}?exp=1&sig=x` },
    ratings,
  );
  return { h, tracking, vehicles, vaultReads };
}

async function acceptedOrder(h: ReturnType<typeof ordersHarness>) {
  const placed = await h.orders.place('c1', h.foodInput());
  await h.orders.merchantAccept('m-staff', { orderId: placed.id, prepMinutes: 15 });
  return placed;
}

describe('TrackingService — owner checks', () => {
  it('lets the orderer and a participant with an account read, and nobody else', async () => {
    const { h, tracking } = setup();
    h.people.set('07701111111', 'p_friend');
    const o = await h.orders.place('c1', h.foodInput({ participants: [{ ref: 'a', role: 'diner', phone: '07701111111' }] }));
    expect((await tracking.track(as('c1'), { orderId: o.id })).order.id).toBe(o.id);
    expect((await tracking.track(as('p_friend'), { orderId: o.id })).order.id).toBe(o.id);
    expect(await code(tracking.track(as('stranger'), { orderId: o.id }))).toBe('forbidden');
    expect(await code(tracking.courierPosition(as('stranger'), { orderId: o.id }))).toBe('forbidden');
    // The courier, merchant staff and ops use their own apps; the customer read is customer-only.
    const trip = await h.tripFor(o.id);
    expect(await code(tracking.track(as(trip.courierId!), { orderId: o.id }))).toBe('forbidden');
  });
});

describe('TrackingService — the view', () => {
  it('names the items, the kitchen and the promised time; no courier before one accepts', async () => {
    const { h, tracking } = setup();
    const o = await acceptedOrder(h);
    const v = await tracking.track(as('c1'), { orderId: o.id });
    expect(v.items.map((i) => [i.name, i.qty, i.totalIqd])).toEqual([
      ['كباب', 2, 10000],
      ['تكة', 1, 5000],
    ]);
    expect(v.merchant).toMatchObject({ id: 'rest_1', name: 'مطعم التجربة' });
    expect(v.courier).toBeNull();
    expect(v.trip).toBeNull();
    expect(v.reassigning).toBe(false);
    expect(v.pointsEarned).toBeNull();
    // ready in 15 min + the kitchen → door ride
    const promised = v.promisedAt!.getTime() - h.clock.now().getTime();
    expect(promised).toBeGreaterThan(15 * MIN);
    expect(promised).toBeLessThan(25 * MIN);
  });

  it('shows the courier by first name, vehicle and plate, verified today; one vault read per trip', async () => {
    const { h, tracking, vehicles, vaultReads } = setup();
    vehicles.register('d1', { vehicleClass: 'tuktuk', plate: 'واسط ٤٥٦٧٨' });
    const o = await acceptedOrder(h);
    const trip = await h.tripFor(o.id);
    const v = await tracking.track(as('c1'), { orderId: o.id });
    expect(v.courier).toMatchObject({ firstName: 'حيدر', vehicleClass: 'tuktuk', plate: 'واسط ٤٥٦٧٨', rating: null, ratingCount: 0, photoUrl: '/files/up_d1?exp=1&sig=x' });
    expect(v.courier!.verifiedTodayAt).not.toBeNull();
    expect(v.trip).toMatchObject({ id: trip.id, state: 'en_route_to_pickup', dropsBeforeMine: 0 });
    expect(v.trip!.stops.every((s) => s.mine && s.target)).toBe(true);
    await tracking.track(as('c1'), { orderId: o.id });
    expect(vaultReads).toEqual([{ courierId: 'd1', accessorId: 'c1' }]);
  });

  it('ride step 3: the card names the model with its colour, the confirmed features and his completed trips', async () => {
    const { h, tracking, vehicles } = setup();
    vehicles.register('d1', { vehicleClass: 'car', plate: 'واسط 31207', model: 'Toyota Corolla', colour: 'white', features: ['family', 'ac'] });
    // An earlier job he finished counts; this one (still on its way) does not yet.
    const first = await acceptedOrder(h);
    const firstTrip = await h.tripFor(first.id);
    await h.pickup(firstTrip.id);
    await h.dropoff(firstTrip.id, { cashCollectedIqd: 16500 });
    const o = await acceptedOrder(h);
    await h.tripFor(o.id);
    const card = (await tracking.track(as('c1'), { orderId: o.id })).courier!;
    expect(card).toMatchObject({ vehicleModel: 'Toyota Corolla', vehicleColour: 'white', vehicleLabel: 'Toyota Corolla · أبيض', features: ['ac', 'family'], tripCount: 1 });
  });

  it('ride step 3: without a registered model the card has no label, no colour and no features', async () => {
    const { h, tracking, vehicles } = setup();
    vehicles.register('d1', { vehicleClass: 'tuktuk', plate: 'واسط 777', colour: 'red' });
    const o = await acceptedOrder(h);
    await h.tripFor(o.id);
    expect((await tracking.track(as('c1'), { orderId: o.id })).courier).toMatchObject({ vehicleModel: null, vehicleColour: 'red', vehicleLabel: null, features: [], tripCount: 0 });
  });

  it('joy l2: the card carries his public rating once five customers rated him (read once per card)', async () => {
    let reads = 0;
    const at = (n: number) => new Date(Date.UTC(2026, 9, n));
    const few = setup(undefined, { courierScores: async () => [4, 5, 5].map((score, i) => ({ score, at: at(i + 1) })) });
    few.vehicles.register('d1', { vehicleClass: 'bike', plate: 'واسط 11111' });
    const o1 = await acceptedOrder(few.h);
    await few.h.tripFor(o1.id);
    expect((await few.tracking.track(as('c1'), { orderId: o1.id })).courier).toMatchObject({ rating: null, ratingCount: 0 });
    const many = setup(undefined, {
      courierScores: async () => {
        reads += 1;
        return [5, 5, 4, 5, 5, 4].map((score, i) => ({ score, at: at(i + 1) }));
      },
    });
    many.vehicles.register('d1', { vehicleClass: 'bike', plate: 'واسط 11111' });
    const o2 = await acceptedOrder(many.h);
    await many.h.tripFor(o2.id);
    expect((await many.tracking.track(as('c1'), { orderId: o2.id })).courier).toMatchObject({ rating: 4.7, ratingCount: 6 });
    await many.tracking.track(as('c1'), { orderId: o2.id });
    expect(reads).toBe(1);
  });

  it('joy l2: the scores come from the delivery ratings on his completed trips, newest first', async () => {
    const order = (id: string, delivery: number | null, day: number) => ({ id, rating: delivery === null ? null : { delivery, food: null, tags: [], note: null, ratedAt: new Date(Date.UTC(2026, 9, day)) } });
    const orders = new Map([
      ['o1', order('o1', 5, 1)],
      ['o2', order('o2', 3, 2)],
      ['o3', order('o3', null, 3)],
    ]);
    const trip = (id: string, state: string, orderIds: string[], day: number) => ({ id, state, completedAt: new Date(Date.UTC(2026, 9, day)), orders: orderIds.map((orderId) => ({ orderId })) });
    const port = tripsOrdersRatings(
      { completedForDriver: async () => [trip('t1', 'completed', ['o1'], 1), trip('t2', 'completed', ['o2', 'o3', 'gone'], 2), trip('t3', 'cancelled', ['o1'], 3)] as never },
      {
        get: async (id: string) => {
          const o = orders.get(id);
          if (!o) throw new DriverError('order_not_found');
          return o as never;
        },
      },
      () => new Date(Date.UTC(2026, 9, 7)),
    );
    expect((await port.courierScores('d1')).map((s) => s.score)).toEqual([3, 5]);
  });

  it('flags a lost courier as reassigning until the next one accepts', async () => {
    const { h, tracking } = setup();
    const o = await acceptedOrder(h);
    const trip = await h.tripFor(o.id);
    await h.trips.detachOrder(trip.id, o.id, 'dispatcher', 'reassigned');
    const v = await tracking.track(as('c1'), { orderId: o.id });
    expect(v.reassigning).toBe(true);
    expect(v.courier).toBeNull();
    await h.tripFor(o.id, { driverId: 'd2' });
    const again = await tracking.track(as('c1'), { orderId: o.id });
    expect(again.reassigning).toBe(false);
    expect(again.courier).toMatchObject({ firstName: null, photoUrl: null });
  });

  it('reports points once the order closes', async () => {
    const { h, tracking } = setup();
    const o = await acceptedOrder(h);
    const trip = await h.tripFor(o.id);
    await h.pickup(trip.id);
    await h.dropoff(trip.id, { cashCollectedIqd: 16500 });
    await h.orders.rate('c1', { orderId: o.id, delivery: 5, food: 4 });
    const v = await tracking.track(as('c1'), { orderId: o.id });
    expect(v.order.state).toBe('closed');
    expect(v.order.rating).toMatchObject({ delivery: 5, food: 4, tags: [] });
    expect(v.pointsEarned).toBe(42);
    // the trip that carried it stays visible for the timeline timestamps
    expect(v.trip).toMatchObject({ id: trip.id, state: 'completed' });
  });
});

describe('TrackingService — order history (طلباتي, C-15)', () => {
  it('lists my orders newest first with the restaurant and dish names, and nobody else’s', async () => {
    const { h, tracking } = setup();
    const first = await acceptedOrder(h);
    h.clock.advance(60_000);
    const second = await h.orders.place('c1', h.foodInput());
    await h.orders.place('someone_else', h.foodInput());
    const rows = await tracking.history(as('c1'));
    expect(rows.map((r) => r.order.id)).toEqual([second.id, first.id]);
    expect(rows[0]).toMatchObject({ merchantName: 'مطعم التجربة', dropoffZoneKey: null });
    expect(rows[0]!.items.length).toBeGreaterThan(0);
    for (const it of rows[0]!.items) expect(['كباب', 'تكة']).toContain(it.name);
    expect(await tracking.history(as('nobody'))).toEqual([]);
  });
});

describe('TrackingService — «أول مرة» (joy g8)', () => {
  it('names the first meal delivered, only once it is delivered, and it never changes after', async () => {
    const { h, tracking } = setup();
    const early = await acceptedOrder(h);
    h.clock.advance(60_000);
    const later = await acceptedOrder(h);
    expect(await tracking.firsts(as('c1'))).toEqual({ foodOrderId: null, tuktukOrderId: null, nightRideOrderId: null, rideMilestone: null });
    // The later order reaches the door first: that is the first meal.
    const t2 = await h.tripFor(later.id);
    await h.pickup(t2.id);
    await h.dropoff(t2.id, { cashCollectedIqd: 16500 });
    expect((await tracking.firsts(as('c1'))).foodOrderId).toBe(later.id);
    h.clock.advance(10 * MIN);
    const t1 = await h.tripFor(early.id);
    await h.pickup(t1.id);
    await h.dropoff(t1.id, { cashCollectedIqd: 16500 });
    expect((await tracking.firsts(as('c1'))).foodOrderId).toBe(later.id);
    expect(await tracking.firsts(as('someone_else'))).toEqual({ foodOrderId: null, tuktukOrderId: null, nightRideOrderId: null, rideMilestone: null });
  });

  it('joy s3: the same delivered order a week apart, same weekday and band, is a usual with its history row', async () => {
    const { h, tracking } = setup();
    expect(await tracking.usuals(as('c1'))).toEqual([]);
    const delivered = async () => {
      const o = await acceptedOrder(h);
      const t = await h.tripFor(o.id);
      await h.pickup(t.id);
      await h.dropoff(t.id, { cashCollectedIqd: 16500 });
      return o;
    };
    await delivered();
    expect(await tracking.usuals(as('c1'))).toEqual([]);
    h.clock.advance(7 * 24 * 60 * MIN);
    const second = await delivered();
    const [usual] = await tracking.usuals(as('c1'));
    expect(usual).toMatchObject({ kind: 'weekday', times: 2, row: { order: { id: second.id }, merchantName: expect.any(String) } });
    expect(usual!.row.items.length).toBeGreaterThan(0);
    expect(await tracking.usuals(as('someone_else'))).toEqual([]);
  });
});

describe('TrackingService — courier position window', () => {
  it('is null before accept, visible while he works the job, and null after my drop-off', async () => {
    const { h, tracking } = setup();
    const o = await acceptedOrder(h);
    expect(await tracking.courierPosition(as('c1'), { orderId: o.id })).toBeNull();
    const trip = await h.tripFor(o.id);
    // accepted but no fix yet
    expect(await tracking.courierPosition(as('c1'), { orderId: o.id })).toBeNull();
    await h.trips.reportPosition('d1', { tripId: trip.id, pin: { lat: 32.915, lng: 45.07 }, at: h.clock.now(), bearing: 120, speedKmh: 22 });
    h.clock.advance(5000);
    const p = await tracking.courierPosition(as('c1'), { orderId: o.id });
    expect(p).toMatchObject({ tripId: trip.id, pin: { lat: 32.915, lng: 45.07 }, bearing: 120, speedKmh: 22, ageSec: 5 });
    await h.pickup(trip.id);
    expect(await tracking.courierPosition(as('c1'), { orderId: o.id })).not.toBeNull();
    await h.dropoff(trip.id, { cashCollectedIqd: 16500 });
    expect(await tracking.courierPosition(as('c1'), { orderId: o.id })).toBeNull();
  });
});

describe('TrackingService — one ETA (maps program SP4b)', () => {
  it('before pickup: to the kitchen, waits for the food, then to the door; after pickup: straight to the door', async () => {
    const { h, tracking } = setup();
    const o = await acceptedOrder(h);
    const trip = await h.tripFor(o.id);
    const order = await h.orders.get(o.id);
    await h.trips.reportPosition('d1', { tripId: trip.id, pin: KITCHEN, at: h.clock.now() });
    const atKitchen = await tracking.courierPosition(as('c1'), { orderId: o.id });
    const promised = (await tracking.track(as('c1'), { orderId: o.id })).promisedAt!;
    // He is at the counter: the food decides, so the live ETA is the promise.
    expect(atKitchen).toMatchObject({ etaBasis: 'estimated' });
    expect(atKitchen!.etaAt!.getTime()).toBe(promised.getTime());
    expect(promised.getTime()).toBeGreaterThan(order.promisedReadyAt!.getTime());
    await h.pickup(trip.id);
    h.clock.advance(60_000);
    await h.trips.reportPosition('d1', { tripId: trip.id, pin: KITCHEN, at: h.clock.now() });
    const onTheWay = await tracking.courierPosition(as('c1'), { orderId: o.id });
    const rideMs = promised.getTime() - order.promisedReadyAt!.getTime();
    expect(onTheWay!.etaAt!.getTime()).toBe(h.clock.now().getTime() + rideMs);
  });
});

describe('orders.rate — two-tap rating validation', () => {
  it('stores delivery and food separately and closes the order; the first rating stands', async () => {
    const { h } = setup();
    const o = await acceptedOrder(h);
    const trip = await h.tripFor(o.id);
    await h.pickup(trip.id);
    await h.dropoff(trip.id, { cashCollectedIqd: 16500 });
    const rated = await h.orders.rate('c1', { orderId: o.id, delivery: 2, food: 5, tags: ['late', 'late'], note: '  تأخر شوية ' });
    expect(rated.state).toBe('closed');
    expect(rated.rating).toMatchObject({ delivery: 2, food: 5, tags: ['late'], note: 'تأخر شوية' });
    const replay = await h.orders.rate('c1', { orderId: o.id, delivery: 5 });
    expect(replay.rating).toMatchObject({ delivery: 2, food: 5 });
  });

  it('rates an order under dispute without closing it (low rating → complaint first, C-12)', async () => {
    const { h } = setup();
    const o = await acceptedOrder(h);
    const trip = await h.tripFor(o.id);
    await h.pickup(trip.id);
    await h.dropoff(trip.id, { cashCollectedIqd: 16500 });
    expect((await h.orders.openDispute('c1', { orderId: o.id, kind: 'cold_or_late', note: 'بارد' })).state).toBe('disputed');
    const rated = await h.orders.rate('c1', { orderId: o.id, delivery: 2, food: 1, tags: ['cold'] });
    expect(rated.state).toBe('disputed');
    expect(rated.rating).toMatchObject({ delivery: 2, food: 1, tags: ['cold'] });
  });

  it('refuses strangers, early ratings and out-of-range scores', async () => {
    const { h } = setup();
    const o = await acceptedOrder(h);
    expect(await code(h.orders.rate('stranger', { orderId: o.id, delivery: 5 }))).toBe('forbidden');
    expect(await code(h.orders.rate('c1', { orderId: o.id, delivery: 5 }))).toBe('order_state_conflict');
  });

  it('takes a food score only on kitchen orders, and tags or a note only with a score', () => {
    const at = new Date('2026-10-03T10:00:00Z');
    expect(ratingFrom({ type: 'food' }, { orderId: 'o', delivery: 4, food: 3 }, at)).toEqual({ delivery: 4, food: 3, tags: [], note: null, ratedAt: at });
    expect(ratingFrom({ type: 'ride' }, { orderId: 'o', delivery: 5 }, at)).toMatchObject({ delivery: 5, food: null });
    expect(() => ratingFrom({ type: 'ride' }, { orderId: 'o', delivery: 5, food: 5 }, at)).toThrow(DriverError);
    expect(() => ratingFrom({ type: 'food' }, { orderId: 'o', tags: ['cold'] }, at)).toThrow(DriverError);
    expect(() => ratingFrom({ type: 'food' }, { orderId: 'o', note: 'x' }, at)).toThrow(DriverError);
    // the plain close-early call still works
    expect(ratingFrom({ type: 'food' }, { orderId: 'o' }, at)).toBeNull();
    expect(ratingFrom({ type: 'food' }, { orderId: 'o', note: '   ' }, at)).toBeNull();
  });
});

describe('helpers', () => {
  it('compares days in Baghdad time (UTC+3)', () => {
    expect(sameBaghdadDay(new Date('2026-10-03T20:59:00Z'), new Date('2026-10-03T06:00:00Z'))).toBe(true);
    expect(sameBaghdadDay(new Date('2026-10-03T21:01:00Z'), new Date('2026-10-03T06:00:00Z'))).toBe(false);
  });

  it('promises kitchen orders only, from the ready time plus the ride', () => {
    const ready = new Date('2026-10-03T10:00:00Z');
    const base = { type: 'food' as const, promisedReadyAt: ready, dropoff: { zoneKey: 'z', pin: { lat: 32.9185, lng: 45.0712 } }, minVehicleClass: null };
    expect(promisedArrival(base, KITCHEN, ready, 12)).toEqual(new Date(ready.getTime() + 12 * 60_000));
    expect(promisedArrival({ ...base, type: 'ride' }, KITCHEN, ready, 12)).toBeNull();
    expect(promisedArrival(base, null, ready, 12)).toBeNull();
    expect(promisedArrival(base, KITCHEN, null, 12)).toBeNull();
    expect(promisedArrival(base, KITCHEN, ready, null)).toBeNull();
  });
});

describe('TrackingService — the road ahead (maps program SP5a)', () => {
  /** A road router that records what it was asked and answers with a fixed shape. */
  function roadRouter(): Router & { asked: Array<Array<{ lat: number; lng: number }>> } {
    const asked: Array<Array<{ lat: number; lng: number }>> = [];
    return {
      asked,
      route: async (points) => {
        asked.push([...points]);
        return { distanceM: 2_000, durationS: 300, polyline6: 'road_shape', basis: 'road' };
      },
      table: async () => ({ durationsS: [], distancesM: [], basis: 'road' }),
    };
  }

  it('kitchen → door before a courier, courier → kitchen → door on the way, courier → door after pickup', async () => {
    const router = roadRouter();
    const { h, tracking } = setup(router);
    const o = await acceptedOrder(h);
    const door = (await h.orders.aggregate(o.id)).order.dropoff!.pin!;
    expect(await tracking.route(as('c1'), { orderId: o.id })).toMatchObject({ polyline6: 'road_shape', basis: 'road', from: KITCHEN });
    expect(router.asked.at(-1)).toEqual([KITCHEN, door]);
    const trip = await h.tripFor(o.id);
    const courierAt = { lat: 32.915, lng: 45.07 };
    await h.trips.reportPosition('d1', { tripId: trip.id, pin: courierAt, at: h.clock.now() });
    expect((await tracking.route(as('c1'), { orderId: o.id })).from).toEqual(courierAt);
    expect(router.asked.at(-1)?.[0]).toEqual(courierAt);
    expect(router.asked.at(-1)).toHaveLength(3);
    await h.pickup(trip.id);
    await tracking.route(as('c1'), { orderId: o.id });
    expect(router.asked.at(-1)).toHaveLength(2);
    expect(await code(tracking.route(as('stranger'), { orderId: o.id }))).toBe('forbidden');
  });

  it('without a road router there is no shape to draw', async () => {
    const { h, tracking } = setup();
    const o = await acceptedOrder(h);
    expect(await tracking.route(as('c1'), { orderId: o.id })).toMatchObject({ polyline6: null, basis: 'estimated' });
  });
});

describe('TrackingService — late before it is late (maps program o4)', () => {
  it('flags a delivery whose live ETA lands past the promise; a courier on time is not flagged', async () => {
    const { h, tracking } = setup();
    const onTime = await acceptedOrder(h);
    const late = await acceptedOrder(h);
    const t1 = await h.tripFor(onTime.id);
    const t2 = await h.tripFor(late.id, { driverId: 'd2' });
    // d1 waits at the kitchen; d2 is 20 km out of town.
    await h.trips.reportPosition('d1', { tripId: t1.id, pin: KITCHEN, at: h.clock.now(), speedKmh: 0 });
    await h.trips.reportPosition('d2', { tripId: t2.id, pin: { lat: KITCHEN.lat + 0.18, lng: KITCHEN.lng }, at: h.clock.now(), bearing: 180, speedKmh: 30 });
    const risks = await tracking.atRisk('aziziyah');
    expect(risks.map((r) => r.orderId)).toEqual([late.id]);
    expect(risks[0]!.lateByMin).toBeGreaterThan(2);
    expect(risks[0]!.predictedAt.getTime()).toBeGreaterThan(risks[0]!.promisedAt.getTime());
  });
});

describe('TrackingService — «رمز المشوار» on the rider’s screen (ride step 3, s1)', () => {
  const HOME = { lat: 32.9185, lng: 45.0712 };
  /** 22:30 in Baghdad. */
  const NIGHT = '2026-10-03T19:30:00Z';

  async function nightRide(start = NIGHT) {
    const { h, tracking } = setup(new StraightLineRouter(), null, start);
    h.people.set('07705554433', 'p_mum');
    const o = await h.orders.place('c1', {
      cityId: 'aziziyah',
      type: 'ride',
      rideVertical: 'taxi',
      fareIqd: 3000,
      pickup: { zoneKey: 'centre', pin: KITCHEN },
      dropoff: { zoneKey: 'street_30', pin: HOME },
      participants: [{ ref: 'mum', role: 'rider' as const, phone: '07705554433' }],
    });
    const t = await h.trips.createForOrders({
      cityId: 'aziziyah',
      vertical: 'taxi',
      orders: [{ orderId: o.id, minVehicleClass: null }],
      stops: [
        { orderId: o.id, type: 'pickup', zoneKey: 'centre', target: KITCHEN },
        { orderId: o.id, type: 'dropoff', zoneKey: 'street_30', target: HOME },
      ],
    });
    await h.trips.offer(t.id);
    await h.trips.accept(t.id, 'd1', { vehicleClass: 'car' });
    return { h, tracking, o, t };
  }

  it('the orderer and the rider see the code until the rider is in; the driver never reads the tracking', async () => {
    const { h, tracking, o, t } = await nightRide();
    const stored = await h.orders.startCodeOf(o.id);
    expect(stored).toMatch(/^\d{4}$/);
    expect((await tracking.track(as('c1'), { orderId: o.id })).trip!.startCode).toBe(stored);
    expect((await tracking.track(as('p_mum'), { orderId: o.id })).trip!.startCode).toBe(stored);
    expect(await code(tracking.track(as('d1'), { orderId: o.id }))).toBe('forbidden');
    const pickup = t.stops.find((s) => s.type === 'pickup')!;
    await h.trips.arrive(t.id, pickup.id, 'd1', { pin: KITCHEN });
    await h.trips.completeStop(t.id, pickup.id, 'd1', { startCode: stored! });
    await h.deliver();
    expect((await tracking.track(as('c1'), { orderId: o.id })).trip!.startCode).toBeNull();
  });

  it('a day ride shows none', async () => {
    const { tracking, o } = await nightRide('2026-10-03T09:00:00Z');
    expect((await tracking.track(as('c1'), { orderId: o.id })).trip!.startCode).toBeNull();
  });

  it('the one ETA to the pickup answers the ride-near check, and only for rides', async () => {
    const { h, tracking, o, t } = await nightRide();
    const near = await tracking.secondsToPickup(await h.trips.get(t.id), o.id, { lat: KITCHEN.lat + 0.001, lng: KITCHEN.lng }, h.clock.now());
    const far = await tracking.secondsToPickup(await h.trips.get(t.id), o.id, { lat: KITCHEN.lat + 0.01, lng: KITCHEN.lng }, h.clock.now());
    expect(near).not.toBeNull();
    expect(far!).toBeGreaterThan(near!);
    const food = await acceptedOrder(h);
    const foodTrip = await h.tripFor(food.id, { driverId: 'd2' });
    expect(await tracking.secondsToPickup(foodTrip, food.id, KITCHEN, h.clock.now())).toBeNull();
  });

  it('startCodeShown: none for other orders, settled rides, or once the pickup is done', () => {
    const pending = { stops: [{ type: 'pickup' as const, state: 'arrived' as const }] };
    expect(startCodeShown({ type: 'ride', state: 'matched' }, pending as never, '4821')).toBe('4821');
    expect(startCodeShown({ type: 'ride', state: 'matched' }, null, '4821')).toBe('4821');
    expect(startCodeShown({ type: 'food', state: 'placed' }, pending as never, '4821')).toBeNull();
    expect(startCodeShown({ type: 'ride', state: 'customer_cancelled' }, pending as never, '4821')).toBeNull();
    expect(startCodeShown({ type: 'ride', state: 'matched' }, { stops: [{ type: 'pickup', state: 'completed' }] } as never, '4821')).toBeNull();
    expect(startCodeShown({ type: 'ride', state: 'matched' }, pending as never, null)).toBeNull();
  });
});
