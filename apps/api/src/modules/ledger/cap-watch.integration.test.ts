import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES as rules } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { PrismaEventsRepository } from '../events/events.repository.js';
import { EventsService } from '../events/events.service.js';
import { OutboxPublisher } from '../events/outbox.publisher.js';
import { SubscriberRegistry } from '../events/subscriber.registry.js';
import { CashCapWatch } from './cap-watch.js';
import { StaticCapProfiles } from './caps.js';
import { EventsServiceLedgerBus } from './events.adapter.js';
import { LedgerService } from './ledger.service.js';
import { postOrderClosed, postSettlement } from './postings.js';
import { PrismaLedgerRepository, type LedgerEventDelegate } from './prisma.repository.js';
import { workedExample } from './test-harness.js';

/**
 * Cash-cap crossings on a real Postgres: the driver's position is read inside the posting's
 * transaction (two collections in one transaction cross once), and the event commits or rolls back
 * with the posting. Ledger rows are append-only, so each run uses its own courier id. Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('cash-cap crossings on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const uow = new UnitOfWork(prisma);
  const clock = new FakeClock(new Date());
  const tag = `itcap_${Date.now().toString(36)}`;
  let events: EventsService;
  let ledger: LedgerService;
  beforeAll(() => {
    const repo = new PrismaEventsRepository(prisma);
    const registry = new SubscriberRegistry();
    events = new EventsService(repo, registry, new OutboxPublisher(repo, registry, uow, clock, null), clock, uow);
    events.useTripOrderLookup(null);
    ledger = new LedgerService(new PrismaLedgerRepository(prisma.prisma.ledgerEvent as unknown as LedgerEventDelegate), uow);
    ledger.watchCaps(new CashCapWatch(new StaticCapProfiles(), rules, new EventsServiceLedgerBus(events)));
  });

  // The lines of a real cash order, without the order/trip references (those are foreign keys to rows this test doesn't create).
  const collection = (courierId: string, id: string, items: number) => ({
    ...postOrderClosed(workedExample({ orderId: `${tag}_${id}`, courierId, merchantId: `${tag}_m`, customerId: `${tag}_c`, occurredAt: clock.now(), itemsSubtotalIqd: items, cashCollectedIqd: items + 1500 }), rules).money,
    refs: {},
  });
  const crossings = async (courierId: string) => (await events.forAggregate('driver', courierId)).filter((e) => e.type.startsWith('courier.cash_')).map((e) => e.type);

  afterAll(async () => {
    const db = prisma.prisma;
    const outbox = await db.outbox.findMany({ where: { aggregateId: { startsWith: tag } }, select: { id: true } });
    await db.subscriberDelivery.deleteMany({ where: { outboxId: { in: outbox.map((o) => o.id) } } });
    await db.outbox.deleteMany({ where: { id: { in: outbox.map((o) => o.id) } } });
    await db.event.deleteMany({ where: { aggregateId: { startsWith: tag } } });
    await prisma.onModuleDestroy();
  });

  it('two collections in one transaction cross once (the second reads the first); the hand-in crosses back', async () => {
    const k = `${tag}_k1`;
    await uow.run(async (tx) => {
      await ledger.recordAll(collection(k, 'o1', 40000), tx);
      await ledger.recordAll(collection(k, 'o2', 40000), tx);
    });
    expect(await crossings(k)).toEqual(['courier.cash_over_cap']);
    const [over] = (await events.forAggregate('driver', k)).filter((e) => e.type === 'courier.cash_over_cap');
    expect(over!.payload).toMatchObject({ courierId: k, capIqd: 75000, cityId: 'aziziyah' });
    expect(over!.payload['cashIqd'] as number).toBeGreaterThanOrEqual(75000);

    const owed = over!.payload['cashIqd'] as number;
    await ledger.recordAll(postSettlement({ kind: 'driver_settlement', driverId: k, amountIqd: owed - 70000, channel: 'agent', reference: `${tag}_AG1`, occurredAt: clock.now() }));
    expect(await crossings(k)).toEqual(['courier.cash_over_cap', 'courier.cash_under_cap']);
  });

  it('a rolled-back posting leaves no crossing event', async () => {
    const k = `${tag}_k2`;
    await expect(
      uow.run(async (tx) => {
        await ledger.recordAll(collection(k, 'o3', 80000), tx);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await crossings(k)).toEqual([]);
    expect((await ledger.balance(`cash:${k}`)).events).toBe(0);
  });
});
