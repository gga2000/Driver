import { describe, expect, it } from 'vitest';
import { DriverError, SharedTrip, type Actor } from '@driver/contracts';
import { ordersHarness } from '../orders/test-harness.js';
import { InMemoryShareLinksRepository, ShareLinksService, expiryOf, type ShareIntercityPort } from './share-links.js';
import { EtaService, StraightLineRouter } from '../routing/index.js';
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

function setup() {
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
  const share = new ShareLinksService(
    repo,
    h.orders,
    h.trips,
    {
      firstNamesFor: async (ids, accessorId, purpose) => {
        for (const id of ids) reads.push({ personId: id, accessorId, purpose });
        return Object.fromEntries(ids.map((id) => [id, id === 'd1' ? 'حيدر' : id === 'drv' ? 'مصطفى' : null]));
      },
    },
    vehicles,
    intercity,
    'test-secret',
    h.clock,
    new EtaService(new StraightLineRouter()),
  );
  return { h, share, repo, reads, departures, bookings };
}

type S = ReturnType<typeof setup>;

async function ride(s: S) {
  const o = await s.h.orders.place('c1', { cityId: 'aziziyah', type: 'ride', pickup: { zoneKey: 'centre' }, dropoff: { zoneKey: 'zakur' } });
  return o;
}

describe('ShareLinksService — rides', () => {
  it('only the rider shares, only rides, and sharing twice hands back the same link', async () => {
    const s = setup();
    const o = await ride(s);
    expect(await code(s.share.createShareLink(as('stranger'), { orderId: o.id }))).toBe('order_not_found');
    const food = await s.h.orders.place('c1', s.h.foodInput());
    expect(await code(s.share.createShareLink(as('c1'), { orderId: food.id }))).toBe('share_not_shareable');
    const a = await s.share.createShareLink(as('c1'), { orderId: o.id });
    expect(a.path).toBe(`/share/${a.token}`);
    expect(a.subject).toBe('ride');
    expect(a.expiresAt).toEqual(new Date(a.createdAt.getTime() + 24 * 3_600_000));
    expect((await s.share.createShareLink(as('c1'), { orderId: o.id })).token).toBe(a.token);
  });

  it('shows coarse data only: first name, vehicle, plate, live car inside the window, ETA', async () => {
    const s = setup();
    const o = await ride(s);
    const link = await s.share.createShareLink(as('c1'), { orderId: o.id });
    const waiting = await s.share.shared({ token: link.token });
    expect(waiting).toMatchObject({ status: 'waiting', driverFirstName: null, position: null });

    const trip = await s.h.tripFor(o.id, { vertical: 'taxi', vehicleClass: 'car' });
    await s.h.trips.reportPosition('d1', { tripId: trip.id, pin: { lat: 32.905, lng: 45.06 }, at: s.h.clock.now() });
    const coming = await s.share.shared({ token: link.token });
    expect(coming).toMatchObject({ status: 'to_pickup', driverFirstName: 'حيدر', vehicleClass: 'car', plate: '12345 واسط', vehicleLabel: 'Toyota Corolla · أبيض', route: null });
    expect(coming.position).toMatchObject({ lat: 32.905, lng: 45.06, ageSec: 0 });
    expect(coming.eta!.getTime()).toBeGreaterThan(s.h.clock.now().getTime());
    // Exactly the public shape: no phone, no full name, no address, no rider.
    expect(Object.keys(SharedTrip.parse(coming)).sort()).toEqual(['driverFirstName', 'endedReason', 'eta', 'expiresAt', 'plate', 'position', 'route', 'serverNow', 'status', 'subject', 'vehicleClass', 'vehicleLabel']);
    expect(JSON.stringify(coming)).not.toMatch(/\+964|07\d{9}|c1|zakur/);

    await s.h.pickup(trip.id);
    expect((await s.share.shared({ token: link.token })).status).toBe('on_trip');
    // The first-name read is logged against the link, once (not once per poll).
    await s.share.shared({ token: link.token });
    expect(s.reads).toEqual([{ personId: 'd1', accessorId: expect.stringMatching(/^share:shr_/), purpose: 'share_trip' }]);
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

  it('counts views', async () => {
    const s = setup();
    const o = await ride(s);
    const link = await s.share.createShareLink(as('c1'), { orderId: o.id });
    await s.share.shared({ token: link.token });
    await s.share.shared({ token: link.token });
    expect((await s.share.createShareLink(as('c1'), { orderId: o.id })).views).toBe(2);
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
    expect(await s.share.shared({ token: link.token })).toMatchObject({ status: 'waiting', subject: 'intercity', driverFirstName: 'مصطفى', plate: '55123 بغداد', vehicleLabel: 'Hyundai Elantra · فضي', position: null, route: { fromCityId: 'aziziyah', toCityId: 'baghdad' } });
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
