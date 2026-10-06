import { describe, expect, it } from 'vitest';
import { DriverError, SharedTrip, type Actor } from '@driver/contracts';
import { ordersHarness } from '../orders/test-harness.js';
import { InMemoryShareLinksRepository, ShareLinksService, expiryOf, type ShareIntercityPort } from './share-links.js';
import { EtaService, StraightLineRouter } from '../routing/index.js';
import type { Router } from '../routing/routing.port.js';
import { InMemoryCourierVehicles } from './vehicles.js';

const MIN = 60_000;
const as = (personId: string): Actor => ({ personId, sessionId: `s-${personId}` });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

function setup(router: Router = new StraightLineRouter()) {
  const h = ordersHarness();
  const vehicles = new InMemoryCourierVehicles();
  vehicles.register('d1', { vehicleClass: 'car', plate: '12345 واسط', label: 'Toyota Corolla · أبيض' });
  const reads: Array<{ personId: string; accessorId: string; purpose: string }> = [];
  const departures = new Map<string, Awaited<ReturnType<ShareIntercityPort['departure']>>>();
  const bookings = new Map<string, Awaited<ReturnType<ShareIntercityPort['booking']>>>();
  const intercity: ShareIntercityPort = {
    booking: async (id) => {
      const b = bookings.get(id);
      if (!b) throw new DriverError('booking_not_found');
      return b;
    },
    departure: async (id) => departures.get(id)!,
    boardingWindowMin: () => 30,
    travelMin: () => 120,
  };
  const repo = new InMemoryShareLinksRepository();
  // The customer's own ETA (TrackingService.liveEta), 12 minutes out, and the calls it got.
  const etaCalls: Array<{ orderId: string; pin: { lat: number; lng: number } }> = [];
  const share = new ShareLinksService(
    repo,
    h.orders,
    h.trips,
    {
      firstNamesFor: async (ids, accessorId, purpose) => {
        for (const id of ids) reads.push({ personId: id, accessorId, purpose });
        return Object.fromEntries(ids.map((id) => [id, id === 'd1' ? 'حيدر' : id === 'drv' ? 'مصطفى' : null]));
      },
      // Only d1 has an approved main photo (Ali, 2026-10-06).
      mainPhotoRefs: async (ids, accessorId, purpose) => {
        const out: Record<string, string> = {};
        for (const id of ids) if (id === 'd1') {
          reads.push({ personId: id, accessorId, purpose: `${purpose}:photo` });
          out[id] = 'up_d1';
        }
        return out;
      },
    },
    vehicles,
    intercity,
    'test-secret',
    h.clock,
    new EtaService(router),
    { merchant: (id) => (id === 'rest_1' ? { name: 'مطعم خالد', pin: null } : null), itemNames: async () => new Map() },
    {
      liveEta: async (order, _trip, pin, now) => {
        etaCalls.push({ orderId: order.id, pin });
        return { at: new Date(now.getTime() + 12 * MIN) };
      },
    },
    { readUrl: (ref) => `/files/${ref}?exp=1&sig=x` },
  );
  return { h, share, repo, reads, departures, bookings, etaCalls };
}

type S = ReturnType<typeof setup>;

async function ride(s: S) {
  const o = await s.h.orders.place('c1', { cityId: 'aziziyah', type: 'ride', pickup: { zoneKey: 'centre' }, dropoff: { zoneKey: 'zakur' } });
  return o;
}

describe('ShareLinksService — rides', () => {
  it('only the rider shares, and sharing twice hands back the same link', async () => {
    const s = setup();
    const o = await ride(s);
    expect(await code(s.share.createShareLink(as('stranger'), { orderId: o.id }))).toBe('order_not_found');
    const a = await s.share.createShareLink(as('c1'), { orderId: o.id });
    expect(a.path).toBe(`/share/${a.token}`);
    expect(a.subject).toBe('ride');
    expect(a.expiresAt).toEqual(new Date(a.createdAt.getTime() + 24 * 3_600_000));
    expect((await s.share.createShareLink(as('c1'), { orderId: o.id })).token).toBe(a.token);
  });

  it('shows coarse data only: first name, vehicle, plate, live car inside the window, where it is heading, ETA', async () => {
    const s = setup();
    const o = await ride(s);
    const link = await s.share.createShareLink(as('c1'), { orderId: o.id });
    const waiting = await s.share.shared({ token: link.token });
    expect(waiting).toMatchObject({ status: 'waiting', driverFirstName: null, driverPhotoUrl: null, position: null });

    const trip = await s.h.tripFor(o.id, { vertical: 'taxi', vehicleClass: 'car' });
    await s.h.trips.reportPosition('d1', { tripId: trip.id, pin: { lat: 32.905, lng: 45.06 }, at: s.h.clock.now() });
    const coming = await s.share.shared({ token: link.token });
    expect(coming).toMatchObject({ status: 'to_pickup', driverFirstName: 'حيدر', driverPhotoUrl: '/files/up_d1?exp=1&sig=x', vehicleClass: 'car', plate: '12345 واسط', vehicleLabel: 'Toyota Corolla · أبيض', route: null });
    expect(coming.position).toMatchObject({ lat: 32.905, lng: 45.06, ageSec: 0 });
    // Heading to the rider first (maps program c9): a pin, never an address.
    const pickupPin = trip.stops.find((st) => st.type === 'pickup')!.target!;
    expect(coming.target).toEqual({ lat: pickupPin.lat, lng: pickupPin.lng, kind: 'pickup' });
    expect(coming.eta!.getTime()).toBeGreaterThan(s.h.clock.now().getTime());
    // Exactly the public shape: no phone, no full name, no address in words, no rider.
    expect(Object.keys(SharedTrip.parse(coming)).sort()).toEqual(['driverFirstName', 'driverPhotoUrl', 'endedReason', 'eta', 'expiresAt', 'plate', 'position', 'route', 'serverNow', 'status', 'storeName', 'subject', 'target', 'vehicleClass', 'vehicleLabel']);
    expect(JSON.stringify(coming)).not.toMatch(/\+964|07\d{9}|c1|zakur/);

    await s.h.pickup(trip.id);
    const riding = await s.share.shared({ token: link.token });
    expect(riding.status).toBe('on_trip');
    const dropPin = trip.stops.find((st) => st.type === 'dropoff')!.target!;
    expect(riding.target).toEqual({ lat: dropPin.lat, lng: dropPin.lng, kind: 'dropoff' });
    // The first-name and photo reads are logged against the link, once (not once per poll).
    await s.share.shared({ token: link.token });
    expect(s.reads).toEqual([
      { personId: 'd1', accessorId: expect.stringMatching(/^share:shr_/), purpose: 'share_trip' },
      { personId: 'd1', accessorId: expect.stringMatching(/^share:shr_/), purpose: 'share_trip:photo' },
    ]);
  });

  it('expires 30 minutes after the ride completes; no position after drop-off', async () => {
    const s = setup();
    const o = await ride(s);
    const trip = await s.h.tripFor(o.id, { vertical: 'taxi' });
    const link = await s.share.createShareLink(as('c1'), { orderId: o.id });
    await s.h.pickup(trip.id);
    await s.h.dropoff(trip.id);
    const done = await s.share.shared({ token: link.token });
    expect(done).toMatchObject({ status: 'arrived', position: null, eta: null });
    const completedAt = (await s.h.trips.get(trip.id)).completedAt!;
    expect(done.expiresAt).toEqual(new Date(completedAt.getTime() + 30 * MIN));
    expect(await code(s.share.createShareLink(as('c1'), { orderId: o.id }))).toBe('share_trip_over');
    s.h.clock.advance(31 * MIN);
    expect(await s.share.shared({ token: link.token })).toMatchObject({ status: 'ended', endedReason: 'expired', driverFirstName: null, plate: null });
  });

  it('the rider can revoke; a forged or unknown token is refused', async () => {
    const s = setup();
    const o = await ride(s);
    await s.h.tripFor(o.id, { vertical: 'taxi' });
    const link = await s.share.createShareLink(as('c1'), { orderId: o.id });
    expect(await code(s.share.revokeShareLink(as('stranger'), { token: link.token }))).toBe('share_link_invalid');
    const revoked = await s.share.revokeShareLink(as('c1'), { token: link.token });
    expect(revoked.revokedAt).not.toBeNull();
    expect(await s.share.shared({ token: link.token })).toMatchObject({ status: 'ended', endedReason: 'revoked', driverFirstName: null });
    const [id] = link.token.split('.');
    expect(await code(s.share.shared({ token: `${id}.forged` }))).toBe('share_link_invalid');
    expect(await code(s.share.shared({ token: 'shr_nope.abc' }))).toBe('share_link_invalid');
    expect(await code(s.share.shared({ token: 'garbage' }))).toBe('share_link_invalid');
    // A new link after revoking is a new token.
    expect((await s.share.createShareLink(as('c1'), { orderId: o.id })).token).not.toBe(link.token);
  });

  it('counts page opens, not the page’s refreshes or its live stream', async () => {
    const s = setup();
    const o = await ride(s);
    const link = await s.share.createShareLink(as('c1'), { orderId: o.id });
    await s.share.shared({ token: link.token });
    await s.share.shared({ token: link.token });
    for (let i = 0; i < 5; i++) await s.share.shared({ token: link.token, again: true });
    expect((await s.share.createShareLink(as('c1'), { orderId: o.id })).views).toBe(2);
  });

  it('the road from the car to where it is heading, only while there is both', async () => {
    const calls: Array<readonly { lat: number; lng: number }[]> = [];
    const road: Router = {
      route: async (points) => {
        calls.push(points);
        return { distanceM: 900, durationS: 120, polyline6: 'road6', basis: 'road' };
      },
      table: async () => ({ durationsS: [], distancesM: [], basis: 'road' }),
    };
    const s = setup(road);
    const o = await ride(s);
    const link = await s.share.createShareLink(as('c1'), { orderId: o.id });
    expect(await s.share.sharedRoute({ token: link.token })).toMatchObject({ polyline6: null, from: null });
    const trip = await s.h.tripFor(o.id, { vertical: 'taxi', vehicleClass: 'car' });
    const car = { lat: 32.905, lng: 45.06 };
    await s.h.trips.reportPosition('d1', { tripId: trip.id, pin: car, at: s.h.clock.now() });
    calls.length = 0;
    const r = await s.share.sharedRoute({ token: link.token });
    expect(r).toMatchObject({ polyline6: 'road6', basis: 'road', from: car });
    const pickupPin = trip.stops.find((st) => st.type === 'pickup')!.target!;
    expect(calls).toContainEqual([car, { lat: pickupPin.lat, lng: pickupPin.lng }]);
    await s.share.revokeShareLink(as('c1'), { token: link.token });
    expect(await s.share.sharedRoute({ token: link.token })).toMatchObject({ polyline6: null });
    expect(await code(s.share.sharedRoute({ token: 'garbage' }))).toBe('share_link_invalid');
  });

  it('live channels: a ride listens on its order; a forged token is refused', async () => {
    const s = setup();
    const o = await ride(s);
    const link = await s.share.createShareLink(as('c1'), { orderId: o.id });
    expect(await s.share.liveChannels({ token: link.token })).toEqual([`order:${o.id}`]);
    expect(await code(s.share.liveChannels({ token: `${link.token.split('.')[0]}.forged` }))).toBe('share_link_invalid');
  });
});

describe('ShareLinksService — deliveries (maps program SP3c)', () => {
  it('the customer shares a delivery; the family follows it: preparing, collecting, on the way, delivered', async () => {
    const s = setup();
    const o = await s.h.orders.place('c1', s.h.foodInput());
    expect(await code(s.share.createShareLink(as('stranger'), { orderId: o.id }))).toBe('order_not_found');
    const link = await s.share.createShareLink(as('c1'), { orderId: o.id });
    expect(link.subject).toBe('delivery');
    expect(await s.share.liveChannels({ token: link.token })).toEqual([`order:${o.id}`]);

    // Being prepared: the store's name, no courier yet.
    expect(await s.share.shared({ token: link.token })).toMatchObject({ status: 'waiting', subject: 'delivery', storeName: 'مطعم خالد', driverFirstName: null, position: null, target: null, eta: null });

    // A courier takes it: on his way to the store, the store's pin, the customer's own ETA.
    const trip = await s.h.tripFor(o.id);
    const car = { lat: 32.905, lng: 45.06 };
    await s.h.trips.reportPosition('d1', { tripId: trip.id, pin: car, at: s.h.clock.now() });
    const collecting = await s.share.shared({ token: link.token });
    const kitchen = trip.stops.find((st) => st.type === 'pickup')!.target!;
    expect(collecting).toMatchObject({ status: 'to_pickup', driverFirstName: 'حيدر', target: { lat: kitchen.lat, lng: kitchen.lng, kind: 'pickup' } });
    expect(collecting.position).toMatchObject(car);
    expect(collecting.eta).toEqual(new Date(s.h.clock.now().getTime() + 12 * MIN));
    expect(s.etaCalls.at(-1)).toEqual({ orderId: o.id, pin: car });
    // Coarse data only: no phone, no customer, no address in words, nothing ordered.
    expect(JSON.stringify(collecting)).not.toMatch(/\+964|07\d{9}|c1|zakur|kebab|tikka/);
    expect((await s.share.sharedRoute({ token: link.token })).from).toEqual(car);

    // Collected: heading to the door.
    await s.h.pickup(trip.id);
    const door = trip.stops.find((st) => st.type === 'dropoff')!.target!;
    expect(await s.share.shared({ token: link.token })).toMatchObject({ status: 'on_trip', target: { lat: door.lat, lng: door.lng, kind: 'dropoff' } });

    // Delivered: no car any more, the link lasts 30 minutes from the delivery.
    await s.h.dropoff(trip.id, { cashCollectedIqd: (await s.h.orders.get(o.id)).totalIqd });
    const done = await s.share.shared({ token: link.token });
    const deliveredAt = (await s.h.trips.get(trip.id)).stops.find((st) => st.type === 'dropoff')!.completedAt!;
    expect(done).toMatchObject({ status: 'arrived', position: null, eta: null, storeName: 'مطعم خالد' });
    expect(done.expiresAt).toEqual(new Date(deliveredAt.getTime() + 30 * MIN));
    expect(await code(s.share.createShareLink(as('c1'), { orderId: o.id }))).toBe('share_trip_over');
  });

  it('a cancelled delivery ends the page', async () => {
    const s = setup();
    const o = await s.h.orders.place('c1', s.h.foodInput());
    const link = await s.share.createShareLink(as('c1'), { orderId: o.id });
    await s.h.orders.cancel('c1', { orderId: o.id });
    expect(await s.share.shared({ token: link.token })).toMatchObject({ status: 'ended', endedReason: 'cancelled', storeName: null });
  });
});

describe('ShareLinksService — الرجعة', () => {
  it('shares the car from the boarding window to arrival, with the corridor ETA', async () => {
    const s = setup();
    const departAt = new Date(s.h.clock.now().getTime() + 60 * MIN);
    const dep = {
      driverId: 'drv',
      corridorId: 'aziziyah_baghdad',
      fromCityId: 'aziziyah',
      toCityId: 'baghdad',
      state: 'scheduled',
      departAt,
      departedAt: null as Date | null,
      arrivedAt: null as Date | null,
      closedAt: null,
      cancelledAt: null,
      vehicle: { plate: '55123 بغداد', model: 'Hyundai Elantra', color: 'فضي' },
      lastPosition: { lat: 32.91, lng: 45.07, at: s.h.clock.now() },
    };
    s.departures.set('dep1', dep);
    s.bookings.set('b1', { riderId: 'c1', departureId: 'dep1', state: 'booked' });
    expect(await code(s.share.createShareLink(as('c2'), { bookingId: 'b1' }))).toBe('booking_not_found');
    const link = await s.share.createShareLink(as('c1'), { bookingId: 'b1' });
    // Before T−30: the driver and the car, but not where it is.
    expect(await s.share.shared({ token: link.token })).toMatchObject({ status: 'waiting', subject: 'intercity', driverFirstName: 'مصطفى', plate: '55123 بغداد', vehicleLabel: 'Hyundai Elantra · فضي', position: null, target: null, route: { fromCityId: 'aziziyah', toCityId: 'baghdad' } });
    // Intercity positions are not on the live bus: the stream re-reads on its timer.
    expect(await s.share.liveChannels({ token: link.token })).toEqual([]);
    s.h.clock.advance(31 * MIN);
    expect((await s.share.shared({ token: link.token })).position).toMatchObject({ lat: 32.91, lng: 45.07 });
    dep.state = 'departed';
    dep.departedAt = s.h.clock.now();
    const going = await s.share.shared({ token: link.token });
    expect(going.status).toBe('on_trip');
    expect(going.eta).toEqual(new Date(dep.departedAt.getTime() + 120 * MIN));
    dep.state = 'arrived';
    dep.arrivedAt = s.h.clock.now();
    expect(await s.share.shared({ token: link.token })).toMatchObject({ status: 'arrived', position: null });
    s.h.clock.advance(30 * MIN);
    expect((await s.share.shared({ token: link.token })).endedReason).toBe('expired');
  });

  it('expiry is completion + 30 min, capped at 24 h', () => {
    const created = new Date('2026-10-04T08:00:00Z');
    expect(expiryOf(created, null)).toEqual(new Date('2026-10-05T08:00:00Z'));
    expect(expiryOf(created, new Date('2026-10-04T09:00:00Z'))).toEqual(new Date('2026-10-04T09:30:00Z'));
    expect(expiryOf(created, new Date('2026-10-05T09:00:00Z'))).toEqual(new Date('2026-10-05T08:00:00Z'));
  });
});
