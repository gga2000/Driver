import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { CatalogService, PrismaCatalogRepository } from '../catalog/index.js';
import { ConfigService } from '../config/index.js';
import { PricingService } from '../pricing/index.js';
import { RecordingTripEvents, ScriptedOfferCheck, TripsService, type TripTimerJob } from '../trips/index.js';
import { PrismaTripsRepository } from '../trips/trips.repository.js';
import { RecordingOrderEvents } from './events.adapter.js';
import { InMemoryMerchantDirectory } from './merchants.port.js';
import { AZIZIYAH_MONEY_RULES, type OrderMoneyPayload } from '@driver/contracts';
import { LedgerService } from '../ledger/ledger.service.js';
import { postOrderClosed } from '../ledger/postings.js';
import { PrismaLedgerRepository, type LedgerEventDelegate } from '../ledger/prisma.repository.js';
import { PrismaOrdersRepository } from './orders.repository.js';
import { OrdersService, type OrderTimerJob } from './orders.service.js';
import { HOME, KITCHEN, fakePhoneHash } from './test-harness.js';

/**
 * Orders + trips on a real Postgres+PostGIS (plan Step 4 integration): the Prisma repositories,
 * the raw-SQL geography columns (stop target pins, arrival pins, trail points), conditional state
 * updates and `trip_orders` history. Needs DATABASE_URL with the migrations deployed and the seed
 * (city `aziziyah`) loaded. Skipped otherwise.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('orders × trips on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const uow = new UnitOfWork(prisma);
  const clock = new FakeClock('2026-10-03T09:00:00Z');
  const tripsRepo = new PrismaTripsRepository(prisma);
  const tripEvents = new RecordingTripEvents();
  const trips = new TripsService(tripsRepo, tripEvents, uow, clock, new InMemoryQueue<TripTimerJob>('trips.timers', () => clock.now()));
  trips.bindOfferCheck(new ScriptedOfferCheck()); // dispatch's open-offer check, stood in
  const merchants = new InMemoryMerchantDirectory();
  const events = new RecordingOrderEvents();
  const catalog = new CatalogService(new PrismaCatalogRepository(prisma));
  const orders = new OrdersService(
    new PrismaOrdersRepository(prisma),
    events,
    uow,
    clock,
    new InMemoryQueue<OrderTimerJob>('orders.timers', () => clock.now()),
    trips,
    new PricingService(new ConfigService()),
    merchants,
    { resolvePhone: async (phone) => ({ personId: null, phoneHash: fakePhoneHash(phone) }) },
    { newCustomerCash: async () => ({ allowed: true, requiresArrivingCall: false, priorCashOrders: 3 }) },
    catalog,
  );
  trips.bindHandoverCheck({ check: (orderId, h) => (orderId ? orders.handoverProblem(orderId, h) : Promise.resolve(null)) });
  tripEvents.onEvent((e) => orders.onTripEvent({ type: e.type, tripId: e.tripId!, actorId: e.actorId, occurredAt: e.occurredAt, ...(e.orderId ? { orderId: e.orderId } : {}), payload: e.payload }));
  const ids = { customer: '', courier: '', org: '', order: '', trip: '', item: '' };

  beforeAll(async () => {
    const db = prisma.prisma;
    ids.customer = (await db.person.create({ data: {} })).id;
    ids.courier = (await db.person.create({ data: {} })).id;
    ids.org = (await db.org.create({ data: { type: 'restaurant', name: 'مطعم اختبار', cityId: 'aziziyah' } })).id;
    merchants.add(ids.org, { location: { zoneKey: 'centre' } });
    // Review C2: the line is priced from this row, not from the client.
    ids.item = (await catalog.addItem({ orgId: ids.org, nameAr: 'كباب', priceIqd: 5000, modifierGroups: [{ nameAr: 'خبز', modifiers: [{ nameAr: 'صمون', priceIqd: 0 }] }] })).id;
  });

  afterAll(async () => {
    const db = prisma.prisma;
    if (ids.trip) {
      await db.stop.deleteMany({ where: { tripId: ids.trip } });
      await db.tripOrder.deleteMany({ where: { tripId: ids.trip } });
      await db.$executeRaw`DELETE FROM "public"."trail_points" WHERE trip_id = ${ids.trip}`;
      await db.trip.deleteMany({ where: { id: ids.trip } });
    }
    if (ids.order) {
      await db.orderLine.deleteMany({ where: { orderId: ids.order } });
      await db.participant.deleteMany({ where: { orderId: ids.order } });
      await db.order.deleteMany({ where: { id: ids.order } });
    }
    await db.modifier.deleteMany({ where: { group: { item: { orgId: ids.org } } } });
    await db.modifierGroup.deleteMany({ where: { item: { orgId: ids.org } } });
    await db.catalogItem.deleteMany({ where: { orgId: ids.org } });
    await db.catalog.deleteMany({ where: { orgId: ids.org } });
    await db.org.deleteMany({ where: { id: ids.org } });
    await db.person.deleteMany({ where: { id: { in: [ids.customer, ids.courier] } } });
    await prisma.onModuleDestroy();
  });

  it('places, accepts, delivers and keeps pins and history in Postgres', async () => {
    const o = await orders.place(ids.customer, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: ids.org,
      participants: [{ ref: 'sis', role: 'diner', phone: '07709998877' }],
      lines: [{ catalogItemId: ids.item, qty: 2, participantRef: 'sis' }],
      dropoff: { zoneKey: 'zakur' },
      deliveryFeeIqd: 1000,
      serviceFeeIqd: 500,
    });
    ids.order = o.id;
    expect(o).toMatchObject({ state: 'placed', totalIqd: 11500, minVehicleClass: 'bike' });
    expect(o.lines[0]).toMatchObject({ catalogItemId: ids.item, unitPriceIqd: 5000 });
    await expect(
      orders.place(ids.customer, { cityId: 'aziziyah', type: 'food', merchantOrgId: ids.org, dropoff: { zoneKey: 'zakur' }, lines: [{ catalogItemId: ids.item, qty: 2, unitPriceIqd: 1 }] }),
    ).rejects.toMatchObject({ code: 'price_changed' });
    expect(o.participants[0]!.phoneOnly).toBe(true);
    await orders.merchantAccept('m', { orderId: o.id, prepMinutes: 10 });

    const t = await trips.createForOrders({
      cityId: 'aziziyah',
      vertical: 'food',
      orders: [{ orderId: o.id, minVehicleClass: 'bike' }],
      stops: [
        { orderId: o.id, type: 'pickup', zoneKey: 'centre', target: KITCHEN },
        { orderId: o.id, type: 'dropoff', zoneKey: 'zakur', target: HOME },
      ],
    });
    ids.trip = t.id;
    expect(t.stops[0]!.target!.lat).toBeCloseTo(KITCHEN.lat, 6);
    await trips.offer(t.id);
    await trips.accept(t.id, ids.courier, { vehicleClass: 'bike' });
    const armed = await trips.reportPosition(ids.courier, { tripId: t.id, pin: KITCHEN, at: clock.now() });
    expect(armed.armed.map((a) => a.stopId)).toEqual([t.stops[0]!.id]);
    for (const s of t.stops) {
      await trips.arrive(t.id, s.id, ids.courier, { pin: s.target! });
      await trips.completeStop(t.id, s.id, ids.courier, s.type === 'dropoff' ? { handover: { cashCollectedIqd: 11500 } } : {});
    }
    await tripEvents.deliver();
    const done = await trips.get(t.id);
    expect(done.state).toBe('completed');
    expect(done.stops[1]!.arrivalDistanceM).toBe(0);
    expect((await orders.get(o.id)).state).toBe('delivered');
    expect(await trips.detachedAt(t.id, o.id)).toBeNull();
  });

  it('"الخردة علينا" on Postgres: the stated note and the no-change credit persist, and the ledger takes the new line', async () => {
    const o = await orders.place(ids.customer, { cityId: 'aziziyah', type: 'food', merchantOrgId: ids.org, lines: [{ catalogItemId: ids.item, qty: 2 }], dropoff: { zoneKey: 'zakur' }, statedTenderIqd: 20_000 });
    expect(o).toMatchObject({ totalIqd: 11500, statedTenderIqd: 20_000 });
    await orders.merchantAccept('m', { orderId: o.id, prepMinutes: 10 });
    const t = await trips.createForOrders({
      cityId: 'aziziyah',
      vertical: 'food',
      orders: [{ orderId: o.id, minVehicleClass: 'bike' }],
      stops: [
        { orderId: o.id, type: 'pickup', zoneKey: 'centre', target: KITCHEN },
        { orderId: o.id, type: 'dropoff', zoneKey: 'zakur', target: HOME },
      ],
    });
    await trips.offer(t.id);
    await trips.accept(t.id, ids.courier, { vehicleClass: 'bike' });
    const [pickup, drop] = t.stops;
    await trips.arrive(t.id, pickup!.id, ids.courier, { pin: KITCHEN });
    await trips.completeStop(t.id, pickup!.id, ids.courier);
    await tripEvents.deliver();
    await trips.arrive(t.id, drop!.id, ids.courier, { pin: HOME });
    await expect(trips.completeStop(t.id, drop!.id, ids.courier, { handover: { cashCollectedIqd: 20_000, changeToWalletIqd: 8_000 } })).rejects.toMatchObject({ code: 'change_to_wallet_mismatch' });
    await trips.completeStop(t.id, drop!.id, ids.courier, { handover: { cashCollectedIqd: 20_000, changeToWalletIqd: 8_500 } });
    await tripEvents.deliver();
    const row = await prisma.prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(row).toMatchObject({ state: 'delivered', statedTenderIqd: 20_000, changeToWalletIqd: 8_500 });
    // The enum value exists: the group posts (refs left out so the test rows never pin the order).
    const fact = [...events.events].reverse().find((e) => e.type === 'order.cash_collected' && e.orderId === o.id)!.payload['order'] as OrderMoneyPayload;
    const group = postOrderClosed(fact, AZIZIYAH_MONEY_RULES).money;
    const ledger = new LedgerService(new PrismaLedgerRepository(prisma.prisma.ledgerEvent as unknown as LedgerEventDelegate));
    const res = await ledger.recordAll({ ...group, id: `itest:${o.id}:${Date.now()}`, refs: {} });
    expect(res.events.find((e) => e.type === 'cash_change_to_wallet')).toMatchObject({ amount: 8_500, memo: 'no_change' });
    await prisma.prisma.stop.deleteMany({ where: { tripId: t.id } });
    await prisma.prisma.tripOrder.deleteMany({ where: { tripId: t.id } });
    await prisma.prisma.$executeRaw`DELETE FROM "public"."trail_points" WHERE trip_id = ${t.id}`;
    await prisma.prisma.trip.deleteMany({ where: { id: t.id } });
    await prisma.prisma.orderLine.deleteMany({ where: { orderId: o.id } });
    await prisma.prisma.order.deleteMany({ where: { id: o.id } });
  });

  it('no duplicate orders: one key, simultaneous calls on two API instances → one order, both answered with it', async () => {
    // A second service = a second API instance (its own in-process lock); only Postgres serialises them.
    const other = new OrdersService(
      new PrismaOrdersRepository(prisma),
      events,
      uow,
      clock,
      new InMemoryQueue<OrderTimerJob>('orders.timers', () => clock.now()),
      trips,
      new PricingService(new ConfigService()),
      merchants,
      { resolvePhone: async (phone) => ({ personId: null, phoneHash: fakePhoneHash(phone) }) },
      { newCustomerCash: async () => ({ allowed: true, requiresArrivingCall: false, priorCashOrders: 3 }) },
      catalog,
    );
    const key = `itest_${Date.now().toString(36)}`;
    const input = { cityId: 'aziziyah', type: 'food' as const, merchantOrgId: ids.org, lines: [{ catalogItemId: ids.item, qty: 1 }], dropoff: { zoneKey: 'zakur' }, clientRequestId: key, courierNote: 'دگ الجرس' };
    const answers = await Promise.all([orders.place(ids.customer, input), other.place(ids.customer, input), orders.place(ids.customer, input), other.place(ids.customer, input)]);
    const rows = await prisma.prisma.order.findMany({ where: { ordererId: ids.customer, clientRequestId: key } });
    expect(rows).toHaveLength(1);
    expect(new Set(answers.map((a) => a.id))).toEqual(new Set([rows[0]!.id]));
    expect(answers[0]).toMatchObject({ clientRequestId: key, courierNote: 'دگ الجرس' });
    // The unique index itself (the last line of defence): a raw second insert with the key is refused.
    await expect(prisma.prisma.order.create({ data: { cityId: 'aziziyah', type: 'food', ordererId: ids.customer, clientRequestId: key } })).rejects.toMatchObject({ code: 'P2002' });
    // A replay after the fact is the same order.
    expect((await other.place(ids.customer, input)).id).toBe(rows[0]!.id);
    await prisma.prisma.orderLine.deleteMany({ where: { orderId: rows[0]!.id } });
    await prisma.prisma.order.deleteMany({ where: { id: rows[0]!.id } });
  });

  it("a merchant's orders by placed-at range: one bounded read, the same view as get (review 2026-10-04 #11)", async () => {
    const placedAt = (await orders.get(ids.order)).placedAt;
    const range = { from: new Date(placedAt.getTime() - 3_600_000), to: new Date(placedAt.getTime() + 1) };
    expect(await orders.merchantOrders(ids.org, range)).toEqual([await orders.get(ids.order)]);
    expect(await orders.merchantOrders(ids.org, { from: range.from, to: placedAt })).toEqual([]);
  });

  it("perf z5: the board's misses come from a read of the missed orders only", async () => {
    const placedAt = (await orders.get(ids.order)).placedAt;
    const range = { from: new Date(placedAt.getTime() - 3_600_000), to: new Date(placedAt.getTime() + 60_000) };
    // The fixture order is live, not missed.
    expect(await orders.merchantMissedOrders(ids.org, range)).toEqual([]);
    const at = new Date(placedAt.getTime() + 1_000);
    const base = { cityId: 'aziziyah', type: 'food' as const, ordererId: ids.customer, merchantOrgId: ids.org, placedAt: at };
    const timedOut = await prisma.prisma.order.create({ data: { ...base, state: 'merchant_rejected', cancellationReason: 'merchant_timeout', cancelledAt: at } });
    const lapsed = await prisma.prisma.order.create({ data: { ...base, state: 'platform_cancelled', cancellationReason: 'partial_timeout', cancelledAt: at } });
    const refused = await prisma.prisma.order.create({ data: { ...base, state: 'merchant_rejected', cancellationReason: 'merchant_reject', cancelledAt: at } });
    try {
      const missed = await orders.merchantMissedOrders(ids.org, range);
      expect(new Set(missed.map((o) => o.id))).toEqual(new Set([timedOut.id, lapsed.id]));
      const all = await orders.merchantOrders(ids.org, range);
      expect(missed).toEqual(all.filter((o) => o.id === timedOut.id || o.id === lapsed.id));
    } finally {
      await prisma.prisma.order.deleteMany({ where: { id: { in: [timedOut.id, lapsed.id, refused.id] } } });
    }
  });
});
