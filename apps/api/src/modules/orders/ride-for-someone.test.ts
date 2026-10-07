import { describe, expect, it } from 'vitest';
import { DriverError, type PlaceOrderInput } from '@driver/contracts';
import { HOME, KITCHEN, ordersHarness } from './test-harness.js';

const PICKUP = { zoneKey: 'centre', pin: KITCHEN };
const DROPOFF = { zoneKey: 'street_30', pin: HOME };
const SEC = 1000;

async function code(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DriverError);
  return (err as DriverError).code;
}

function ride(rider?: PlaceOrderInput['rider'], patch: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', fareIqd: 3000, pickup: PICKUP, dropoff: DROPOFF, ...(rider ? { rider } : {}), ...patch };
}

describe('ride ideas c9/s3: a ride booked for someone else', () => {
  it('a typed name and number: the rider is a person on the ride, the name only in the vault', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', ride({ from: 'typed', name: '  ماما ', phone: '0770 555 4433' }));
    expect(o.ordererId).toBe('c1');
    const rider = o.participants.find((p) => p.role === 'rider');
    expect(rider).toMatchObject({ personId: 'p_07705554433', label: null });
    expect(h.riderIdentity.given.get(rider!.id)).toEqual({ personId: 'p_07705554433', givenById: 'c1', name: 'ماما' });
    // The placed event says only that it is for someone else (no name, no number).
    const placed = h.events.events.find((e) => e.type === 'order.placed' && e.orderId === o.id);
    expect(placed?.payload).toMatchObject({ forSomeoneElse: true });
    expect(JSON.stringify(placed?.payload)).not.toContain('ماما');
  });

  it('the same number is the same person, ride after ride', async () => {
    const h = ordersHarness();
    h.people.set('07705554433', 'mum');
    const a = await h.orders.place('c1', ride({ from: 'typed', name: 'ماما', phone: '07705554433' }));
    const b = await h.orders.place('c1', ride({ from: 'typed', name: 'أم علي', phone: '+9647705554433' }, { clientRequestId: 'second-ride' }));
    expect(a.participants.find((p) => p.role === 'rider')?.personId).toBe('mum');
    expect(b.participants.find((p) => p.role === 'rider')?.personId).toBe('mum');
  });

  it('the booker reads «مشوار ماما»; the driver reads the name through riderOf; nobody else', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', ride({ from: 'typed', name: 'ماما', phone: '07705554433' }));
    const [mine] = await h.orders.withRiders([await h.orders.get(o.id)], 'c1');
    expect(mine!.rider).toEqual({ name: 'ماما' });
    const [theirs] = await h.orders.withRiders([await h.orders.get(o.id)], 'p_07705554433');
    expect(theirs!.rider).toBeUndefined();
    expect(await h.orders.riderOf(o.id, 'd1', 'partner_rider')).toEqual({ personId: 'p_07705554433', name: 'ماما' });
    // Every read goes to identity with who asked and why; a repeated poll reads once.
    await h.orders.withRiders([await h.orders.get(o.id)], 'c1');
    expect(h.riderIdentity.reads.map((r) => [r.accessorId, r.purpose])).toEqual([
      ['c1', 'ride_rider_name'],
      ['d1', 'partner_rider'],
    ]);
  });

  it('an ordinary ride has no rider name, and riderOf answers null', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', ride());
    const [mine] = await h.orders.withRiders([await h.orders.get(o.id)], 'c1');
    expect(mine!.rider).toBeUndefined();
    expect(await h.orders.riderOf(o.id, 'd1', 'partner_rider')).toBeNull();
    expect(h.riderIdentity.reads).toEqual([]);
  });

  it('a trusted person by position; a position that is not there is ride_rider_unknown', async () => {
    const h = ordersHarness();
    h.riderIdentity.trusted.set('c1', [
      { name: 'أختي زينب', phoneE164: '+9647801112233' },
      { name: 'أبوي', phoneE164: '+9647702223344' },
    ]);
    const o = await h.orders.place('c1', ride({ from: 'trusted', index: 1 }));
    const rider = o.participants.find((p) => p.role === 'rider')!;
    expect(rider.personId).toBe('p_07702223344');
    expect(h.riderIdentity.given.get(rider.id)?.name).toBe('أبوي');
    expect(await code(h.orders.place('c1', ride({ from: 'trusted', index: 2 }, { clientRequestId: 'trusted-2' })))).toBe('ride_rider_unknown');
  });

  it('someone in the household; not someone outside it', async () => {
    const h = ordersHarness();
    const home = await h.orgs.createHousehold({ name: 'بيت علي', cityId: 'aziziyah', payerId: 'c1' });
    await h.orgs.addMember(home.id, 'kid', { role: 'member', actorId: 'c1' });
    h.riderIdentity.cards.set('kid', { name: 'حسين', phoneMasked: '0770 ••• ••12' });
    const o = await h.orders.place('c1', ride({ from: 'household', householdId: home.id, personId: 'kid' }));
    const rider = o.participants.find((p) => p.role === 'rider')!;
    expect(rider.personId).toBe('kid');
    expect(h.riderIdentity.given.get(rider.id)?.name).toBe('حسين');
    expect(await code(h.orders.place('c1', ride({ from: 'household', householdId: home.id, personId: 'stranger' }, { clientRequestId: 'stranger-1' })))).toBe('ride_rider_unknown');
    expect(await code(h.orders.place('outsider', ride({ from: 'household', householdId: home.id, personId: 'kid' }, { clientRequestId: 'outsider-1' })))).toBe('ride_rider_unknown');
  });

  it('the rider of one of his own earlier rides («آخر من حجزتلهم»); not someone else’s ride', async () => {
    const h = ordersHarness();
    const first = await h.orders.place('c1', ride({ from: 'typed', name: 'ماما', phone: '07705554433' }));
    const again = await h.orders.place('c1', ride({ from: 'recent', orderId: first.id }, { clientRequestId: 'again-ride' }));
    const rider = again.participants.find((p) => p.role === 'rider')!;
    expect(rider.personId).toBe('p_07705554433');
    expect(h.riderIdentity.given.get(rider.id)?.name).toBe('ماما');
    expect(await code(h.orders.place('c2', ride({ from: 'recent', orderId: first.id }, { clientRequestId: 'their-ride' })))).toBe('ride_rider_unknown');
    const own = await h.orders.place('c1', ride(undefined, { clientRequestId: 'own-ride-1' }));
    expect(await code(h.orders.place('c1', ride({ from: 'recent', orderId: own.id }, { clientRequestId: 'own-ride-again' })))).toBe('ride_rider_unknown');
  });

  it('his own number is ride_rider_is_you; food or a second rider is invalid_input', async () => {
    const h = ordersHarness();
    h.people.set('07701112233', 'c1');
    expect(await code(h.orders.place('c1', ride({ from: 'typed', name: 'أنا', phone: '07701112233' })))).toBe('ride_rider_is_you');
    expect(await code(h.orders.place('c1', { ...h.foodInput(), rider: { from: 'typed', name: 'ماما', phone: '07705554433' } }))).toBe('invalid_input');
    expect(
      await code(
        h.orders.place(
          'c1',
          ride({ from: 'typed', name: 'ماما', phone: '07705554433' }, { participants: [{ ref: 'mum', role: 'rider', phone: '07705554433' }], clientRequestId: 'second-rider' }),
        ),
      ),
    ).toBe('invalid_input');
    // Nothing was written for the refused rides.
    expect(h.riderIdentity.given.size).toBe(0);
  });

  it('switching to the other vehicle keeps the rider and the name (J-D7)', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', ride({ from: 'typed', name: 'ماما', phone: '07705554433' }));
    const t = await h.trips.createForOrders({
      cityId: 'aziziyah',
      vertical: 'taxi',
      orders: [{ orderId: o.id, minVehicleClass: null }],
      stops: [
        { orderId: o.id, type: 'pickup', zoneKey: PICKUP.zoneKey, target: KITCHEN },
        { orderId: o.id, type: 'dropoff', zoneKey: DROPOFF.zoneKey, target: HOME },
      ],
    });
    await h.trips.offer(t.id);
    await h.deliver();
    h.clock.advance(200 * SEC);
    const quote = await h.orders.rideSwitchQuote('c1', { orderId: o.id, doorPickup: false });
    const next = await h.orders.switchRideVehicle('c1', { orderId: o.id, doorPickup: false, fareIqd: quote.fareIqd, clientRequestId: 'switch-0001' });
    expect(next.id).not.toBe(o.id);
    expect((await h.orders.get(o.id)).state).toBe('customer_cancelled');
    const rider = next.participants.find((p) => p.role === 'rider')!;
    expect(rider.personId).toBe('p_07705554433');
    const [view] = await h.orders.withRiders([next], 'c1');
    expect(view!.rider).toEqual({ name: 'ماما' });
  });
});
