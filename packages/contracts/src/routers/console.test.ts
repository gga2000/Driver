import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import type { RoleKind } from '../auth.js';
import type { ConsolePort, DriverPin, EventLogEntry, MerchantRow, OrderSummary } from '../console-io.js';
import { appRouter } from '../router.js';
import { t, type AppContext } from '../trpc.js';
import { CONSOLE_READ_ROLES } from './console.js';

const AT = new Date('2026-10-03T09:00:00Z');

const pin: DriverPin = {
  driverId: 'd1',
  cityId: 'aziziyah',
  lat: 32.91,
  lng: 45.06,
  heading: null,
  state: 'free',
  vehicleClass: 'bike',
  tier: 'bronze',
  zoneId: 'centre',
  lastSeenAt: AT,
  cashHeldIqd: 12_000,
  owedIqd: 9_000,
  capIqd: 50_000,
  overCap: false,
  tripId: null,
};

const summary: OrderSummary = {
  id: 'ord_1',
  cityId: 'aziziyah',
  type: 'food',
  state: 'delivered',
  ordererId: 'p1',
  merchantOrgId: 'org_1',
  paymentMethod: 'cash',
  totalIqd: 16_500,
  placedAt: AT,
  acceptedAt: AT,
  promisedReadyAt: null,
  pickedUpAt: null,
  deliveredAt: AT,
  closedAt: null,
  cancelledAt: null,
  late: false,
  lateMin: null,
  zoneKey: 'centre',
};

const event: EventLogEntry = {
  id: 'ev_1',
  actorId: 'p1',
  type: 'order.placed',
  occurredAt: AT,
  recordedAt: AT,
  orderId: 'ord_1',
  payload: { totalIqd: 16_500 },
  aggregate: 'order',
  aggregateId: 'ord_1',
  skewMs: 0,
  flagged: false,
  quarantined: true,
  quarantineReason: 'late_replay',
};

const merchant: MerchantRow = {
  merchantId: 'org_1',
  name: 'مطعم الكبة',
  type: 'restaurant',
  cityId: 'aziziyah',
  balanceIqd: 30_000,
  mode: 'nightly_courier',
  exposureCapIqd: 300_000,
  overExposure: false,
  lastHeartbeatAt: null,
};

function fakePort(): ConsolePort {
  return {
    driverPositions: vi.fn(async (cityId: string) => ({ cityId, at: AT, drivers: [pin] })),
    driversList: vi.fn(async () => ({ rows: [], nextCursor: null, total: 0 })),
    searchOrders: vi.fn(async () => ({ rows: [summary], nextCursor: 'c1' })),
    orderEvents: vi.fn(async () => [event]),
    orderLedger: vi.fn(async () => [{ id: 'l1', at: AT, type: 'merchant_payable', label_ar: 'مستحق المطعم', amountIqd: 12_000, fromAccount: 'platform', toAccount: 'merchant_cash:org_1', memo: null }]),
    tripEvents: vi.fn(async () => [event]),
    rightNow: vi.fn(async (cityId: string) => ({
      cityId,
      at: AT,
      ordersLastHour: 3,
      activeOrders: 2,
      lateOrders: 1,
      activeDrivers: 4,
      avgTimeToAcceptSec: null,
      cashInFieldIqd: 45_000,
      outbox: { pending: 0, failed: 1 },
    })),
    outbox: vi.fn(async () => ({
      pending: 2,
      published: 10,
      failed: 1,
      recentFailed: [{ id: 'ob_1', eventId: 'ev_1', type: 'order.placed', aggregate: 'order', aggregateId: 'ord_1', attempts: 10, lastError: 'boom', createdAt: AT }],
    })),
    merchants: vi.fn(async () => [merchant]),
    names: vi.fn(async () => ({
      people: { d1: { displayName: 'حيدر ك.', deleted: false, vehicleClass: 'bike' as const, plate: 'واسط 45671' } },
      orgs: { org_1: { name: 'مطعم الكبة', type: 'restaurant' } },
      items: {},
    })),
    simulatorStatus: vi.fn(async () => ({ available: false })),
    simulatorStart: vi.fn(async () => ({ available: false })),
    simulatorStop: vi.fn(async () => ({ available: false })),
  };
}

function caller(roles: readonly RoleKind[] | null, port = fakePort()) {
  const ctx = {
    auth: roles ? { sub: 'p_staff', sid: 's1', iss: 'driver-api', iat: 0, exp: 0 } : null,
    authError: null,
    identity: { hasRole: async (_: string, kind: RoleKind) => (roles ?? []).includes(kind) },
    console: port,
  } as unknown as AppContext;
  return { call: t.createCallerFactory(appRouter)(ctx), port };
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(TRPCError);
  return (err as TRPCError).code;
}

type Call = ReturnType<typeof caller>['call'];
const READS: Array<[string, (c: Call) => Promise<unknown>]> = [
  ['dispatch.drivers', (c) => c.dispatch.drivers({ cityId: 'aziziyah' })],
  ['drivers.list', (c) => c.drivers.list({ cityId: 'aziziyah' })],
  ['orders.search', (c) => c.orders.search({ cityId: 'aziziyah' })],
  ['orders.events', (c) => c.orders.events({ orderId: 'ord_1' })],
  ['orders.ledger', (c) => c.orders.ledger({ orderId: 'ord_1' })],
  ['trips.events', (c) => c.trips.events({ tripId: 'trp_1' })],
  ['console.rightNow', (c) => c.console.rightNow({ cityId: 'aziziyah' })],
  ['system.outbox', (c) => c.system.outbox()],
  ['system.simulator.status', (c) => c.system.simulator.status()],
  ['merchants.list', (c) => c.merchants.list({ cityId: 'aziziyah' })],
  ['console.names', (c) => c.console.names({ personIds: ['d1'] })],
];

describe('console read procedures: role gating', () => {
  it.each(READS)('%s needs a session', async (_name, run) => {
    expect(await codeOf(run(caller(null).call))).toBe('UNAUTHORIZED');
  });

  it.each(READS)('%s refuses customers and drivers', async (_name, run) => {
    expect(await codeOf(run(caller(['customer', 'courier', 'merchant_owner']).call))).toBe('FORBIDDEN');
  });

  it.each(READS)('%s is open to dispatcher, support, finance and admin', async (_name, run) => {
    for (const role of CONSOLE_READ_ROLES) await expect(run(caller([role]).call)).resolves.toBeDefined();
  });

  it('simulator start/stop: admin and dispatcher only', async () => {
    expect(await codeOf(caller(['support', 'finance']).call.system.simulator.start({ cityId: 'aziziyah' }))).toBe('FORBIDDEN');
    expect(await codeOf(caller(['finance']).call.system.simulator.stop())).toBe('FORBIDDEN');
    await expect(caller(['dispatcher']).call.system.simulator.stop()).resolves.toMatchObject({ available: false });
  });
});

describe('console read procedures: shapes', () => {
  it('dispatch.drivers passes the city and returns pins with dates', async () => {
    const { call, port } = caller(['dispatcher']);
    const res = await call.dispatch.drivers({ cityId: 'aziziyah' });
    expect(port.driverPositions).toHaveBeenCalledWith('aziziyah');
    expect(res.drivers[0]).toEqual(pin);
    expect(res.at).toBeInstanceOf(Date);
  });

  it('drivers.list fills filter and limit defaults', async () => {
    const { call, port } = caller(['support']);
    await call.drivers.list({ cityId: 'aziziyah' });
    expect(port.driversList).toHaveBeenCalledWith({ cityId: 'aziziyah', filter: { presence: 'all' }, limit: 50 }, 'p_staff');
    await call.drivers.list({ cityId: 'aziziyah', filter: { name: '  حيدر ', tier: 'gold', docsExpiring: true } });
    expect(port.driversList).toHaveBeenLastCalledWith({ cityId: 'aziziyah', filter: { presence: 'all', name: 'حيدر', tier: 'gold', docsExpiring: true }, limit: 50 }, 'p_staff');
    expect(await codeOf(call.drivers.list({ cityId: 'aziziyah', filter: { tier: 'platinum' as never } }))).toBe('BAD_REQUEST');
    expect(await codeOf(call.drivers.list({ cityId: 'aziziyah', limit: 500 }))).toBe('BAD_REQUEST');
  });

  it('orders.search coerces dates, defaults the limit and rejects bad states', async () => {
    const { call, port } = caller(['finance']);
    const res = await call.orders.search({ cityId: 'aziziyah', states: ['delivered'], from: '2026-10-01T00:00:00Z' as unknown as Date, text: '  kebab ' });
    expect(port.searchOrders).toHaveBeenCalledWith({ cityId: 'aziziyah', states: ['delivered'], from: new Date('2026-10-01T00:00:00Z'), text: 'kebab', limit: 50 });
    expect(res).toEqual({ rows: [summary], nextCursor: 'c1' });
    expect(await codeOf(call.orders.search({ cityId: 'aziziyah', states: ['teleported' as never] }))).toBe('BAD_REQUEST');
    await call.orders.search({ cityId: 'aziziyah', paymentMethod: 'cash', zoneKey: ' zakur ', late: true });
    expect(port.searchOrders).toHaveBeenLastCalledWith({ cityId: 'aziziyah', paymentMethod: 'cash', zoneKey: 'zakur', late: true, limit: 50 });
    expect(await codeOf(call.orders.search({ cityId: 'aziziyah', paymentMethod: 'card' as never }))).toBe('BAD_REQUEST');
  });

  it('orders.ledger returns the order lines with dates', async () => {
    const { call, port } = caller(['support']);
    const [line] = await call.orders.ledger({ orderId: 'ord_1' });
    expect(port.orderLedger).toHaveBeenCalledWith('ord_1');
    expect(line).toMatchObject({ toAccount: 'merchant_cash:org_1', amountIqd: 12_000, memo: null });
    expect(line?.at).toBeInstanceOf(Date);
  });

  it('event logs keep the quarantine marks', async () => {
    const { call } = caller(['support']);
    const [e] = await call.orders.events({ orderId: 'ord_1' });
    expect(e).toMatchObject({ quarantined: true, quarantineReason: 'late_replay', aggregate: 'order' });
    expect((await call.trips.events({ tripId: 'trp_1' }))[0]?.id).toBe('ev_1');
  });

  it('console.names: the staff member asking is the vault accessor; defaults and the batch cap', async () => {
    const { call, port } = caller(['support']);
    const res = await call.console.names({ personIds: [' d1 '], orgIds: ['org_1'] });
    expect(port.names).toHaveBeenCalledWith({ personIds: ['d1'], orgIds: ['org_1'], items: [] }, 'p_staff');
    expect(res.people['d1']).toEqual({ displayName: 'حيدر ك.', deleted: false, vehicleClass: 'bike', plate: 'واسط 45671' });
    const tooMany = Array.from({ length: 201 }, (_, i) => `p${i}`);
    expect(await codeOf(call.console.names({ personIds: tooMany }))).toBe('BAD_REQUEST');
  });

  it('rightNow, outbox and merchants round-trip', async () => {
    const { call } = caller(['admin']);
    expect((await call.console.rightNow({ cityId: 'aziziyah' })).outbox).toEqual({ pending: 0, failed: 1 });
    expect((await call.system.outbox()).recentFailed[0]?.lastError).toBe('boom');
    expect(await call.merchants.list({ cityId: 'aziziyah' })).toEqual([merchant]);
  });

  it('simulator stubs answer {available:false} with the defaults filled in', async () => {
    const { call } = caller(['admin']);
    expect(await call.system.simulator.status()).toEqual({ available: false, running: false, startedAt: null, drivers: 0, ordersPerHour: 0 });
    const { call: c2, port } = caller(['admin']);
    await c2.system.simulator.start({ cityId: 'aziziyah' });
    expect(port.simulatorStart).toHaveBeenCalledWith({ cityId: 'aziziyah', drivers: 20, ordersPerHour: 60 });
  });

  it('a port returning the wrong shape is a server error, not a leak', async () => {
    const port = fakePort();
    port.rightNow = async () => ({ cityId: 'aziziyah' }) as never;
    expect(await codeOf(caller(['admin'], port).call.console.rightNow({ cityId: 'aziziyah' }))).toBe('INTERNAL_SERVER_ERROR');
  });
});
