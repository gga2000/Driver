import { describe, expect, it } from 'vitest';
import { EtaService, StraightLineRouter } from '../routing/index.js';
import { CUSTOMER_ZONE_MIN_ORDERS, DELIVERY_AREA_CACHE_MS, DriverError, type RoleKind } from '@driver/contracts';
import { OrgsMerchantDirectory } from '../orders/merchants.port.js';
import { OrdersStorefrontMerchants } from '../orders/storefront.port.js';
import { HARNESS_MENU, HOME, KITCHEN, ordersHarness } from '../orders/test-harness.js';
import { OrgsService } from '../orgs/index.js';
import { ConfigService } from '../config/index.js';
import { serverFees } from '../orders/index.js';
import { PricingService } from '../pricing/index.js';
import { SEED_ZONES } from './area.fixtures.js';
import { foodDeliveryFee } from './area.js';
import { MerchantService, type MerchantAreaPort, type MerchantEventsPort, type MerchantPeoplePort, type MerchantPhotosPort } from './merchant.service.js';

const MIN = 60_000;

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

/**
 * MerchantService over the orders harness (orders + trips in memory, fake clock) and a real
 * in-memory OrgsService. `org_1` is Khalid's (staff `s1`, owner `o1`), `org_2` a second store.
 */
async function setup(opts: { photos?: MerchantPhotosPort } = {}) {
  const h = ordersHarness();
  const orgs = new OrgsService(undefined, h.clock);
  const khalid = await orgs.create({ type: 'restaurant', name: 'مطعم خالد', cityId: 'aziziyah', ownerId: 'o1' });
  const other = await orgs.create({ type: 'restaurant', name: 'مشويات الحاج كريم', cityId: 'aziziyah', ownerId: 'o2' });
  const home = await orgs.createHousehold({ name: 'بيت', cityId: 'aziziyah', payerId: 's1' });
  await orgs.setMerchantSettings(khalid.id, { location: { zoneKey: 'centre', pin: KITCHEN } });
  h.merchants.add(khalid.id, { location: { zoneKey: 'centre', pin: KITCHEN } });

  const grants: Array<{ personId: string; kind: RoleKind; orgId: string | null; frozen: boolean }> = [
    { personId: 's1', kind: 'merchant_staff', orgId: khalid.id, frozen: false },
    { personId: 's1', kind: 'customer', orgId: null, frozen: false },
    { personId: 'o1', kind: 'merchant_owner', orgId: khalid.id, frozen: false },
    { personId: 'o1', kind: 'merchant_owner', orgId: other.id, frozen: false },
    { personId: 'o1', kind: 'merchant_staff', orgId: other.id, frozen: false },
    { personId: 'x1', kind: 'merchant_staff', orgId: home.id, frozen: false },
    { personId: 'f1', kind: 'merchant_staff', orgId: khalid.id, frozen: true },
  ];
  const nameReads: string[] = [];
  const people: MerchantPeoplePort = {
    grants: async (personId) => grants.filter((g) => g.personId === personId),
    hasRole: async (personId, kind, orgId) => grants.some((g) => g.personId === personId && g.kind === kind && !g.frozen && (orgId === undefined || g.orgId === orgId)),
    courierFirstName: async (courierId) => {
      nameReads.push(courierId);
      return 'حيدر';
    },
    courierVehicle: async () => ({ vehicleClass: 'bike', plate: 'واسط 45678' }),
  };
  const recorded: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const events: MerchantEventsPort = {
    record: async (type, _actor, _org, payload) => {
      recorded.push({ type, payload });
    },
  };
  const names = new Map(HARNESS_MENU.map((m) => [m.id, m.nameAr]));
  const area = testArea();
  const svc = new MerchantService(h.orders, h.trips, people, orgs, { itemNames: async (_org, ids) => new Map(ids.map((id) => [id, names.get(id) ?? id])) }, events, h.clock, new EtaService(new StraightLineRouter()), area, opts.photos ?? null);
  const staff = { personId: 's1', sessionId: 'x' };
  const owner = { personId: 'o1', sessionId: 'y' };
  return { h, orgs, svc, khalid, other, staff, owner, recorded, nameReads, area };
}

/**
 * The delivery map's port as the module binds it, over the seed zones (drafts), checkout's real
 * pricing (`foodDeliveryFee` → `serverFees` → `PricingService`) and a settable set of switched-off
 * zones; counts its zone reads so the cache can be seen.
 */
function testArea(): MerchantAreaPort & { zoneReads: number; paused: Set<string> } {
  const pricing = new PricingService(new ConfigService());
  const port = {
    zoneReads: 0,
    paused: new Set<string>(),
    zones: async () => {
      port.zoneReads += 1;
      return SEED_ZONES;
    },
    foodDeliveryFee: (cityId: string, kitchenZone: string, dropoffZone: string, at: Date) => foodDeliveryFee(pricing, cityId, kitchenZone, dropoffZone, at),
    pausedZones: async (_city: string, _org: string, _kitchen: string, keys: readonly string[]) => new Set(keys.filter((k) => port.paused.has(k))),
  };
  return port;
}

describe('MerchantService — stores and scope', () => {
  it('lists the restaurants a person works at, owner wins over staff; nothing for a customer', async () => {
    const { svc, staff, owner, khalid, other } = await setup();
    expect(await svc.myStores(staff)).toEqual([{ orgId: khalid.id, name: 'مطعم خالد', type: 'restaurant', cityId: 'aziziyah', role: 'staff' }]);
    // By Arabic name: مشويات الحاج كريم before مطعم خالد.
    expect((await svc.myStores(owner)).map((s) => [s.orgId, s.role])).toEqual([
      [other.id, 'owner'],
      [khalid.id, 'owner'],
    ]);
    expect(await svc.myStores({ personId: 'nobody', sessionId: 'z' })).toEqual([]);
    expect(await svc.myStores({ personId: 'x1', sessionId: 'z' })).toEqual([]); // a household is not a store
    expect(await svc.myStores({ personId: 'f1', sessionId: 'z' })).toEqual([]); // frozen grant
  });

  it('refuses another store’s board and switches', async () => {
    const { svc, staff, other } = await setup();
    expect(await code(svc.board(staff, { merchantOrgId: other.id }))).toBe('forbidden');
    expect(await code(svc.setBusy(staff, { merchantOrgId: other.id, on: true }))).toBe('forbidden');
    expect(await code(svc.storeStatus({ personId: 'nobody', sessionId: 'z' }, { merchantOrgId: other.id }))).toBe('forbidden');
  });
});

describe('MerchantService — board', () => {
  it('shows a new group order with people, notes, deadline; then preparing with courier state', async () => {
    const { h, svc, staff, khalid, nameReads } = await setup();
    const placed = await h.orders.place(
      'c1',
      h.foodInput({
        merchantOrgId: khalid.id,
        note: 'دگ الجرس',
        participants: [{ ref: 'a', role: 'diner', phone: '07701111111', label: 'أبو حسين', note: 'حار هواي' }],
        lines: [
          { catalogItemId: 'kebab', qty: 2, note: 'بدون بصل' },
          { catalogItemId: 'tikka', qty: 1, participantRef: 'a' },
        ],
        deliveryFeeIqd: undefined,
        serviceFeeIqd: undefined,
      }),
    );
    let board = await svc.board(staff, { merchantOrgId: khalid.id });
    expect(board.acceptWindowSec).toBe(90);
    expect(board.orders).toHaveLength(1);
    const card = board.orders[0]!;
    expect(card).toMatchObject({ id: placed.id, column: 'new', paymentMethod: 'cash', itemCount: 3, note: 'دگ الجرس', courier: { state: 'none' } });
    expect(card.acceptBy).toEqual(new Date(h.clock.now().getTime() + 90_000));
    expect(card.groups.map((g) => [g.kind, g.label, g.note])).toEqual([
      ['orderer', null, null],
      ['participant', 'أبو حسين', 'حار هواي'],
    ]);
    expect(card.groups[0]!.lines[0]).toMatchObject({ name: 'كباب', qty: 2, note: 'بدون بصل' });

    await h.orders.merchantAccept('s1', { orderId: placed.id, prepMinutes: 15 });
    board = await svc.board(staff, { merchantOrgId: khalid.id });
    expect(board.orders[0]).toMatchObject({ column: 'preparing', prepMinutes: 15, courier: { state: 'searching' } });

    const trip = await h.tripFor(placed.id);
    await h.trips.reportPosition('d1', { tripId: trip.id, pin: { lat: 32.9215, lng: 45.0598 }, at: h.clock.now(), bearing: 180, speedKmh: 20 });
    board = await svc.board(staff, { merchantOrgId: khalid.id });
    expect(board.orders[0]!.courier).toMatchObject({ state: 'on_the_way', firstName: 'حيدر', vehicleClass: 'bike' });
    expect(board.orders[0]!.courier.etaMinutes).toBeGreaterThan(0);
    await svc.board(staff, { merchantOrgId: khalid.id });
    expect(nameReads).toEqual(['d1']); // first name read once per trip, not per poll

    await h.orders.markReady('s1', { orderId: placed.id });
    const pickup = (await h.trips.get(trip.id)).stops.find((s) => s.type === 'pickup')!;
    await h.trips.arrive(trip.id, pickup.id, 'd1', { pin: KITCHEN });
    board = await svc.board(staff, { merchantOrgId: khalid.id });
    expect(board.orders[0]).toMatchObject({ column: 'ready', courier: { state: 'arrived' } });

    await h.pickup(trip.id);
    expect((await svc.board(staff, { merchantOrgId: khalid.id })).orders).toEqual([]);
  });

  it('an order nobody accepted in 90 s leaves the columns but stays on the board as a miss (M-01)', async () => {
    const { h, svc, staff, khalid } = await setup();
    const placed = await h.orders.place('c1', h.foodInput({ merchantOrgId: khalid.id, deliveryFeeIqd: undefined, serviceFeeIqd: undefined }));
    expect((await svc.board(staff, { merchantOrgId: khalid.id })).missed).toEqual({ today: 0, orders: [] });
    await h.advance(90_000);
    const board = await svc.board(staff, { merchantOrgId: khalid.id });
    expect(board.orders).toEqual([]);
    expect(board.missed?.today).toBe(1);
    expect(board.missed?.orders[0]).toMatchObject({ orderId: placed.id, reason: 'merchant_timeout', scored: true, missedAt: h.clock.now() });
  });

  it('the "+5 د" shows on the card once used', async () => {
    const { h, svc, staff, khalid } = await setup();
    const placed = await h.orders.place('c1', h.foodInput({ merchantOrgId: khalid.id, deliveryFeeIqd: undefined, serviceFeeIqd: undefined }));
    await h.orders.merchantAccept('s1', { orderId: placed.id, prepMinutes: 15 });
    expect((await svc.board(staff, { merchantOrgId: khalid.id })).orders[0]).toMatchObject({ prepExtended: false, prepMinutes: 15 });
    await h.orders.merchantExtendPrep('s1', { orderId: placed.id });
    expect((await svc.board(staff, { merchantOrgId: khalid.id })).orders[0]).toMatchObject({ prepExtended: true, prepMinutes: 20 });
  });
});

describe('MerchantService — store status, busy mode, early close, printer', () => {
  it('busy mode: on for an hour, recorded, then reads as off by itself', async () => {
    const { h, svc, staff, khalid, recorded } = await setup();
    const on = await svc.setBusy(staff, { merchantOrgId: khalid.id, on: true });
    expect(on.busy).toEqual({ on: true, until: new Date(h.clock.now().getTime() + 60 * MIN), extraPrepMinutes: 10 });
    h.clock.advance(61 * MIN);
    expect((await svc.storeStatus(staff, { merchantOrgId: khalid.id })).busy.on).toBe(false);
    const off = await svc.setBusy(staff, { merchantOrgId: khalid.id, on: false });
    expect(off.busy.on).toBe(false);
    expect(recorded.map((r) => r.type)).toEqual(['merchant.busy_on', 'merchant.busy_off']);
  });

  it('early close with a reason, then open again', async () => {
    const { svc, staff, khalid, recorded } = await setup();
    const closed = await svc.setOpen(staff, { merchantOrgId: khalid.id, open: false, reason: 'power_cut', note: ' المولدة عاطلة ' });
    expect(closed).toMatchObject({ open: false, closed: { reason: 'power_cut', note: 'المولدة عاطلة' } });
    const opened = await svc.setOpen(staff, { merchantOrgId: khalid.id, open: true });
    expect(opened).toMatchObject({ open: true, closed: null });
    expect(recorded.map((r) => r.type)).toEqual(['merchant.closed_early', 'merchant.opened']);
  });

  it('a quick pause reopens by itself (counter step 5, h2): status, orders and the customer card', async () => {
    const { h, svc, staff, orgs, khalid, recorded } = await setup();
    const paused = await svc.setOpen(staff, { merchantOrgId: khalid.id, open: false, reason: 'power_cut', pauseMinutes: 20 });
    const until = new Date(h.clock.now().getTime() + 20 * MIN);
    expect(paused).toMatchObject({ open: false, closed: { reason: 'power_cut', until } });
    expect(recorded.at(-1)?.payload).toMatchObject({ reason: 'power_cut', until: until.toISOString() });
    const directory = new OrgsMerchantDirectory(orgs, h.clock.now.bind(h.clock));
    expect(await directory.profile(khalid.id)).toMatchObject({ closed: true, reopensAt: until });
    expect(await new OrdersStorefrontMerchants(directory).profile(khalid.id, 'aziziyah', h.clock.now())).toMatchObject({ closed: true, reopensAt: until });

    h.clock.advance(20 * MIN);
    expect(await svc.storeStatus(staff, { merchantOrgId: khalid.id })).toMatchObject({ open: true, closed: null });
    const after = await directory.profile(khalid.id);
    expect(after?.closed).toBe(false);
    expect(after).not.toHaveProperty('reopensAt');
  });

  it('closing without a pause stays closed until reopened by hand', async () => {
    const { h, svc, staff, khalid } = await setup();
    await svc.setOpen(staff, { merchantOrgId: khalid.id, open: false, reason: 'closing_early' });
    h.clock.advance(36 * 60 * MIN);
    expect(await svc.storeStatus(staff, { merchantOrgId: khalid.id })).toMatchObject({ open: false, closed: { reason: 'closing_early', until: null } });
  });

  it('printer marker: records only changes and keeps the printer name', async () => {
    const { svc, staff, khalid, recorded } = await setup();
    expect((await svc.storeStatus(staff, { merchantOrgId: khalid.id })).printer.state).toBe('not_set_up');
    await svc.setPrinterStatus(staff, { merchantOrgId: khalid.id, state: 'connected', name: 'XP-80' });
    await svc.setPrinterStatus(staff, { merchantOrgId: khalid.id, state: 'connected' });
    const off = await svc.setPrinterStatus(staff, { merchantOrgId: khalid.id, state: 'disconnected' });
    expect(off.printer).toMatchObject({ state: 'disconnected', name: 'XP-80' });
    expect(recorded.filter((r) => r.type === 'merchant.printer_status').map((r) => r.payload['state'])).toEqual(['connected', 'disconnected']);
  });

  it('shows a Friday-prayer pause window as closed until it ends', async () => {
    const { h, svc, staff, khalid } = await setup();
    h.clock.set('2026-10-09T09:00:00Z'); // Friday 12:00 Baghdad
    expect(await svc.storeStatus(staff, { merchantOrgId: khalid.id })).toMatchObject({ open: false, pause: { reason: 'صلاة الجمعة', until: '13:15' } });
  });
});

describe('busy mode and early close reach orders and the customer card', () => {
  it('busy: +10 min on the picked prep time, the auto-accept default and the promised ready time', async () => {
    const { h } = await setup();
    h.merchants.add('rest_1', { location: { zoneKey: 'centre', pin: KITCHEN }, busyUntil: new Date(h.clock.now().getTime() + 60 * MIN) });
    const o = await h.orders.place('c1', h.foodInput());
    const accepted = await h.orders.merchantAccept('s1', { orderId: o.id, prepMinutes: 15 });
    expect(accepted.promisedReadyAt).toEqual(new Date(h.clock.now().getTime() + 25 * MIN));
    expect(h.events.ofType('order.accepted')[0]?.payload).toMatchObject({ prepMinutes: 25 });

    h.merchants.add('rest_auto', { autoAccept: true, defaultPrepMin: 20, location: { zoneKey: 'centre' }, busyUntil: new Date(h.clock.now().getTime() + 60 * MIN) });
    const auto = await h.orders.place('c1', h.foodInput({ merchantOrgId: 'rest_auto' }));
    expect(auto.promisedReadyAt).toEqual(new Date(h.clock.now().getTime() + 30 * MIN));
  });

  it('busy mode that has expired adds nothing', async () => {
    const { h } = await setup();
    h.merchants.add('rest_1', { location: { zoneKey: 'centre', pin: KITCHEN }, busyUntil: new Date(h.clock.now().getTime() - MIN) });
    const o = await h.orders.place('c1', h.foodInput());
    const accepted = await h.orders.merchantAccept('s1', { orderId: o.id, prepMinutes: 15 });
    expect(accepted.promisedReadyAt).toEqual(new Date(h.clock.now().getTime() + 15 * MIN));
  });

  it('closed by hand: orders.place refuses (merchant_paused)', async () => {
    const { h } = await setup();
    h.merchants.add('rest_1', { location: { zoneKey: 'centre', pin: KITCHEN }, closed: true });
    expect(await code(h.orders.place('c1', h.foodInput()))).toBe('merchant_paused');
  });

  it('the orgs-backed directory and the storefront read busy and closed from the store settings', async () => {
    const { h, svc, staff, orgs, khalid } = await setup();
    await svc.setBusy(staff, { merchantOrgId: khalid.id, on: true });
    await svc.setOpen(staff, { merchantOrgId: khalid.id, open: false, reason: 'sold_out' });
    const directory = new OrgsMerchantDirectory(orgs);
    const profile = await directory.profile(khalid.id);
    expect(profile).toMatchObject({ closed: true, busyUntil: new Date(h.clock.now().getTime() + 60 * MIN) });
    const front = new OrdersStorefrontMerchants(directory);
    expect(await front.profile(khalid.id, 'aziziyah', h.clock.now())).toMatchObject({ busy: true, closed: true });
    expect(await front.profile(khalid.id, 'aziziyah', new Date(h.clock.now().getTime() + 61 * MIN))).toMatchObject({ busy: false });
  });
});

describe('MerchantService — opening hours', () => {
  /** Lunch 12:00–15:30 and dinner 18:00–01:00; Friday dinner only. */
  const split = () =>
    Array.from({ length: 7 }, (_, dow) => ({
      dow,
      shifts:
        dow === 5
          ? [{ start: '18:00', end: '01:00' }]
          : [
              { start: '12:00', end: '15:30' },
              { start: '18:00', end: '01:00' },
            ],
    }));

  async function withCatalog() {
    const base = await setup();
    const fronts = new Map<string, Array<{ dow: number; start: string; end: string }>>([
      [
        base.khalid.id,
        Array.from({ length: 7 }, (_, dow) => ({ dow, start: '11:00', end: '00:30' })),
      ],
    ]);
    const catalog = {
      itemNames: async () => new Map<string, string>(),
      storefrontHours: async (orgId: string) => fronts.get(orgId) ?? null,
      mirrorHours: async (
        orgId: string,
        w: ReadonlyArray<{ dow: number; start: string; end: string }>,
      ) => {
        if (fronts.has(orgId)) fronts.set(orgId, [...w]);
      },
    };
    const people: MerchantPeoplePort = {
      grants: async () => [],
      hasRole: async (personId, kind, orgId) =>
        (personId === 'o1' && kind === 'merchant_owner') ||
        (personId === 's1' && kind === 'merchant_staff' && orgId === base.khalid.id),
      courierFirstName: async () => null,
      courierVehicle: async () => null,
    };
    const events: MerchantEventsPort = {
      record: async (type, _a, _o, payload) => {
        base.recorded.push({ type, payload });
      },
    };
    const svc = new MerchantService(
      base.h.orders,
      base.h.trips,
      people,
      base.orgs,
      catalog,
      events,
      base.h.clock,
      new EtaService(new StraightLineRouter()),
      base.area,
    );
    return { ...base, svc, fronts };
  }

  it('reads the seeded storefront hours and the Friday-prayer pause; staff read, only the owner edits', async () => {
    const { h, svc, staff, owner, khalid } = await withCatalog();
    h.clock.set('2026-10-04T10:00:00Z'); // Sunday 13:00 Baghdad
    const view = await svc.hours(staff, { merchantOrgId: khalid.id });
    expect(view).toMatchObject({
      source: 'catalog',
      canEdit: false,
      today: '2026-10-04',
      state: { open: true, reason: null, closesAt: '00:30' },
    });
    expect(view.days).toHaveLength(7);
    expect(view.pauses).toEqual([{ dow: 5, start: '11:45', end: '13:15', reason: 'صلاة الجمعة' }]);
    expect(
      await code(svc.setHours(staff, { merchantOrgId: khalid.id, days: split(), holidays: [] })),
    ).toBe('forbidden');
    expect((await svc.hours(owner, { merchantOrgId: khalid.id })).canEdit).toBe(true);
  });

  it('saves split shifts and a holiday: persisted on the store, mirrored to the storefront, recorded', async () => {
    const { h, svc, owner, khalid, orgs, fronts, recorded } = await withCatalog();
    h.clock.set('2026-10-04T13:00:00Z'); // Sunday 16:00: between lunch and dinner
    const saved = await svc.setHours(owner, {
      merchantOrgId: khalid.id,
      days: split(),
      holidays: [
        { from: '2026-10-20', to: '2026-10-22', note: ' عيد ' },
        { from: '2026-09-01', to: '2026-09-02', note: 'old' }, // already past: dropped
      ],
    });
    expect(saved).toMatchObject({
      source: 'store',
      state: { open: false, reason: 'hours', opensAt: { date: '2026-10-04', time: '18:00' } },
      holidays: [{ from: '2026-10-20', to: '2026-10-22', note: 'عيد' }],
    });
    expect(saved.days[0]!.shifts).toEqual([
      { start: '12:00', end: '15:30' },
      { start: '18:00', end: '01:00' },
    ]);
    expect((await orgs.merchantSettings(khalid.id)).openingHours).toHaveLength(13);
    expect(fronts.get(khalid.id)).toHaveLength(13);
    expect(recorded.find((r) => r.type === 'merchant.hours_set')?.payload).toMatchObject({
      shifts: 13,
      openDays: 7,
    });
    // The status header explains it: outside the schedule, opens at 18:00.
    expect((await svc.storeStatus(owner, { merchantOrgId: khalid.id })).schedule).toMatchObject({
      inHours: false,
      opensAt: { time: '18:00' },
    });
  });

  it('refuses overlapping shifts and an all-closed week (store_hours_invalid)', async () => {
    const { svc, owner, khalid } = await withCatalog();
    const bad = split();
    bad[1]!.shifts = [
      { start: '12:00', end: '16:00' },
      { start: '15:00', end: '20:00' },
    ];
    expect(
      await code(svc.setHours(owner, { merchantOrgId: khalid.id, days: bad, holidays: [] })),
    ).toBe('store_hours_invalid');
    expect(
      await code(
        svc.setHours(owner, {
          merchantOrgId: khalid.id,
          days: split().map((d) => ({ ...d, shifts: [] })),
          holidays: [],
        }),
      ),
    ).toBe('store_hours_invalid');
  });

  it('a holiday closes the store for orders and shows on the customer card as closed by hours', async () => {
    const { h, svc, owner, khalid, orgs } = await withCatalog();
    h.clock.set('2026-10-20T10:00:00Z');
    await svc.setHours(owner, {
      merchantOrgId: khalid.id,
      days: split(),
      holidays: [{ from: '2026-10-20', to: '2026-10-22', note: 'عيد' }],
    });
    const view = await svc.hours(owner, { merchantOrgId: khalid.id });
    expect(view.state).toMatchObject({
      open: false,
      reason: 'holiday',
      opensAt: { date: '2026-10-23', time: '18:00' },
    }); // Friday: dinner only
    const directory = new OrgsMerchantDirectory(orgs, () => h.clock.now());
    expect(await directory.profile(khalid.id)).toMatchObject({ closed: true, holiday: true });
    expect(
      await new OrdersStorefrontMerchants(directory).profile(khalid.id, 'aziziyah', h.clock.now()),
    ).toMatchObject({ closed: true, holiday: true });
    h.clock.set('2026-10-23T10:00:00Z');
    expect(await directory.profile(khalid.id)).toMatchObject({ closed: false });
  });
});

describe('MerchantService — pickup spot (maps program r7)', () => {
  /** Uploads by owner (`up_o1_*` belong to o1); signed links; what was deleted. */
  function photoStore() {
    const uploads = new Map([
      ['up_o1_door', 'o1'],
      ['up_o1_window', 'o1'],
      ['up_o1_counter', 'o1'],
      ['up_o2_door', 'o2'],
      ['up_s1_door', 's1'],
    ]);
    const removed: string[] = [];
    const photos: MerchantPhotosPort = {
      owns: async (id, personId) => uploads.get(id) === personId,
      readUrl: (id) => `https://files/${id}?sig=x`,
      remove: async (id) => {
        removed.push(id);
        uploads.delete(id);
      },
    };
    return { photos, removed };
  }

  const ACCEPTED = new Date('2026-10-03T10:00:00Z');
  const job = (extra: Partial<{ courierId: string | null; acceptedAt: Date | null; completedAt: Date | null; cancelled: boolean }> = {}) => ({ courierId: 'k1', acceptedAt: ACCEPTED, completedAt: null, ...extra });

  it('the owner saves photos and a note; staff read it; it starts empty', async () => {
    const { photos } = photoStore();
    const { svc, owner, staff, khalid, recorded } = await setup({ photos });
    expect(await svc.pickupSpot(staff, { merchantOrgId: khalid.id })).toEqual({ merchantOrgId: khalid.id, note: null, photos: [], canEdit: false, updatedAt: null });
    const saved = await svc.setPickupSpot(owner, { merchantOrgId: khalid.id, note: '  الاستلام من الشباك اليسار ', photoIds: ['up_o1_door', 'up_o1_window'] });
    expect(saved).toMatchObject({
      note: 'الاستلام من الشباك اليسار',
      photos: [
        { id: 'up_o1_door', url: 'https://files/up_o1_door?sig=x' },
        { id: 'up_o1_window', url: 'https://files/up_o1_window?sig=x' },
      ],
      canEdit: true,
    });
    expect(saved.updatedAt).toBeInstanceOf(Date);
    expect(await svc.pickupSpot(staff, { merchantOrgId: khalid.id })).toMatchObject({ note: 'الاستلام من الشباك اليسار', canEdit: false });
    expect(recorded.at(-1)).toEqual({ type: 'merchant.pickup_spot_set', payload: { photos: 2, note: true } });
  });

  it('staff, other stores and someone else’s upload are refused', async () => {
    const { photos } = photoStore();
    const { svc, owner, staff, khalid, other } = await setup({ photos });
    expect(await code(svc.setPickupSpot(staff, { merchantOrgId: khalid.id, note: 'باب جانبي', photoIds: [] }))).toBe('forbidden');
    expect(await code(svc.setPickupSpot(staff, { merchantOrgId: khalid.id, note: null, photoIds: ['up_s1_door'] }))).toBe('forbidden');
    expect(await code(svc.pickupSpot({ personId: 'nobody', sessionId: 'z' }, { merchantOrgId: khalid.id }))).toBe('forbidden');
    // o2 owns the other store's photo, not o1: o1 can't attach it to his own store.
    expect(await code(svc.setPickupSpot(owner, { merchantOrgId: khalid.id, note: null, photoIds: ['up_o2_door'] }))).toBe('upload_invalid');
    expect(await code(svc.setPickupSpot(owner, { merchantOrgId: khalid.id, note: null, photoIds: ['up_missing'] }))).toBe('upload_invalid');
    // s1 is staff at Khalid's only: the other store is not his to read.
    expect(await code(svc.pickupSpot(staff, { merchantOrgId: other.id }))).toBe('forbidden');
    expect((await svc.pickupSpot(owner, { merchantOrgId: khalid.id })).photos).toEqual([]);
  });

  it('replacing keeps the photos still listed, deletes the ones taken off, and empty clears it', async () => {
    const { photos, removed } = photoStore();
    const { svc, owner, khalid } = await setup({ photos });
    await svc.setPickupSpot(owner, { merchantOrgId: khalid.id, note: 'الشباك', photoIds: ['up_o1_door', 'up_o1_window'] });
    const swapped = await svc.setPickupSpot(owner, { merchantOrgId: khalid.id, note: 'الشباك', photoIds: ['up_o1_window', 'up_o1_counter'] });
    expect(swapped.photos.map((p) => p.id)).toEqual(['up_o1_window', 'up_o1_counter']);
    expect(removed).toEqual(['up_o1_door']);
    const cleared = await svc.setPickupSpot(owner, { merchantOrgId: khalid.id, note: '   ', photoIds: [] });
    expect(cleared).toMatchObject({ note: null, photos: [], updatedAt: null });
    expect(removed).toEqual(['up_o1_door', 'up_o1_window', 'up_o1_counter']);
  });

  it('a photo store is needed to attach photos; a note works without one', async () => {
    const { svc, owner, khalid } = await setup();
    expect(await code(svc.setPickupSpot(owner, { merchantOrgId: khalid.id, note: null, photoIds: ['up_o1_door'] }))).toBe('upload_invalid');
    expect((await svc.setPickupSpot(owner, { merchantOrgId: khalid.id, note: 'باب المطبخ الجانبي', photoIds: [] })).note).toBe('باب المطبخ الجانبي');
  });

  it('the courier sees it only on his own job, from accepting until the trip is over', async () => {
    const { photos } = photoStore();
    const { svc, owner, khalid, other } = await setup({ photos });
    const during = new Date('2026-10-03T10:10:00Z');
    expect(await svc.courierPickupSpot(khalid.id, { courierId: 'k1', trip: job(), now: during })).toBeNull(); // not set yet
    await svc.setPickupSpot(owner, { merchantOrgId: khalid.id, note: 'الاستلام من الشباك اليسار', photoIds: ['up_o1_window'] });
    expect(await svc.courierPickupSpot(khalid.id, { courierId: 'k1', trip: job(), now: during })).toEqual({
      note: 'الاستلام من الشباك اليسار',
      photos: [{ id: 'up_o1_window', url: 'https://files/up_o1_window?sig=x' }],
    });
    expect(await svc.courierPickupSpot(khalid.id, { courierId: 'k2', trip: job(), now: during })).toBeNull(); // another courier
    expect(await svc.courierPickupSpot(khalid.id, { courierId: 'k1', trip: job({ acceptedAt: null }), now: during })).toBeNull(); // only offered
    expect(await svc.courierPickupSpot(khalid.id, { courierId: 'k1', trip: job({ cancelled: true }), now: during })).toBeNull();
    const done = new Date('2026-10-03T10:30:00Z');
    expect(await svc.courierPickupSpot(khalid.id, { courierId: 'k1', trip: job({ completedAt: done }), now: new Date('2026-10-04T10:00:00Z') })).toBeNull(); // long after
    // A store without a spot shows nothing.
    expect(await svc.courierPickupSpot(other.id, { courierId: 'k1', trip: job(), now: during })).toBeNull();
  });
});

describe('MerchantService — delivery area and fees (maps program r5)', () => {
  it('prices every zone from this kitchen with checkout’s own quote, bands cheapest first', async () => {
    const { svc, staff, khalid } = await setup(); // 12:00 Baghdad: no night fee
    const view = await svc.deliveryArea(staff, { merchantOrgId: khalid.id });
    const pricing = new PricingService(new ConfigService());
    expect(view.kitchen).toMatchObject({ zoneKey: 'centre', name_en: 'Aziziyah centre', pin: KITCHEN });
    expect(view.zones).toHaveLength(SEED_ZONES.length);
    for (const z of view.zones) {
      // The very fee orders.place locks for a customer in that zone.
      const fee = serverFees(pricing, { cityId: 'aziziyah', type: 'food', pickup: { zoneKey: 'centre' }, dropoff: { zoneKey: z.key }, at: view.pricedAt }).deliveryFeeIqd;
      expect(z.feeIqd, z.key).toBe(fee);
      expect(view.bands[z.band!]!.feeIqd).toBe(fee);
      expect(z.service).toBe('open');
    }
    const byKey = new Map(view.zones.map((z) => [z.key, z]));
    expect(byKey.get('centre')).toMatchObject({ feeIqd: 500, kitchen: true });
    expect(byKey.get('zakur')).toMatchObject({ feeIqd: 1000, kitchen: false });
    expect(byKey.get('khamas')?.feeIqd).toBe(1500);
    expect(byKey.get('bazl_hallata')?.feeIqd).toBe(2000);
    expect(view.bands.map((b) => b.feeIqd)).toEqual([500, 1000, 1500, 2000]);
    expect(view.bands.reduce((a, b) => a + b.zones, 0)).toBe(SEED_ZONES.length);
  });

  it('a night hour quotes the night fee, like checkout at that hour', async () => {
    const { h, svc, staff, khalid } = await setup();
    h.clock.set('2026-10-03T20:30:00Z'); // 23:30 Baghdad: food's night fee starts at midnight
    const late = await svc.deliveryArea(staff, { merchantOrgId: khalid.id });
    expect(late.zones.find((z) => z.key === 'centre')?.feeIqd).toBe(500);
    h.clock.set('2026-10-03T21:30:00Z'); // 00:30 Baghdad
    const view = await svc.deliveryArea(staff, { merchantOrgId: khalid.id });
    expect(view.zones.find((z) => z.key === 'centre')?.feeIqd).toBe(750);
  });

  it('marks a switched-off zone as paused and keeps its fee', async () => {
    const { svc, staff, khalid, area } = await setup();
    area.paused.add('zakur');
    const view = await svc.deliveryArea(staff, { merchantOrgId: khalid.id });
    expect(view.zones.find((z) => z.key === 'zakur')).toMatchObject({ service: 'paused', feeIqd: 1000 });
    expect(view.zones.filter((z) => z.service === 'paused')).toHaveLength(1);
  });

  it('a store without a place on file sees the zones with nothing priced', async () => {
    const { svc, owner, other } = await setup();
    const view = await svc.deliveryArea(owner, { merchantOrgId: other.id });
    expect(view.kitchen).toBeNull();
    expect(view.bands).toEqual([]);
    expect(view.zones.every((z) => z.feeIqd === null && z.band === null && z.service === 'no_price')).toBe(true);
  });

  it('keeps the view a few minutes, never past the hour it was priced in', async () => {
    const { h, svc, staff, khalid, area } = await setup();
    h.clock.set('2026-10-03T09:10:00Z');
    await svc.deliveryArea(staff, { merchantOrgId: khalid.id });
    h.clock.advance(2 * MIN);
    await svc.deliveryArea(staff, { merchantOrgId: khalid.id });
    expect(area.zoneReads).toBe(1);
    h.clock.advance(DELIVERY_AREA_CACHE_MS); // past the cache
    await svc.deliveryArea(staff, { merchantOrgId: khalid.id });
    expect(area.zoneReads).toBe(2);
    h.clock.set('2026-10-03T09:59:30Z');
    await svc.deliveryArea(staff, { merchantOrgId: khalid.id });
    expect(area.zoneReads).toBe(3);
    h.clock.set('2026-10-03T10:00:10Z'); // 40 s later, but a new hour (a night fee may start on one)
    await svc.deliveryArea(staff, { merchantOrgId: khalid.id });
    expect(area.zoneReads).toBe(4);
  });

  it('refuses people who don’t work at the store, and another store’s staff', async () => {
    const { svc, staff, other, khalid } = await setup();
    expect(await code(svc.deliveryArea({ personId: 'nobody', sessionId: 'z' }, { merchantOrgId: khalid.id }))).toBe('forbidden');
    expect(await code(svc.deliveryArea(staff, { merchantOrgId: other.id }))).toBe('forbidden');
    expect(await code(svc.deliveryArea({ personId: 'f1', sessionId: 'z' }, { merchantOrgId: khalid.id }))).toBe('forbidden'); // frozen grant
  });
});

describe('MerchantService — where my customers are (maps program r6)', () => {
  /** Delivered khalid orders, one per zone listed, placed now; plus noise that must not count. */
  async function delivered(base: Awaited<ReturnType<typeof setup>>, zones: readonly string[]) {
    const { h, khalid, other } = base;
    const place = (merchantOrgId: string, zoneKey: string) =>
      h.orders.place('c1', { ...h.foodInput({ merchantOrgId, dropoff: { zoneKey, pin: HOME } }), deliveryFeeIqd: undefined, serviceFeeIqd: undefined });
    for (const zoneKey of zones) {
      const o = await place(khalid.id, zoneKey);
      await h.repo.update(o.id, { state: 'delivered', deliveredAt: h.clock.now() });
    }
    // Not delivered yet, and another store's delivered order: neither counts.
    await place(khalid.id, 'zakur');
    h.merchants.add(other.id, { location: { zoneKey: 'centre', pin: KITCHEN } });
    const theirs = await place(other.id, 'zakur');
    await h.repo.update(theirs.id, { state: 'delivered', deliveredAt: h.clock.now() });
  }

  it('names zones with 5 or more delivered orders, sums the rest into “other”, most first', async () => {
    const base = await setup();
    await delivered(base, [...Array<string>(7).fill('zakur'), ...Array<string>(5).fill('hashimi'), ...Array<string>(4).fill('khamas'), 'deir']);
    const view = await base.svc.customerZones(base.owner, { merchantOrgId: base.khalid.id, days: 30 });
    expect(view.zones).toEqual([
      { key: 'zakur', name_ar: 'زاكور', name_en: 'Zakur', orders: 7 },
      { key: 'hashimi', name_ar: 'الهاشمي', name_en: 'Al-Hashimi', orders: 5 },
    ]);
    expect(view).toMatchObject({ otherOrders: 5, totalOrders: 17, minOrders: CUSTOMER_ZONE_MIN_ORDERS, days: 30 });
    // Counts only: no order, customer or pin leaves the server.
    expect(JSON.stringify(view)).not.toMatch(/c1|lat|lng|orderId/);
  });

  it('only counts the window', async () => {
    const base = await setup();
    base.h.clock.set('2026-09-01T09:00:00Z');
    await delivered(base, Array<string>(6).fill('zakur'));
    base.h.clock.set('2026-10-03T09:00:00Z'); // 32 days later
    const view = await base.svc.customerZones(base.owner, { merchantOrgId: base.khalid.id, days: 30 });
    expect(view).toMatchObject({ zones: [], otherOrders: 0, totalOrders: 0 });
    expect((await base.svc.customerZones(base.owner, { merchantOrgId: base.khalid.id, days: 90 })).zones).toEqual([{ key: 'zakur', name_ar: 'زاكور', name_en: 'Zakur', orders: 6 }]);
  });

  it('refuses people who don’t work at the store', async () => {
    const { svc, staff, other, khalid } = await setup();
    expect(await code(svc.customerZones({ personId: 'nobody', sessionId: 'z' }, { merchantOrgId: khalid.id, days: 30 }))).toBe('forbidden');
    expect(await code(svc.customerZones(staff, { merchantOrgId: other.id, days: 30 }))).toBe('forbidden');
  });

  it('is the owner’s alone, like the money screens (Ali 2026-10-07); staff keep the delivery area', async () => {
    const { svc, staff, owner, khalid } = await setup();
    expect(await code(svc.customerZones(staff, { merchantOrgId: khalid.id, days: 30 }))).toBe('forbidden');
    expect(await code(svc.customerZones(owner, { merchantOrgId: khalid.id, days: 30 }))).toBe('ok');
    expect(await code(svc.deliveryArea(staff, { merchantOrgId: khalid.id }))).toBe('ok');
  });
});
