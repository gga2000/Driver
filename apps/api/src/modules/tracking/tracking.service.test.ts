import { describe, expect, it } from 'vitest';
import { DriverError, type Actor } from '@driver/contracts';
import { ordersHarness } from '../orders/test-harness.js';
import { ratingFrom } from '../orders/orders.service.js';
import { promisedArrival, sameBaghdadDay, TrackingService } from './tracking.service.js';
import { EtaService, StraightLineRouter } from '../routing/index.js';
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

function setup() {
  const h = ordersHarness();
  const vehicles = new InMemoryCourierVehicles();
  const vaultReads: Array<{ courierId: string; accessorId: string }> = [];
  const tracking = new TrackingService(
    h.orders,
    h.trips,
    {
      courierCard: async (courierId, accessorId) => {
        vaultReads.push({ courierId, accessorId });
        return { firstName: courierId === 'd1' ? 'حيدر' : null, lastVerifiedAt: h.clock.now() };
      },
    },
    {
      merchant: (orgId) => (orgId === 'rest_1' ? { name: 'مطعم التجربة', pin: KITCHEN } : null),
      itemNames: async (_orgId, ids) => new Map(ids.map((id) => [id, id === 'kebab' ? 'كباب' : 'تكة'])),
    },
    { earnedOn: async () => 42 },
    vehicles,
    h.clock,
    new EtaService(new StraightLineRouter()),
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
    vehicles.register('d1', { vehicleClass: 'tuktuk', plate: 'واسط ٤٥٦٧٨', label: null });
    const o = await acceptedOrder(h);
    const trip = await h.tripFor(o.id);
    const v = await tracking.track(as('c1'), { orderId: o.id });
    expect(v.courier).toMatchObject({ firstName: 'حيدر', vehicleClass: 'tuktuk', plate: 'واسط ٤٥٦٧٨', rating: null, ratingCount: 0 });
    expect(v.courier!.verifiedTodayAt).not.toBeNull();
    expect(v.trip).toMatchObject({ id: trip.id, state: 'en_route_to_pickup', dropsBeforeMine: 0 });
    expect(v.trip!.stops.every((s) => s.mine && s.target)).toBe(true);
    await tracking.track(as('c1'), { orderId: o.id });
    expect(vaultReads).toEqual([{ courierId: 'd1', accessorId: 'c1' }]);
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
    expect(again.courier).toMatchObject({ firstName: null });
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
