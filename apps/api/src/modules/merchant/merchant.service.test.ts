import { describe, expect, it } from 'vitest';
import { DriverError, type RoleKind } from '@driver/contracts';
import { OrgsMerchantDirectory } from '../orders/merchants.port.js';
import { OrdersStorefrontMerchants } from '../orders/storefront.port.js';
import { HARNESS_MENU, KITCHEN, ordersHarness } from '../orders/test-harness.js';
import { OrgsService } from '../orgs/index.js';
import { MerchantService, type MerchantEventsPort, type MerchantPeoplePort } from './merchant.service.js';

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
async function setup() {
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
    courierVehicle: async () => 'bike',
  };
  const recorded: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const events: MerchantEventsPort = {
    record: async (type, _actor, _org, payload) => {
      recorded.push({ type, payload });
    },
  };
  const names = new Map(HARNESS_MENU.map((m) => [m.id, m.nameAr]));
  const svc = new MerchantService(h.orders, h.trips, people, orgs, { itemNames: async (_org, ids) => new Map(ids.map((id) => [id, names.get(id) ?? id])) }, events, h.clock);
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
