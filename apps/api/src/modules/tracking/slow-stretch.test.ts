import { describe, expect, it } from 'vitest';
import { haversineM, type Actor, type LatLng } from '@driver/contracts';
import { ordersHarness } from '../orders/test-harness.js';
import { EtaService, StraightLineRouter, type EtaCorrection } from '../routing/index.js';
import { decodePolyline, kitchenStretch, measuredPath, SLOW_STRETCH_RULES, trafficStretch } from './slow-stretch.js';
import { TrackingService } from './tracking.service.js';
import { InMemoryCourierVehicles } from './vehicles.js';

const KITCHEN = { lat: 32.9105, lng: 45.0665 };
const as = (personId: string): Actor => ({ personId, sessionId: `s-${personId}` });

/** Google's polyline encoding, for building test shapes. */
function encode(points: readonly LatLng[], precision = 6): string {
  const scale = 10 ** precision;
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const num = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * scale);
    const lng = Math.round(p.lng * scale);
    num(lat - pLat);
    num(lng - pLng);
    pLat = lat;
    pLng = lng;
  }
  return out;
}

describe('slow stretch: the pure pieces (N6)', () => {
  it('decodes a polyline6 back to its points', () => {
    const pts = [{ lat: 32.9105, lng: 45.0665 }, { lat: 32.9151, lng: 45.07 }, { lat: 32.9185, lng: 45.0712 }];
    const back = decodePolyline(encode(pts));
    back.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(pts[i]!.lat, 6);
      expect(p.lng).toBeCloseTo(pts[i]!.lng, 6);
    });
  });

  it('cuts long segments to pieces and measures each point along the way', () => {
    const a = { lat: 32.9, lng: 45.06 };
    const b = { lat: 32.91, lng: 45.06 }; // ~1.1 km
    const path = measuredPath([a, b], 300);
    expect(path.points.length).toBe(5);
    expect(path.atM[path.atM.length - 1]).toBeCloseTo(haversineM(a, b), 3);
    for (let i = 1; i < path.atM.length; i++) expect(path.atM[i]! - path.atM[i - 1]!).toBeLessThanOrEqual(300);
  });

  it('traffic: the costliest unbroken run of slow pieces, with the minutes it adds', async () => {
    const line = Array.from({ length: 11 }, (_, i) => ({ lat: 32.9 + i * 0.0026, lng: 45.06 })); // ten ~289 m pieces
    const path = measuredPath(line, SLOW_STRETCH_RULES.pieceM);
    const total = path.atM[path.atM.length - 1]!;
    // Pieces 3-5 run 1.6×, piece 8 runs 1.2×: the first run costs more.
    const slow = (a: LatLng) => {
      const k = Math.round((a.lat - 32.9) / 0.0026);
      return k >= 3 && k <= 5 ? 1.6 : k === 8 ? 1.2 : 1;
    };
    const s = await trafficStretch(path, 20, async (a) => slow(a));
    expect(s).not.toBeNull();
    expect(s!.reason).toBe('traffic');
    expect(s!.fromM).toBe(Math.round(path.atM[3]!));
    expect(s!.toM).toBe(Math.round(path.atM[6]!));
    // 3 pieces of 20 min / 10 pieces × 0.6 = 3.6 → 4 minutes.
    expect(s!.minutes).toBe(4);
    expect(s!.toM).toBeLessThanOrEqual(Math.round(total));
  });

  it('traffic: nothing when the road runs at its usual speed or the extra is under a minute', async () => {
    const path = measuredPath([{ lat: 32.9, lng: 45.06 }, { lat: 32.91, lng: 45.06 }], 300);
    expect(await trafficStretch(path, 10, async () => 1)).toBeNull();
    expect(await trafficStretch(path, 10, async () => 1.1)).toBeNull(); // under the slow line
    expect(await trafficStretch(path, 2, async () => 1.2)).toBeNull(); // 0.4 min extra
  });

  it('kitchen: the stretch sits on the route at the kitchen', () => {
    const door = { lat: 32.9185, lng: 45.0712 };
    const courier = { lat: 32.905, lng: 45.06 };
    const path = measuredPath([courier, KITCHEN, door], 300);
    const s = kitchenStretch(path, KITCHEN, 7.4)!;
    const at = haversineM(courier, KITCHEN);
    expect(s).toEqual({ fromM: Math.round(at - 60), toM: Math.round(at + 60), reason: 'kitchen', minutes: 7 });
    expect(kitchenStretch(path, KITCHEN, 0.5)).toBeNull();
  });
});

describe('TrackingService.route: why it is late (N6)', () => {
  /** Learned: every leg 1.6× (the whole road crawls). */
  const crawl: EtaCorrection = { factor: async () => 1.6 };

  function setup(correction?: EtaCorrection) {
    const h = ordersHarness();
    const tracking = new TrackingService(
      h.orders,
      h.trips,
      { courierCard: async () => ({ firstName: 'حيدر', lastVerifiedAt: null }) },
      { merchant: (orgId) => (orgId === 'rest_1' ? { name: 'مطعم التجربة', pin: KITCHEN } : null), itemNames: async () => new Map() },
      { earnedOn: async () => 0 },
      new InMemoryCourierVehicles(),
      h.clock,
      new EtaService(new StraightLineRouter(), correction),
    );
    return { h, tracking };
  }

  async function placed(h: ReturnType<typeof ordersHarness>, tracking: TrackingService) {
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m-staff', { orderId: o.id, prepMinutes: 15 });
    const trip = await h.tripFor(o.id);
    const promisedAt = (await tracking.track(as('c1'), { orderId: o.id })).promisedAt!;
    return { orderId: o.id, trip, promisedAt };
  }
  const lateBy = (h: ReturnType<typeof ordersHarness>, promisedAt: Date, min: number) => h.clock.set(promisedAt.getTime() + min * 60_000);

  it('on time, or under 10 minutes late: no stretch', async () => {
    const { h, tracking } = setup(crawl);
    const { orderId, trip, promisedAt } = await placed(h, tracking);
    await h.pickup(trip.id);
    await h.trips.reportPosition(trip.courierId!, { tripId: trip.id, pin: { lat: 32.912, lng: 45.068 }, at: h.clock.now() });
    expect((await tracking.route(as('c1'), { orderId })).slowStretch).toBeNull();
    lateBy(h, promisedAt, 9);
    expect((await tracking.route(as('c1'), { orderId })).slowStretch).toBeNull();
  });

  it('10 minutes late on the road: the slow traffic stretch on the line the map draws', async () => {
    const { h, tracking } = setup(crawl);
    const { orderId, trip, promisedAt } = await placed(h, tracking);
    await h.pickup(trip.id);
    const courierAt = { lat: 32.905, lng: 45.06 };
    lateBy(h, promisedAt, 10);
    await h.trips.reportPosition(trip.courierId!, { tripId: trip.id, pin: courierAt, at: h.clock.now() });
    const r = await tracking.route(as('c1'), { orderId });
    expect(r.polyline6).toBeNull(); // straight line: measured along courier → door
    const door = (await h.orders.aggregate(orderId)).order.dropoff!.pin!;
    expect(r.slowStretch).toMatchObject({ reason: 'traffic', fromM: 0, toM: Math.round(haversineM(courierAt, door)) });
    expect(r.slowStretch!.minutes).toBeGreaterThanOrEqual(1);
  });

  it('nothing learned slow: no traffic stretch to point at', async () => {
    const { h, tracking } = setup();
    const { orderId, trip, promisedAt } = await placed(h, tracking);
    await h.pickup(trip.id);
    lateBy(h, promisedAt, 12);
    await h.trips.reportPosition(trip.courierId!, { tripId: trip.id, pin: { lat: 32.905, lng: 45.06 }, at: h.clock.now() });
    expect((await tracking.route(as('c1'), { orderId })).slowStretch).toBeNull();
  });

  it('the food is not out on time: the kitchen stretch, with how late the kitchen is', async () => {
    const { h, tracking } = setup(crawl);
    const { orderId, promisedAt } = await placed(h, tracking);
    lateBy(h, promisedAt, 11);
    const order = await h.orders.get(orderId);
    const r = await tracking.route(as('c1'), { orderId });
    expect(r.slowStretch?.reason).toBe('kitchen');
    expect(r.slowStretch?.minutes).toBe(Math.round((h.clock.now().getTime() - order.promisedReadyAt!.getTime()) / 60_000));
    expect(r.slowStretch?.fromM).toBe(0); // the route starts at the kitchen
  });
});
