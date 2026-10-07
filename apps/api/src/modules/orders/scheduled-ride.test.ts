import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { HOME, KITCHEN, ordersHarness } from './test-harness.js';

const PICKUP = { zoneKey: 'centre', pin: KITCHEN };
const DROPOFF = { zoneKey: 'street_30', pin: HOME };
const MIN = 60_000;

async function code(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DriverError);
  return (err as DriverError).code;
}

function harness() {
  const h = ordersHarness();
  // The ride-habits module binds this in the app: c1's favourite «fav_1» is driver d_abbas.
  h.orders.bindFavourites({ driverFor: async (personId, favouriteId) => (personId === 'c1' && favouriteId === 'fav_1' ? 'd_abbas' : null) });
  return h;
}

async function ride(h: ReturnType<typeof harness>, extra: { scheduledFor?: Date; favouriteId?: string } = {}) {
  const fare = (await h.orders.quote('c1', { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', pickup: PICKUP, dropoff: DROPOFF, ...(extra.scheduledFor ? { scheduledFor: extra.scheduledFor } : {}) })).totalIqd;
  return h.orders.place('c1', { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', fareIqd: fare, pickup: PICKUP, dropoff: DROPOFF, ...extra });
}

describe('rides booked for later (joy J7d)', () => {
  it('books 20 minutes to 7 days ahead and tells dispatch when', async () => {
    const h = harness();
    const at = new Date(h.clock.now().getTime() + 24 * 60 * MIN);
    const o = await ride(h, { scheduledFor: at });
    expect(o).toMatchObject({ type: 'ride', state: 'placed', scheduledFor: at });
    expect(h.events.last('order.placed')?.payload).toMatchObject({ scheduledFor: at.toISOString(), ride: { vertical: 'taxi', preferDriverId: null } });
  });

  it('refuses a time too soon or too far', async () => {
    const h = harness();
    expect(await code(ride(h, { scheduledFor: new Date(h.clock.now().getTime() + 19 * MIN) }))).toBe('ride_schedule_invalid');
    expect(await code(ride(h, { scheduledFor: new Date(h.clock.now().getTime() + 8 * 24 * 60 * MIN) }))).toBe('ride_schedule_invalid');
  });

  it('is priced by the server for its own time', async () => {
    const h = harness();
    const at = new Date(h.clock.now().getTime() + 3 * 60 * MIN);
    const fare = (await h.orders.quote('c1', { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', pickup: PICKUP, dropoff: DROPOFF, scheduledFor: at })).totalIqd;
    expect(await code(h.orders.place('c1', { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', fareIqd: fare + 500, pickup: PICKUP, dropoff: DROPOFF, scheduledFor: at }))).toBe('price_changed');
  });
});

describe('asking for a favourite driver (joy l9)', () => {
  it('a booked ride carries the favourite to dispatch and keeps it on the order', async () => {
    const h = harness();
    const o = await ride(h, { scheduledFor: new Date(h.clock.now().getTime() + 60 * MIN), favouriteId: 'fav_1' });
    expect(o.preferredDriverId).toBe('d_abbas');
    expect(h.events.last('order.placed')?.payload).toMatchObject({ ride: { preferDriverId: 'd_abbas' } });
  });

  it('never on a ride for now', async () => {
    const h = harness();
    expect(await code(ride(h, { favouriteId: 'fav_1' }))).toBe('favourite_needs_schedule');
  });

  it("only one of the rider's own favourites", async () => {
    const h = harness();
    expect(await code(ride(h, { scheduledFor: new Date(h.clock.now().getTime() + 60 * MIN), favouriteId: 'fav_someone' }))).toBe('favourite_not_found');
  });

  it('never on a food order', async () => {
    const h = harness();
    expect(await code(h.orders.place('c1', { cityId: 'aziziyah', type: 'errand', favouriteId: 'fav_1', lines: [{ freeText: 'خبز', qty: 1 }], pickup: PICKUP, dropoff: DROPOFF }))).toBe('favourite_needs_schedule');
  });
});
