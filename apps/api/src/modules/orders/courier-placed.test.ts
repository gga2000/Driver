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
    const config = new ConfigService(); // Aziziyah launch day: food, taxi, tuktuk
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
