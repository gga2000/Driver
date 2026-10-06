import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { CatalogService, PrismaCatalogRepository } from '../catalog/index.js';
import { ConfigService } from '../config/index.js';
import { OrgsService, PrismaOrgsRepository } from '../orgs/index.js';
import { PricingService } from '../pricing/index.js';
import { InMemoryTripsRepository, RecordingTripEvents, ScriptedOfferCheck, TripsService, type TripTimerJob } from '../trips/index.js';
import { RecordingOrderEvents } from './events.adapter.js';
import { orgsHouseholds } from './households.port.js';
import { InMemoryMerchantDirectory } from './merchants.port.js';
import { PrismaOrdersRepository } from './orders.repository.js';
import { OrdersService, type OrderTimerJob } from './orders.service.js';
import { fakePhoneHash } from './test-harness.js';

/**
 * Joy w4 on Postgres: two API instances (each with its own in-process lock and unit of work) place
 * orders for the same household member at the same moment. The member's advisory transaction lock
 * makes the second read the first, so together they can't slip under the monthly budget. Needs
 * DATABASE_URL with the migrations deployed and the seed (city `aziziyah`). Skipped otherwise.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('household budget at placement on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const clock = new FakeClock('2026-10-03T09:00:00Z');
  const catalog = new CatalogService(new PrismaCatalogRepository(prisma));
  const ids = { payer: '', member: '', household: '', org: '', item: '', orders: [] as string[] };

  /** One API instance: its own unit of work, locks, orgs and orders services over the shared database. */
  function instance() {
    const uow = new UnitOfWork(prisma);
    const tripEvents = new RecordingTripEvents();
    const trips = new TripsService(new InMemoryTripsRepository(), tripEvents, uow, clock, new InMemoryQueue<TripTimerJob>('trips.timers', () => clock.now()));
    trips.bindOfferCheck(new ScriptedOfferCheck());
    const merchants = new InMemoryMerchantDirectory();
    const orgs = new OrgsService(undefined, clock, new PrismaOrgsRepository(prisma), uow);
    const orders = new OrdersService(
      new PrismaOrdersRepository(prisma),
      new RecordingOrderEvents(),
      uow,
      clock,
      new InMemoryQueue<OrderTimerJob>('orders.timers', () => clock.now()),
      trips,
      new PricingService(new ConfigService()),
      merchants,
      { resolvePhone: async (phone) => ({ personId: null, phoneHash: fakePhoneHash(phone) }) },
      { newCustomerCash: async () => ({ allowed: true, requiresArrivingCall: false, priorCashOrders: 3 }) },
      catalog,
      undefined,
      undefined,
      undefined,
      undefined,
      orgsHouseholds(orgs),
    );
    return { orgs, orders, merchants };
  }
  const a = instance();
  const b = instance();

  beforeAll(async () => {
    const db = prisma.prisma;
    ids.payer = (await db.person.create({ data: {} })).id;
    ids.member = (await db.person.create({ data: {} })).id;
    ids.org = (await db.org.create({ data: { type: 'restaurant', name: 'مطعم اختبار', cityId: 'aziziyah' } })).id;
    for (const s of [a, b]) s.merchants.add(ids.org, { location: { zoneKey: 'centre' } });
    ids.item = (await catalog.addItem({ orgId: ids.org, nameAr: 'صينية', priceIqd: 10_000 })).id;
    ids.household = (await a.orgs.createHousehold({ name: 'بيت اختبار', cityId: 'aziziyah', payerId: ids.payer })).id;
    await a.orgs.addMember(ids.household, ids.member, { role: 'orderer' });
    // 11,500 an order (10,000 + delivery + service): one fits 20,000, two don't.
    await a.orgs.setMonthlyBudget(ids.household, ids.member, 20_000);
  });

  afterAll(async () => {
    const db = prisma.prisma;
    await db.payerApproval.deleteMany({ where: { orgId: ids.household } });
    await db.orderLine.deleteMany({ where: { orderId: { in: ids.orders } } });
    await db.participant.deleteMany({ where: { orderId: { in: ids.orders } } });
    await db.order.deleteMany({ where: { id: { in: ids.orders } } });
    await db.orgMember.deleteMany({ where: { orgId: ids.household } });
    await db.modifier.deleteMany({ where: { group: { item: { orgId: ids.org } } } });
    await db.modifierGroup.deleteMany({ where: { item: { orgId: ids.org } } });
    await db.catalogItem.deleteMany({ where: { orgId: ids.org } });
    await db.catalog.deleteMany({ where: { orgId: ids.org } });
    await db.org.deleteMany({ where: { id: { in: [ids.org, ids.household] } } });
    await db.person.deleteMany({ where: { id: { in: [ids.payer, ids.member] } } });
    await prisma.onModuleDestroy();
  });

  it('two instances placing for one member at once: exactly one order waits for the payer', async () => {
    const input = { cityId: 'aziziyah', type: 'food' as const, merchantOrgId: ids.org, householdOrgId: ids.household, paymentMethod: 'cash' as const, lines: [{ catalogItemId: ids.item, qty: 1 }], dropoff: { zoneKey: 'zakur' } };
    const placed = await Promise.all([a.orders.place(ids.member, input), b.orders.place(ids.member, input)]);
    ids.orders.push(...placed.map((o) => o.id));
    expect(placed.map((o) => o.heldForPayer === true).sort()).toEqual([false, true]);
    const held = placed.find((o) => o.heldForPayer)!;
    expect(await a.orgs.approvalForOrder(ids.household, held.id)).toMatchObject({ state: 'pending', reason: 'month_budget' });
  });
});
