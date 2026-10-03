import { describe, expect, it } from 'vitest';
import type { Order, OrderTracking } from '@driver/contracts';
import { createT } from '@driver/i18n';
import { lateMinutes, liveEta, signalLostMinutes } from './eta';
import { bearingDeg, distanceM, fitCamera, glideAt, layerTransform, nearestAngle, nextGlide, project, remainingRoute, unproject } from './geo';
import { buildTimeline, phaseOf, statusLine } from './timeline';

const t = createT('ar-IQ');
const clock = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;

const KITCHEN = { lat: 32.9095, lng: 45.0635 };
const HOME = { lat: 32.887, lng: 45.0765 };
const T0 = new Date('2026-10-03T09:00:00Z');
const MIN = 60_000;
const at = (m: number) => new Date(T0.getTime() + m * MIN);

function order(patch: Partial<Order> = {}): Order {
  return {
    id: 'ord_1',
    cityId: 'aziziyah',
    type: 'food',
    state: 'placed',
    ordererId: 'c1',
    merchantOrgId: 'rest_1',
    householdOrgId: null,
    quoteId: null,
    paymentMethod: 'cash',
    itemsTotalIqd: 14000,
    deliveryFeeIqd: 1000,
    serviceFeeIqd: 500,
    discountIqd: 0,
    tipIqd: 0,
    totalIqd: 15500,
    minVehicleClass: 'bike',
    cateringRequest: false,
    lines: [],
    participants: [],
    partial: null,
    scheduledFor: null,
    merchantOfferedAt: T0,
    promisedReadyAt: null,
    placedAt: T0,
    acceptedAt: null,
    preparingAt: null,
    readyAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    closedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    cancellationFeeIqd: 0,
    refundState: 'none',
    note: null,
    rating: null,
    ...patch,
  };
}

function view(o: Partial<Order> = {}, patch: Partial<OrderTracking> = {}): OrderTracking {
  return {
    order: order(o),
    items: [],
    merchant: { id: 'rest_1', name: 'مطعم خالد', pin: KITCHEN },
    dropoff: { zoneKey: 'zakur', pin: HOME },
    trip: null,
    courier: null,
    reassigning: false,
    promisedAt: null,
    pointsEarned: null,
    serverNow: T0,
    ...patch,
  };
}

function trip(state: NonNullable<OrderTracking['trip']>['state'], extra: Partial<NonNullable<OrderTracking['trip']>> = {}): NonNullable<OrderTracking['trip']> {
  return {
    id: 'trp_1',
    state,
    acceptedAt: at(3),
    completedAt: null,
    stops: [
      { id: 's1', seq: 0, type: 'pickup', state: 'pending', mine: true, target: KITCHEN, arrivedAt: null, completedAt: null },
      { id: 's2', seq: 1, type: 'dropoff', state: 'pending', mine: true, target: HOME, arrivedAt: null, completedAt: null },
    ],
    dropsBeforeMine: 0,
    unreachable: null,
    ...extra,
  };
}

const courier = { firstName: 'حيدر', vehicleClass: 'bike' as const, plate: 'واسط 12345', vehicleLabel: null, rating: null, ratingCount: 0, verifiedTodayAt: T0, photoUrl: null };

describe('geo — interpolation and bearing', () => {
  it('bearing is clockwise from north', () => {
    const o = { lat: 32.9, lng: 45.06 };
    expect(bearingDeg(o, { lat: 32.91, lng: 45.06 })).toBeCloseTo(0, 0);
    expect(bearingDeg(o, { lat: 32.9, lng: 45.07 })).toBeCloseTo(90, 0);
    expect(bearingDeg(o, { lat: 32.89, lng: 45.06 })).toBeCloseTo(180, 0);
    expect(bearingDeg(o, { lat: 32.9, lng: 45.05 })).toBeCloseTo(270, 0);
  });

  it('turns the short way round', () => {
    expect(nearestAngle(350, 10)).toBe(370);
    expect(nearestAngle(10, 350)).toBe(-10);
    expect(Math.abs(nearestAngle(90, 270) - 90)).toBe(180); // a U-turn either way
    expect(nearestAngle(720, 0)).toBe(720);
  });

  it('glides linearly from where the marker is to the new fix, heading from the device or the travel direction', () => {
    const start = { pos: { lat: 32.9, lng: 45.06 }, heading: 350 };
    const east = nextGlide(start, { lat: 32.9, lng: 45.061 });
    expect(east.toHeading).toBeCloseTo(450, 0); // 90° reached by turning +100°, not −260°
    const mid = glideAt(east, 0.5);
    expect(mid.pos.lng).toBeCloseTo(45.0605, 6);
    expect(mid.heading).toBeCloseTo(400, 0);
    expect(glideAt(east, 2).pos).toEqual(east.to); // clamped
    // a reported bearing wins over the travel direction
    expect(nextGlide(start, { lat: 32.9, lng: 45.061, bearing: 0 }).toHeading).toBe(360);
    // standing still keeps the old heading (no spinning on GPS noise)
    expect(nextGlide(start, { lat: 32.900001, lng: 45.06 }).toHeading).toBe(350);
  });

  it('projects like MapLibre (512-px Web Mercator) and round-trips', () => {
    const cam = { lat: 32.9, lng: 45.065, zoom: 15 };
    const size = { w: 390, h: 500 };
    expect(project(cam.lat, cam.lng, cam, size)).toEqual({ x: 195, y: 250 });
    const p = project(HOME.lat, HOME.lng, cam, size);
    expect(p.x).toBeGreaterThan(195); // east → right
    expect(p.y).toBeGreaterThan(250); // south → down
    const back = unproject(p, cam, size);
    expect(back.lat).toBeCloseTo(HOME.lat, 6);
    expect(back.lng).toBeCloseTo(HOME.lng, 6);
  });

  it('carries a layer drawn for one camera to another (pan + zoom) with one transform', () => {
    const size = { w: 390, h: 520 };
    const drawn = { lat: 32.9, lng: 45.065, zoom: 14 };
    const live = { lat: 32.895, lng: 45.07, zoom: 15.3 };
    const { tx, ty, s } = layerTransform(drawn, live, size);
    for (const pt of [KITCHEN, HOME]) {
      const p = project(pt.lat, pt.lng, drawn, size);
      // RN: translate, then scale about the centre
      const x = size.w / 2 + tx + s * (p.x - size.w / 2);
      const y = size.h / 2 + ty + s * (p.y - size.h / 2);
      const want = project(pt.lat, pt.lng, live, size);
      expect(x).toBeCloseTo(want.x, 6);
      expect(y).toBeCloseTo(want.y, 6);
    }
  });

  it('fits points inside the padded view', () => {
    const size = { w: 390, h: 520 };
    const pad = { top: 60, right: 40, bottom: 200, left: 40 };
    const cam = fitCamera([KITCHEN, HOME], size, pad);
    for (const pt of [KITCHEN, HOME]) {
      const p = project(pt.lat, pt.lng, cam, size);
      expect(p.x).toBeGreaterThanOrEqual(pad.left - 1);
      expect(p.x).toBeLessThanOrEqual(size.w - pad.right + 1);
      expect(p.y).toBeGreaterThanOrEqual(pad.top - 1);
      expect(p.y).toBeLessThanOrEqual(size.h - pad.bottom + 1);
    }
    expect(fitCamera([HOME], size, pad).zoom).toBe(16.5);
  });

  it('shortens the route as the courier moves along it', () => {
    const route = [KITCHEN, { lat: 32.9, lng: 45.07 }, HOME];
    const onFirstLeg = { lat: 32.905, lng: 45.0667 };
    expect(remainingRoute(route, onFirstLeg)).toEqual([onFirstLeg, route[1], HOME]);
    const onSecondLeg = { lat: 32.893, lng: 45.073 };
    expect(remainingRoute(route, onSecondLeg)).toEqual([onSecondLeg, HOME]);
    expect(distanceM(KITCHEN, HOME)).toBeGreaterThan(2000);
  });
});

describe('status → timeline', () => {
  it('waiting for the kitchen: placed is current with the hint', () => {
    const v = view();
    const tl = buildTimeline(v, { eta: null, lateMin: 0, courierName: null }, t, clock);
    expect(tl.current).toBe('placed');
    expect(tl.steps.map((s) => s.key)).toEqual(['placed', 'accepted', 'preparing', 'picked_up', 'delivered']);
    expect(tl.steps[0]).toMatchObject({ time: '09:00', note: t('order.status.placed_hint') });
    expect(phaseOf(v)).toBe('waiting_merchant');
  });

  it('preparing with a courier on his way to the kitchen, real timestamps on done steps and an ETA on the last', () => {
    const v = view({ state: 'preparing', acceptedAt: at(1), preparingAt: at(2), promisedReadyAt: at(17) }, { trip: trip('en_route_to_pickup'), courier });
    const tl = buildTimeline(v, { eta: at(30), lateMin: 0, courierName: 'حيدر' }, t, clock);
    expect(tl.current).toBe('preparing');
    expect(tl.steps.find((s) => s.key === 'accepted')?.time).toBe('09:01');
    expect(tl.steps.find((s) => s.key === 'preparing')).toMatchObject({ time: '09:02', note: 'حيدر رايح للمطعم يستلم طلبك' });
    expect(tl.steps.find((s) => s.key === 'delivered')?.time).toBe('~09:30');
    expect(statusLine(v, t)).toBe(t('order.status.preparing'));
  });

  it('on the way: honest delay text on the current step when the live ETA runs past the promise', () => {
    const v = view({ state: 'picked_up', acceptedAt: at(1), preparingAt: at(2), readyAt: at(15), pickedUpAt: at(16) }, { trip: trip('in_transit'), courier, promisedAt: at(25) });
    const tl = buildTimeline(v, { eta: at(33), lateMin: lateMinutes(at(33), at(25)), courierName: 'حيدر' }, t, clock);
    expect(tl.current).toBe('picked_up');
    const step = tl.steps.find((s) => s.key === 'picked_up')!;
    expect(step.late).toBe(true);
    expect(step.note).toContain('تأخرنا 8 دقيقة');
    expect(step.note).toContain('09:33');
    expect(phaseOf(v)).toBe('on_the_way');
  });

  it('batched courier: says another drop comes first', () => {
    const v = view({ state: 'picked_up', pickedUpAt: at(16) }, { trip: trip('in_transit', { dropsBeforeMine: 1 }), courier });
    const tl = buildTimeline(v, { eta: at(30), lateMin: 0, courierName: 'حيدر' }, t, clock);
    expect(tl.steps.find((s) => s.key === 'picked_up')?.note).toBe(t('order.eta_batched', { time: '09:30' }));
  });

  it('delivered: everything done, the last step carries the real time', () => {
    const v = view({ state: 'delivered', acceptedAt: at(1), preparingAt: at(2), readyAt: at(15), pickedUpAt: at(16), deliveredAt: at(29) });
    const tl = buildTimeline(v, { eta: null, lateMin: 0, courierName: null }, t, clock);
    expect(tl.current).toBe('delivered');
    expect(tl.steps.at(-1)).toMatchObject({ label: t('order.status.delivered'), time: '09:29' });
    expect(phaseOf(v)).toBe('arrived');
  });

  it('unreachable, reassigning, cancelled phases', () => {
    const unreachable = { stopId: 's2', startedAt: at(20), escalatedAt: null, escalateAt: at(23), failAllowedAt: at(25) };
    expect(phaseOf(view({ state: 'picked_up', pickedUpAt: at(16) }, { trip: trip('arrived_dropoff', { unreachable }), courier }))).toBe('unreachable');
    expect(phaseOf(view({ state: 'preparing' }, { reassigning: true }))).toBe('reassigning');
    expect(phaseOf(view({ state: 'merchant_rejected' }))).toBe('cancelled');
    expect(statusLine(view({ state: 'merchant_rejected' }), t)).toBe(t('order.status.merchant_rejected'));
  });

  it('rides: searching → coming → arrived → in transit → completed', () => {
    const ride = (state: NonNullable<OrderTracking['trip']>['state'], o: Partial<Order> = {}) =>
      view({ type: 'ride', merchantOrgId: null, state: 'matched', ...o }, { merchant: null, trip: trip(state), courier });
    expect(buildTimeline(view({ type: 'ride', state: 'placed' }, { merchant: null }), { eta: null, lateMin: 0, courierName: null }, t, clock).current).toBe('searching');
    expect(buildTimeline(ride('en_route_to_pickup'), { eta: null, lateMin: 0, courierName: 'علي' }, t, clock).current).toBe('matched');
    expect(buildTimeline(ride('arrived_pickup'), { eta: null, lateMin: 0, courierName: 'علي' }, t, clock).current).toBe('arrived_pickup');
    expect(buildTimeline(ride('in_transit'), { eta: null, lateMin: 0, courierName: 'علي' }, t, clock).current).toBe('in_transit');
    expect(buildTimeline(ride('completed', { state: 'completed' }), { eta: null, lateMin: 0, courierName: 'علي' }, t, clock).current).toBe('completed');
    expect(phaseOf(ride('arrived_pickup'))).toBe('at_pickup');
  });
});

describe('eta', () => {
  it('before pickup: the later of courier-at-kitchen and ready time, plus the ride to the door', () => {
    const v = view({ state: 'preparing', promisedReadyAt: at(15) }, { trip: trip('en_route_to_pickup'), courier });
    const eta = liveEta(v, KITCHEN, T0)!;
    const minutes = (eta.getTime() - T0.getTime()) / MIN;
    expect(minutes).toBeGreaterThan(15);
    expect(minutes).toBeLessThan(30);
  });

  it('after pickup: from the courier to the door, plus earlier batched drops', () => {
    const v = view({ state: 'picked_up', pickedUpAt: at(16) }, { trip: trip('in_transit'), courier });
    const near = liveEta(v, { lat: 32.888, lng: 45.076 }, T0)!;
    expect(near.getTime() - T0.getTime()).toBe(MIN); // at least one minute
    const batched = liveEta(view({ state: 'picked_up', pickedUpAt: at(16) }, { trip: trip('in_transit', { dropsBeforeMine: 2 }), courier }), { lat: 32.888, lng: 45.076 }, T0)!;
    expect(batched.getTime() - T0.getTime()).toBe(9 * MIN);
    expect(liveEta(view({ state: 'delivered', deliveredAt: at(20) }), null, T0)).toBeNull();
  });

  it('late only beyond five minutes past the promise; signal lost after 45 s', () => {
    expect(lateMinutes(at(30), at(25))).toBe(0);
    expect(lateMinutes(at(31), at(25))).toBe(6);
    expect(lateMinutes(null, at(25))).toBe(0);
    expect(signalLostMinutes(10)).toBeNull();
    expect(signalLostMinutes(50)).toBe(1);
    expect(signalLostMinutes(125)).toBe(2);
  });
});
