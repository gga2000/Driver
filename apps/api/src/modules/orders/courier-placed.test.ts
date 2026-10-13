import { describe, expect, it } from 'vitest';
import { DriverError, type Actor, type PlaceOrderInput } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { ConfigService } from '../config/index.js';
import { AuditLogService, ControlsService, InMemoryControlsRepository, StaffNames } from '../controls/index.js';
import { createInMemoryEvents } from '../events/index.js';
import type { IdentityService } from '../identity/index.js';
import { OrgsService } from '../orgs/index.js';
import { HOME, KITCHEN, ordersHarness } from './test-harness.js';

async function code(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DriverError);
  return (err as DriverError).code;
}

/** The real launch controls (kill switches + launch scope), on in-memory everything. */
function launchControls(config: ConfigService) {
  const clock = new FakeClock('2026-10-03T09:00:00Z');
  const ev = createInMemoryEvents({ clock });
  const repo = new InMemoryControlsRepository();
  const identity = { firstNamesFor: async () => ({}), endAllSessions: async (_a: Actor) => ({ ended: 0 }) } as unknown as IdentityService;
  const names = new StaffNames(identity, clock);
  const controls = new ControlsService(repo, config, new OrgsService(ev.events, clock), ev.events, new AuditLogService(repo, names, clock), names, ev.uow, clock, identity);
  controls.bindActiveOrders(async () => new Map());
  return controls;
}

const SENDER_DOOR = { zoneKey: 'centre', pin: KITCHEN };
const parcel = (patch: Partial<PlaceOrderInput> = {}): PlaceOrderInput => ({ cityId: 'aziziyah', type: 'parcel', pickup: SENDER_DOOR, dropoff: { zoneKey: 'zakur', pin: HOME }, lines: [], ...patch });

describe('errands and parcels at placement (dispatch starts on order.placed)', () => {
  it('a parcel where the parcel service is not launched is refused with service_paused and never reaches dispatch', async () => {
    const config = new ConfigService();
    config.setLaunchedVerticals('aziziyah', ['food', 'taxi', 'tuktuk']); // a city that has not opened parcels
    expect(config.isLaunched('aziziyah', 'parcel')).toBe(false);
    const h = ordersHarness(undefined, { controls: launchControls(config) });
    expect(await code(h.orders.place('c1', parcel()))).toBe('service_paused');
    expect(await code(h.orders.place('c1', { cityId: 'aziziyah', type: 'errand', pickup: SENDER_DOOR, dropoff: { zoneKey: 'zakur' }, lines: [{ freeText: 'خبز', qty: 1, unitPriceIqd: 1000 }] }))).toBe('service_paused');
    // Nothing written, so no order.placed for dispatch's courier-placed subscriber to hear.
    expect(h.events.ofType('order.placed')).toEqual([]);
    // Launched services still take orders through the same gate.
    await h.orders.place('c1', h.foodInput());
    expect(h.events.ofType('order.placed')).toHaveLength(1);
  });

  it('a parcel or errand booked for later is refused (no scheduled search for them yet), from quote and place', async () => {
    const h = ordersHarness();
    const later = new Date(h.clock.now().getTime() + 3 * 3_600_000);
    expect(await code(h.orders.quote('c1', parcel({ scheduledFor: later })))).toBe('invalid_input');
    expect(await code(h.orders.place('c1', parcel({ scheduledFor: later })))).toBe('invalid_input');
    expect(await code(h.orders.place('c1', { cityId: 'aziziyah', type: 'errand', pickup: SENDER_DOOR, dropoff: { zoneKey: 'zakur' }, lines: [{ freeText: 'خبز', qty: 1, unitPriceIqd: 1000 }], scheduledFor: later }))).toBe('invalid_input');
    expect(h.events.ofType('order.placed')).toEqual([]);
    await h.orders.place('c1', parcel()); // now: placed as before
    expect(h.events.ofType('order.placed')).toHaveLength(1);
  });

  it('a placed parcel or errand carries its own pickup and drop-off for dispatch; food does not', async () => {
    const config = new ConfigService();
    config.setLaunchedVerticals('aziziyah', ['food', 'taxi', 'tuktuk', 'parcel', 'errand']);
    const h = ordersHarness(undefined, { controls: launchControls(config) });
    const p = await h.orders.place('c1', parcel());
    expect(h.events.ofType('order.placed').find((e) => e.orderId === p.id)?.payload).toMatchObject({ type: 'parcel', merchantOrgId: null, pickup: SENDER_DOOR, dropoff: { zoneKey: 'zakur', pin: HOME }, scheduledFor: null });
    const shop = { zoneKey: 'street_30' };
    const e = await h.orders.place('c1', { cityId: 'aziziyah', type: 'errand', pickup: shop, dropoff: { zoneKey: 'zakur' }, lines: [{ freeText: 'دوه من الصيدلية', qty: 1, unitPriceIqd: 7000 }] });
    expect(h.events.ofType('order.placed').find((x) => x.orderId === e.id)?.payload).toMatchObject({ type: 'errand', pickup: shop, dropoff: { zoneKey: 'zakur' } });
    const f = await h.orders.place('c1', h.foodInput());
    expect(h.events.ofType('order.placed').find((x) => x.orderId === f.id)?.payload).not.toHaveProperty('pickup');
  });
});

/** Ali's real launch list for Aziziyah (city file): what orders.quote and orders.place let through. */
describe('launch scope at checkout (Aziziyah launch day: food, taxi, tuktuk, parcel)', () => {
  it('food, taxi, tuktuk and parcels go through; grocery and errands are refused with service_paused from quote and place', async () => {
    const config = new ConfigService();
    expect(config.launchedVerticals('aziziyah')).toEqual(['food', 'taxi', 'tuktuk', 'parcel']);
    const h = ordersHarness(undefined, { controls: launchControls(config) });
    const ride = (rideVertical: 'taxi' | 'tuktuk'): PlaceOrderInput => ({ cityId: 'aziziyah', type: 'ride', rideVertical, pickup: { zoneKey: 'centre', pin: KITCHEN }, dropoff: { zoneKey: 'street_30', pin: HOME } });
    for (const input of [h.foodInput(), ride('taxi'), ride('tuktuk'), parcel()]) {
      await h.orders.quote('c1', input);
      await h.orders.place('c1', input);
    }
    expect(h.events.ofType('order.placed')).toHaveLength(4);
    const grocery = h.foodInput({ type: 'grocery_catalog' });
    const errand: PlaceOrderInput = { cityId: 'aziziyah', type: 'errand', pickup: SENDER_DOOR, dropoff: { zoneKey: 'zakur' }, lines: [{ freeText: 'خبز', qty: 1, unitPriceIqd: 1000 }] };
    for (const input of [grocery, errand]) {
      expect(await code(h.orders.quote('c1', input))).toBe('service_paused');
      expect(await code(h.orders.place('c1', input))).toBe('service_paused');
    }
    expect(h.events.ofType('order.placed')).toHaveLength(4);
  });
});

/** A courier dropped a parcel / errand: back to dispatch from its own pickup, unless it was already picked up. */
describe('parcel or errand dropped by its courier', () => {
  const SENDER = { zoneKey: 'street_30', pin: { lat: 32.905, lng: 45.07 } };

  async function placedWithCourier() {
    const h = ordersHarness();
    const o = await h.orders.place('c1', parcel({ pickup: SENDER }));
    // The courier trip dispatch builds on order.placed: pickup at the sender's door, never a merchant.
    const t = await h.trips.createForOrders({
      cityId: 'aziziyah',
      vertical: 'parcel',
      orders: [{ orderId: o.id, minVehicleClass: null }],
      stops: [
        { orderId: o.id, type: 'pickup', zoneKey: SENDER.zoneKey, target: SENDER.pin },
        { orderId: o.id, type: 'dropoff', zoneKey: 'zakur', target: HOME },
      ],
    });
    await h.trips.offer(t.id);
    await h.trips.accept(t.id, 'd1', { vehicleClass: 'bike' });
    await h.deliver();
    return { h, o, t };
  }

  async function pickUp(h: ReturnType<typeof ordersHarness>, tripId: string) {
    const s = (await h.trips.get(tripId)).stops.find((x) => x.type === 'pickup')!;
    await h.trips.arrive(tripId, s.id, 'd1', { pin: SENDER.pin });
    await h.trips.completeStop(tripId, s.id, 'd1');
    await h.deliver();
  }

  it('dropped before pickup: redispatch from the sender’s door (the trip’s own pickup), not a merchant pin', async () => {
    const { h, o, t } = await placedWithCourier();
    await h.trips.cancel(t.id, 'driver', 'd1', 'بنزين');
    await h.deliver();
    expect((await h.orders.get(o.id)).state).toBe('placed');
    const sent = h.events.ofType('order.courier_unassigned');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ redispatch: true, orderType: 'parcel', merchantOrgId: null, promisedReadyAt: null, pickup: SENDER, dropoff: { zoneKey: 'zakur', pin: HOME } });
  });

  it('dropped after pickup: never searched again (the courier-lost desk settles it)', async () => {
    const taken = await placedWithCourier();
    await pickUp(taken.h, taken.t.id);
    expect((await taken.h.orders.get(taken.o.id)).state).toBe('picked_up');
    await taken.h.trips.cancel(taken.t.id, 'platform', 'ops_1', 'السايق ما يرد');
    await taken.h.deliver();
    expect(taken.h.events.ofType('order.courier_unassigned').map((e) => e.payload)).toEqual([expect.objectContaining({ redispatch: false, orderType: 'parcel' })]);

    const dropped = await placedWithCourier();
    await pickUp(dropped.h, dropped.t.id);
    await dropped.h.trips.cancel(dropped.t.id, 'driver', 'd1', 'عطل');
    await dropped.h.deliver();
    expect(dropped.h.events.ofType('order.courier_unassigned')).toEqual([]);
    expect((await dropped.h.orders.get(dropped.o.id)).state).toBe('disputed');
  });

  it('food dropped before pickup is unchanged: redispatch from the kitchen', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.trips.cancel(t.id, 'driver', 'd1', 'بنزين');
    await h.deliver();
    expect(h.events.last('order.courier_unassigned')!.payload).toMatchObject({ redispatch: true, orderType: 'food', merchantOrgId: 'rest_1', pickup: { zoneKey: 'centre', pin: KITCHEN } });
  });
});
