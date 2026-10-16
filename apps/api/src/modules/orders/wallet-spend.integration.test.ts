import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { CatalogService, PrismaCatalogRepository } from '../catalog/index.js';
import { ConfigService } from '../config/index.js';
import { lockWallets } from '../ledger/index.js';
import { PricingService } from '../pricing/index.js';
import { InMemoryTripsRepository, RecordingTripEvents, ScriptedOfferCheck, TripsService, type TripTimerJob } from '../trips/index.js';
import { RecordingOrderEvents } from './events.adapter.js';
import { InMemoryMerchantDirectory } from './merchants.port.js';
import { PrismaOrdersRepository } from './orders.repository.js';
import { OrdersService, type OrderTimerJob, type OrdersWalletPort } from './orders.service.js';
import { fakePhoneHash } from './test-harness.js';

/**
 * SEC-07 on Postgres: one wallet, two API instances, spends at the same moment. Each spend takes the
 * customer's wallet lock first in its transaction and re-checks what is left, so a balance that covers
 * one order (11,500) never pays for two — whether the other spend is a second order or another
 * module's hold (a prepaid seat, here a stand-in that takes the same lock). Needs DATABASE_URL with the
 * migrations deployed and the seed (city `aziziyah`). Skipped otherwise.
 */
const url = process.env['DATABASE_URL'];
const BALANCE = 15_000;
const ORDER = 11_500;

describe.skipIf(!url)('one wallet, spends racing on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const clock = new FakeClock('2001-10-03T09:00:00Z');
  const catalog = new CatalogService(new PrismaCatalogRepository(prisma));
  const ids = { customer: '', org: '', item: '', orders: [] as string[] };
  /** The other module's hold on the same wallet (what a prepaid seat would register). */
  let seatHeld = 0;

  function instance() {
    const uow = new UnitOfWork(prisma);
    const trips = new TripsService(new InMemoryTripsRepository(), new RecordingTripEvents(), uow, clock, new InMemoryQueue<TripTimerJob>('trips.timers', () => clock.now()));
    trips.bindOfferCheck(new ScriptedOfferCheck());
    const merchants = new InMemoryMerchantDirectory();
    const wallet: OrdersWalletPort = { balanceIqd: async () => BALANCE, heldElsewhere: async () => seatHeld };
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
      wallet,
    );
    /** A seat booked on the wallet the way routes does it: wallet lock first, re-check, hold. */
    const bookSeat = (amount: number) =>
      uow.run(async (tx) => {
        await lockWallets(tx, [ids.customer]);
        const left = BALANCE - (await orders.openWalletHoldIqd(ids.customer)) - seatHeld;
        if (left < amount) throw new DriverError('wallet_insufficient');
        seatHeld += amount;
      });
    return { orders, merchants, bookSeat };
  }
  const a = instance();
  const b = instance();
  const input = () => ({ cityId: 'aziziyah', type: 'food' as const, merchantOrgId: ids.org, paymentMethod: 'wallet' as const, lines: [{ catalogItemId: ids.item, qty: 1 }], dropoff: { zoneKey: 'zakur' } });

  beforeAll(async () => {
    const db = prisma.prisma;
    ids.customer = (await db.person.create({ data: {} })).id;
    ids.org = (await db.org.create({ data: { type: 'restaurant', name: 'مطعم محفظة', cityId: 'aziziyah' } })).id;
    for (const s of [a, b]) s.merchants.add(ids.org, { location: { zoneKey: 'centre' } });
    ids.item = (await catalog.addItem({ orgId: ids.org, nameAr: 'صينية', priceIqd: 10_000 })).id;
  });

  afterAll(async () => {
    const db = prisma.prisma;
    await db.orderLine.deleteMany({ where: { orderId: { in: ids.orders } } });
    await db.participant.deleteMany({ where: { orderId: { in: ids.orders } } });
    await db.order.deleteMany({ where: { id: { in: ids.orders } } });
    await db.modifier.deleteMany({ where: { group: { item: { orgId: ids.org } } } });
    await db.modifierGroup.deleteMany({ where: { item: { orgId: ids.org } } });
    await db.catalogItem.deleteMany({ where: { orgId: ids.org } });
    await db.catalog.deleteMany({ where: { orgId: ids.org } });
    await db.org.deleteMany({ where: { id: ids.org } });
    await db.person.deleteMany({ where: { id: ids.customer } });
    await prisma.onModuleDestroy();
  });

  async function cancelAll(): Promise<void> {
    await prisma.prisma.order.updateMany({ where: { id: { in: ids.orders } }, data: { state: 'customer_cancelled' } });
    seatHeld = 0;
  }

  it('two orders on one wallet from two instances at once: exactly one is placed', async () => {
    for (let i = 0; i < 5; i += 1) {
      const settled = await Promise.allSettled([a.orders.place(ids.customer, input()), b.orders.place(ids.customer, input())]);
      const placed = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
      ids.orders.push(...placed.map((o) => o.id));
      expect(placed.map((o) => o.totalIqd)).toEqual([ORDER]);
      const refused = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult;
      expect((refused.reason as DriverError).code).toBe('wallet_insufficient');
      await cancelAll();
    }
  });

  it('an order and a seat on one wallet at once: exactly one gets the money', async () => {
    for (let i = 0; i < 5; i += 1) {
      const settled = await Promise.allSettled([a.orders.place(ids.customer, input()), b.bookSeat(ORDER)]);
      const placed = settled[0].status === 'fulfilled' ? [settled[0].value] : [];
      ids.orders.push(...placed.map((o) => o.id));
      expect(settled.filter((s) => s.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((s) => s.status === 'rejected').map((s) => ((s as PromiseRejectedResult).reason as DriverError).code)).toEqual(['wallet_insufficient']);
      await cancelAll();
    }
  });
});
