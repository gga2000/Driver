import { describe, expect, it } from 'vitest';
import { EtaService, StraightLineRouter } from '../routing/index.js';
import { DriverError, type RoleKind } from '@driver/contracts';
import { OrgsMerchantDirectory } from '../orders/merchants.port.js';
import { OrdersStorefrontMerchants } from '../orders/storefront.port.js';
import { HARNESS_MENU, KITCHEN, ordersHarness } from '../orders/test-harness.js';
import { OrgsService } from '../orgs/index.js';
import { MerchantService, type MerchantEventsPort, type MerchantPeoplePort, type MerchantPhotosPort } from './merchant.service.js';

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
  const svc = new MerchantService(h.orders, h.trips, people, orgs, { itemNames: async (_org, ids) => new Map(ids.map((id) => [id, names.get(id) ?? id])) }, events, h.clock, new EtaService(new StraightLineRouter()), opts.photos ?? null);
  const staff = { personId: 's1', sessionId: 'x' };
  const owner = { personId: 'o1', sessionId: 'y' };
  return { h, orgs, svc, khalid, other, staff, owner, recorded, nameReads };
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
