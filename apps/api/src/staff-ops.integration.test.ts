import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AnnounceInput, DriverError, HoldSeatInput, type Actor, type Trip } from '@driver/contracts';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { AppModule } from './app.module.js';
import { AuditLogService } from './modules/controls/index.js';
import { IdentityService } from './modules/identity/index.js';
import { OrdersRpc, OrdersService, OrdersStaffService } from './modules/orders/index.js';
import { DeparturesService, RoutesRpc } from './modules/routes/index.js';
import { TripsService } from './modules/trips/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import { PrismaService } from './shared/db/prisma.service.js';

/**
 * W3 staff way-outs on a real Postgres (migrated + seeded), every money switch on through the env the
 * app reads at boot: a staff cancel, the open-cash cap, a complaint resolved with a partial refund and
 * a courier who vanished with the food, and a الرجعة departure whose driver never came. Each mutation leaves its `console_audit_log` row, its outbox
 * event and (where money moves) its ledger group. Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];
const KITCHEN = { lat: 32.9105, lng: 45.0665 };
const STREET_30 = { lat: 32.9098, lng: 45.0628 };
const SWITCHES = {
  DISPUTE_OUTCOMES: 'all',
  PLATFORM_FAILURE_FREE_CANCEL: 'on',
  OPEN_CASH_CAP: 'on',
  CASH_DEBT_BLOCK: 'on',
  COURIER_LOST_REFUND: 'on',
  COURIER_LOST_CHARGE: 'on',
} as const;

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof DriverError ? e.code : String(e)));

describe.skipIf(!url)('W3 staff way-outs on Postgres (needs DATABASE_URL)', () => {
  const clock = new FakeClock('2026-10-03T10:00:00Z'); // Saturday 13:00 in Baghdad: kitchens open
  const run = Date.now().toString(36);
  const phone = (n: number) => `0772${String((Date.now() + n) % 10_000_000).padStart(7, '0')}`;
  const saved: Record<string, string | undefined> = {};
  const khalid = AZIZIYAH_RESTAURANTS.find((r) => r.key === 'khalid')!;
  const people = { customer: '', customer2: '', courier: '', courier2: '', ops: '', owner: '' };
  let app: INestApplication;
  let db: PrismaService['prisma'];
  const as = (personId: string): Actor => ({ personId, sessionId: `s_${run}` });

  const foodInput = () => ({
    cityId: 'aziziyah',
    type: 'food' as const,
    merchantOrgId: khalid.orgId,
    lines: [{ catalogItemId: `${khalid.orgId}_pepsi`, qty: 8 }],
    dropoff: { zoneKey: 'street_30', pin: STREET_30 },
  });

  const audits = (orderId: string) => db.consoleAuditLog.findMany({ where: { subjectKind: 'order', subjectId: orderId }, orderBy: { at: 'asc' } });
  const outboxTypes = async (orderId: string) => (await db.event.findMany({ where: { aggregate: 'order', aggregateId: orderId }, select: { type: true } })).map((e) => e.type);
  const groupLines = (groupId: string) => db.ledgerEvent.findMany({ where: { postingGroupId: groupId } });

  /** Placed, accepted by the kitchen, carried by `courier` (the dispatch accept stood in by the row it writes) and picked up. */
  async function onTheWay(customer: string, courier: string) {
    const orders = app.get(OrdersService);
    const trips = app.get(TripsService);
    const o = await orders.place(customer, foodInput());
    await waitFor('the kitchen offer', async () => (await db.order.findUnique({ where: { id: o.id } }))?.merchantOfferedAt);
    await orders.merchantAccept(people.owner, { orderId: o.id, prepMinutes: 15 });
    const trip: Trip = await waitFor('the courier trip', () => trips.activeForOrder(o.id));
    await db.trip.update({ where: { id: trip.id }, data: { courierId: courier, acceptedAt: clock.now(), state: 'en_route_to_pickup' } });
    const pickup = trip.stops.find((s) => s.type === 'pickup')!;
    await trips.arrive(trip.id, pickup.id, courier, { pin: KITCHEN });
    await trips.completeStop(trip.id, pickup.id, courier);
    await waitFor('picked up', async () => (await orders.get(o.id)).state === 'picked_up');
    return { order: await orders.get(o.id), trip };
  }

  beforeAll(async () => {
    for (const [k, v] of Object.entries(SWITCHES)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
    db = app.get(PrismaService).prisma;
    const identity = app.get(IdentityService);
    people.customer = await identity.ensurePersonByPhone(phone(1), 'system:test', 'staff_ops_it');
    people.customer2 = await identity.ensurePersonByPhone(phone(2), 'system:test', 'staff_ops_it');
    people.courier = await identity.ensurePersonByPhone(phone(3), 'system:test', 'staff_ops_it');
    people.courier2 = await identity.ensurePersonByPhone(phone(4), 'system:test', 'staff_ops_it');
    people.ops = await identity.ensurePersonByPhone(phone(5), 'system:test', 'staff_ops_it');
    await db.role.create({ data: { personId: people.ops, kind: 'support' } });
    // The kitchen's tap (orders.merchantAccept takes the actor the merchant router already checked).
    people.owner = await identity.ensurePersonByPhone(phone(6), 'system:test', 'staff_ops_it');
  }, 60_000);

  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (!app) return;
    for (let i = 0; i < 50 && (await db.outbox.count({ where: { status: 'pending', attempts: 0 } })) > 0; i++) await new Promise((r) => setTimeout(r, 100));
    await app.close();
  });

  it('SEC-10 / M-4: the open-cash cap refuses a second cash order of a new account; a staff cancel frees it and leaves its audit row', async () => {
    const orders = app.get(OrdersService);
    const rpc = app.get(OrdersRpc);
    const first = await orders.place(people.customer, foodInput());
    expect(await rpc.cashStanding(as(people.customer))).toMatchObject({ openCashOrders: 1, openCashLimit: 1, cashAllowed: false, blockedBy: 'open_cash_orders_cap' });
    expect(await code(orders.place(people.customer, foodInput()))).toBe('open_cash_orders_cap');

    const r = await rpc.opsCancel(as(people.ops), { orderId: first.id, reason: 'المطعم ما يرد', onBehalfOfCustomer: false });
    expect(r).toMatchObject({ orderId: first.id, state: 'platform_cancelled', changed: true, postedIqd: 0 });
    expect(r.auditId).toEqual(expect.any(String));
    expect((await audits(first.id)).map((a) => [a.action, a.actorId])).toEqual([['order.ops_cancel', people.ops]]);
    expect(await outboxTypes(first.id)).toEqual(expect.arrayContaining(['order.cancelled', 'order.ops_cancelled']));
    // A replay changes nothing and writes no second row.
    expect(await rpc.opsCancel(as(people.ops), { orderId: first.id, reason: 'مرة ثانية', onBehalfOfCustomer: false })).toMatchObject({ changed: false });
    expect(await audits(first.id)).toHaveLength(1);

    expect(await rpc.cashStanding(as(people.customer))).toMatchObject({ openCashOrders: 0, cashAllowed: true, blockedBy: null });
    const again = await orders.place(people.customer, foodInput());
    await rpc.opsCancel(as(people.ops), { orderId: again.id, reason: 'تجربة', onBehalfOfCustomer: false });
  }, 60_000);

  it('NTF-10: a cancel on behalf of the customer and its audit row are one unit of work: a failed audit write rolls the cancel back', async () => {
    const orders = app.get(OrdersService);
    const rpc = app.get(OrdersRpc);
    const audit = app.get(AuditLogService);
    const o = await orders.place(people.customer, foodInput());
    const record = audit.record.bind(audit);
    audit.record = async () => {
      throw new Error('audit write failed');
    };
    try {
      expect(await code(rpc.opsCancel(as(people.ops), { orderId: o.id, reason: 'اتصل وطلب يلغي', onBehalfOfCustomer: true }))).toContain('audit write failed');
    } finally {
      audit.record = record;
    }
    expect((await db.order.findUnique({ where: { id: o.id } }))?.state).toBe('placed');
    expect(await outboxTypes(o.id)).not.toContain('order.cancelled');
    // The retry cancels and audits.
    const r = await rpc.opsCancel(as(people.ops), { orderId: o.id, reason: 'اتصل وطلب يلغي', onBehalfOfCustomer: true });
    expect(r).toMatchObject({ state: 'customer_cancelled', changed: true });
    expect((await audits(o.id)).map((a) => a.action)).toEqual(['order.ops_cancel']);
  }, 60_000);

  it('NTF-01 / M-1: a complaint resolved with a partial refund from the kitchen posts one refund group, once', async () => {
    const orders = app.get(OrdersService);
    const trips = app.get(TripsService);
    const rpc = app.get(OrdersRpc);
    const { order, trip } = await onTheWay(people.customer2, people.courier);
    const drop = trip.stops.find((s) => s.type === 'dropoff')!;
    await trips.arrive(trip.id, drop.id, people.courier, { pin: STREET_30 });
    await trips.completeStop(trip.id, drop.id, people.courier, { handover: { cashCollectedIqd: order.totalIqd } });
    await waitFor('delivered', async () => (await orders.get(order.id)).state === 'delivered');
    await orders.openDispute(people.customer2, { orderId: order.id, kind: 'wrong_item' });

    const input = { orderId: order.id, outcome: 'refund_partial' as const, amountIqd: 2_000, reason: 'نقص بالطلب', faultParty: 'merchant' as const };
    const r = await rpc.opsResolveDispute(as(people.ops), input);
    expect(r).toMatchObject({ orderId: order.id, state: 'closed', changed: true, postedIqd: 2_000 });
    // One refund group per dispute episode: its id carries the `order.disputed` event's id.
    const disputed = await db.event.findFirstOrThrow({ where: { aggregate: 'order', aggregateId: order.id, type: 'order.disputed' } });
    const groupId = `dispute:${order.id}:${disputed.id}:refund`;
    const refund = await waitFor('the refund group', async () => {
      const lines = await groupLines(groupId);
      return lines.length > 0 ? lines : null;
    });
    expect(refund).toEqual([expect.objectContaining({ type: 'refund', amountIqd: 2_000, fromAccount: `merchant_cash:${khalid.orgId}`, toAccount: `customer:${people.customer2}` })]);
    expect((await audits(order.id)).map((a) => a.action)).toEqual(['order.ops_resolve_dispute']);
    expect(await outboxTypes(order.id)).toEqual(expect.arrayContaining(['order.disputed', 'order.closed', 'order.dispute_resolved']));

    expect(await rpc.opsResolveDispute(as(people.ops), { ...input, outcome: 'refund_full', amountIqd: undefined })).toMatchObject({ changed: false });
    expect(await groupLines(groupId)).toHaveLength(1);
    expect(await audits(order.id)).toHaveLength(1);
  }, 60_000);

  it('NTF-13 / M-10: a courier who vanished with the food — refunded at once, the kitchen paid, the courier charged once', async () => {
    const rpc = app.get(OrdersRpc);
    const { order } = await onTheWay(people.customer2, people.courier2);
    const r = await rpc.opsCourierLost(as(people.ops), { orderId: order.id, reason: 'الدليفري اختفى' });
    expect(r).toMatchObject({ state: 'refunded', changed: true, postedIqd: order.itemsTotalIqd });
    expect(await groupLines(`order:${order.id}:courier_lost:kitchen`)).toEqual([
      expect.objectContaining({ type: 'credit_issued', amountIqd: order.itemsTotalIqd, fromAccount: 'platform', toAccount: `merchant_cash:${khalid.orgId}` }),
    ]);
    const c = await rpc.opsChargeCourier(as(people.ops), { orderId: order.id, reason: 'تأكدنا منه' });
    expect(c).toMatchObject({ changed: true, postedIqd: order.itemsTotalIqd });
    expect(await groupLines(`order:${order.id}:courier_lost:charge`)).toEqual([
      expect.objectContaining({ type: 'adjustment', amountIqd: order.itemsTotalIqd, fromAccount: `cash:${people.courier2}`, toAccount: 'platform' }),
    ]);
    expect((await rpc.opsChargeCourier(as(people.ops), { orderId: order.id, reason: 'مرة ثانية' })).changed).toBe(false);
    expect((await audits(order.id)).map((a) => a.action)).toEqual(['order.ops_courier_lost', 'order.ops_charge_courier']);
    expect(await outboxTypes(order.id)).toEqual(expect.arrayContaining(['order.disputed', 'order.courier_lost']));
    // The staff's free text stays in the audit row: not in the dispute's event.
    const opened = await db.event.findFirstOrThrow({ where: { aggregate: 'order', aggregateId: order.id, type: 'order.disputed' } });
    expect(JSON.stringify(opened.payload)).not.toContain('الدليفري اختفى');
    // The stuck list no longer shows it.
    expect((await app.get(OrdersStaffService).stuck({ cityId: 'aziziyah', limit: 500 })).some((s) => s.orderId === order.id)).toBe(false);
  }, 60_000);

  it('NTF-14: a staff cancel of a departure moves nobody into a fee, leaves its audit row and the ledger-facing event', async () => {
    const departures = app.get(DeparturesService);
    const routes = app.get(RoutesRpc);
    const at = (min: number) => new Date(clock.now().getTime() + min * 60_000);
    const driver = people.courier;
    const dep = await departures.announce(
      driver,
      AnnounceInput.parse({ garageId: 'mp_garage_bab1', corridorId: 'aziziyah_baghdad', departAt: at(120), latestDepartureAt: at(150), vehicle: { kind: 'saloon', layout: 4, plate: `واسط ${run}` } }),
    );
    const held = await departures.hold(people.customer, HoldSeatInput.parse({ departureId: dep.id, selection: { kind: 'seats', seatIds: ['front'] }, travellingAs: 'rijal' }));
    await departures.book(people.customer, held.id, 'cash');
    expect(await routes.overdueDepartures(as(people.ops), { limit: 200 })).toEqual(expect.any(Array));

    const r = await routes.opsCancelDeparture(as(people.ops), { departureId: dep.id, reason: 'السايق ما يرد' });
    expect(r).toMatchObject({ departureId: dep.id, state: 'cancelled_by_driver', changed: true });
    expect((await db.departure.findUnique({ where: { id: dep.id } }))?.state).toBe('cancelled_by_driver');
    const rows = await db.consoleAuditLog.findMany({ where: { subjectKind: 'departure', subjectId: dep.id } });
    expect(rows.map((x) => [x.action, x.actorId])).toEqual([['departure.ops_cancel', people.ops]]);
    const types = (await db.event.findMany({ where: { aggregate: 'departure', aggregateId: dep.id }, select: { type: true, payload: true } }));
    expect(types.find((e) => e.type === 'departure.cancelled')?.payload).toMatchObject({ cancelledBy: 'driver', feeIqd: 0 });
    expect(types.find((e) => e.type === 'departure.ops_cancelled')?.payload).toMatchObject({ reason: 'ops', auto: false });
    // The free-text reason lives only in the audit row, never on the departure or its events.
    expect((await db.departure.findUnique({ where: { id: dep.id } }))?.cancellationReason).toBe('ops');
    expect(JSON.stringify(types)).not.toContain('السايق ما يرد');
    expect(rows[0]!.summaryAr).toContain('السايق ما يرد');
    expect(await routes.opsCancelDeparture(as(people.ops), { departureId: dep.id, reason: 'مرة ثانية' })).toMatchObject({ changed: false });
    expect(await db.consoleAuditLog.count({ where: { subjectKind: 'departure', subjectId: dep.id } })).toBe(1);
  }, 60_000);
});
