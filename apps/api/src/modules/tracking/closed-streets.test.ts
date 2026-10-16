import { describe, expect, it } from 'vitest';
import { haversineM, type Actor, type LatLng } from '@driver/contracts';
import { ordersHarness } from '../orders/test-harness.js';
import { ClosureAwareRouter, EtaService, RouteClosures, StraightLineRouter, type RouteClosure, type RouteResult, type Router, type TableResult } from '../routing/index.js';
import { closedStretch, measuredPath } from './slow-stretch.js';
import { TrackingService } from './tracking.service.js';
import { InMemoryCourierVehicles } from './vehicles.js';

const KITCHEN = { lat: 32.9105, lng: 45.0665 };
const COURIER_AT: LatLng = { lat: 32.905, lng: 45.06 };
const as = (personId: string): Actor => ({ personId, sessionId: `s-${personId}` });
const lerp = (a: LatLng, b: LatLng, f: number): LatLng => ({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f });

/** The straight-line estimate, where every way around a closed street (an extra stop) costs 4 minutes of side streets. */
class SideStreetsRouter implements Router {
  private readonly inner = new StraightLineRouter();
  async route(points: readonly LatLng[]): Promise<RouteResult> {
    const r = await this.inner.route(points);
    return { ...r, durationS: r.durationS + Math.max(0, points.length - 2) * 240 };
  }
  table(s: readonly LatLng[], d: readonly LatLng[]): Promise<TableResult> {
    return this.inner.table(s, d);
  }
}

describe('closedStretch: the part of the route near a closed street (N20)', () => {
  const line = [{ lat: 32.9, lng: 45.06 }, { lat: 32.92, lng: 45.06 }]; // ~2.2 km north
  const path = measuredPath(line, 100);
  const closed = [lerp(line[0]!, line[1]!, 0.45), lerp(line[0]!, line[1]!, 0.55)]; // ~220 m in the middle

  it('covers the closed stretch and 150 m either side, with the minutes the way around adds', () => {
    const s = closedStretch(path, closed, 3.6)!;
    const total = path.atM.at(-1)!;
    expect(s.reason).toBe('closed');
    expect(s.minutes).toBe(4);
    const mid = total / 2;
    const half = haversineM(closed[0]!, closed[1]!) / 2 + 150;
    expect(s.fromM).toBeGreaterThanOrEqual(Math.round(mid - half) - 1);
    expect(s.toM).toBeLessThanOrEqual(Math.round(mid + half) + 1);
    expect(s.toM - s.fromM).toBeGreaterThan(400);
  });

  it('centres on the middle of the closed street, however many points it is drawn with', () => {
    const many = Array.from({ length: 12 }, (_, i) => lerp(closed[0]!, closed[1]!, i / 11));
    expect(closedStretch(path, many, 3.6)).toEqual(closedStretch(path, closed, 3.6));
  });

  it('nothing when the way around costs under a minute, or the closure is nowhere near this route', () => {
    expect(closedStretch(path, closed, 0.6)).toBeNull();
    const far = closed.map((p) => ({ lat: p.lat, lng: p.lng + 0.02 })); // ~1.9 km east
    expect(closedStretch(path, far, 5)).toBeNull();
    expect(closedStretch(path, [closed[0]!], 5)).toBeNull();
  });
});

describe('TrackingService.route: the customer sees the closed street only when his route goes around it (N20)', () => {
  function setup() {
    const h = ordersHarness();
    const book = new RouteClosures();
    const tracking = new TrackingService(
      h.orders,
      h.trips,
      { courierCard: async () => ({ firstName: 'حيدر', lastVerifiedAt: null }) },
      { merchant: (orgId) => (orgId === 'rest_1' ? { name: 'مطعم التجربة', pin: KITCHEN } : null), itemNames: async () => new Map() },
      { earnedOn: async () => 0 },
      new InMemoryCourierVehicles(),
      h.clock,
      new EtaService(new ClosureAwareRouter(new SideStreetsRouter(), book, h.clock)),
      null,
      null,
      null,
      null,
      book,
    );
    return { h, book, tracking };
  }

  /** An order on its way: picked up, the courier at COURIER_AT heading to the door. */
  async function onTheWay(s: ReturnType<typeof setup>) {
    const { h, tracking } = s;
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m-staff', { orderId: o.id, prepMinutes: 15 });
    const trip = await h.tripFor(o.id);
    const promisedAt = (await tracking.track(as('c1'), { orderId: o.id })).promisedAt!;
    await h.pickup(trip.id);
    await h.trips.reportPosition(trip.courierId!, { tripId: trip.id, pin: COURIER_AT, at: h.clock.now() });
    const door = (await h.orders.aggregate(o.id)).order.dropoff!.pin!;
    return { orderId: o.id, trip, promisedAt, door };
  }

  const closure = (s: ReturnType<typeof setup>, path: LatLng[], min = 240, id = 'cls_1'): RouteClosure => ({ id, path, endsAt: new Date(s.h.clock.now().getTime() + min * 60_000), reason: 'funeral', nameAr: 'شارع المستشفى' });

  it('no closures today: no closed street on the map', async () => {
    const s = setup();
    const { orderId } = await onTheWay(s);
    const r = await s.tracking.route(as('c1'), { orderId });
    expect(r.closures).toBeUndefined();
    expect(r.polyline6).toBeNull();
  });

  it('a live closure on his way: the bent line, the closed street with its minutes, and «closed» as the late reason', async () => {
    const s = setup();
    const { orderId, promisedAt, door, trip } = await onTheWay(s);
    const street = [lerp(COURIER_AT, door, 0.4), lerp(COURIER_AT, door, 0.6)];
    s.book.set([closure(s, street)]);
    const r = await s.tracking.route(as('c1'), { orderId });
    expect(r.polyline6).not.toBeNull();
    expect(r.closures).toHaveLength(1);
    expect(r.closures![0]).toMatchObject({ id: 'cls_1', reason: 'funeral', nameAr: 'شارع المستشفى', extraMin: 4 });
    expect(r.closures![0]!.path).toEqual(street);
    // On time: no late stretch yet.
    expect(r.slowStretch).toBeNull();
    // 10 minutes late on the road: the way around the closed street is what explains it.
    s.h.clock.set(promisedAt.getTime() + 10 * 60_000);
    await s.h.trips.reportPosition(trip.courierId!, { tripId: trip.id, pin: COURIER_AT, at: s.h.clock.now() });
    const late = await s.tracking.route(as('c1'), { orderId });
    expect(late.slowStretch).toMatchObject({ reason: 'closed', minutes: 4 });
  });

  it('a closure elsewhere in town: nothing on his map', async () => {
    const s = setup();
    const { orderId, door } = await onTheWay(s);
    const away = [lerp(COURIER_AT, door, 0.4), lerp(COURIER_AT, door, 0.6)].map((p) => ({ lat: p.lat + 0.01, lng: p.lng + 0.01 }));
    s.book.set([closure(s, away)]);
    const r = await s.tracking.route(as('c1'), { orderId });
    expect(r.closures).toBeUndefined();
  });

  it('once the closure ends (midnight, or ops opened it), the map stops showing it', async () => {
    const s = setup();
    const { orderId, door } = await onTheWay(s);
    s.book.set([closure(s, [lerp(COURIER_AT, door, 0.4), lerp(COURIER_AT, door, 0.6)], 5)]);
    expect((await s.tracking.route(as('c1'), { orderId })).closures).toHaveLength(1);
    s.h.clock.advance(6 * 60_000);
    expect((await s.tracking.route(as('c1'), { orderId })).closures).toBeUndefined();
    // Opened early: the closures module empties the book.
    s.book.set([closure(s, [lerp(COURIER_AT, door, 0.4), lerp(COURIER_AT, door, 0.6)], 120, 'cls_2')]);
    expect((await s.tracking.route(as('c1'), { orderId })).closures?.map((c) => c.id)).toEqual(['cls_2']);
    s.book.set([]);
    expect((await s.tracking.route(as('c1'), { orderId })).closures).toBeUndefined();
  });
});
