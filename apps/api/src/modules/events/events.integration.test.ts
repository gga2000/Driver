import { afterAll, describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { PrismaEventsRepository } from './events.repository.js';
import { EventsService } from './events.service.js';
import { OutboxPublisher } from './outbox.publisher.js';
import { SubscriberRegistry } from './subscriber.registry.js';

/**
 * The outbox on a real Postgres (plan Step 3): transactional write + rollback, ON CONFLICT
 * idempotency, FK-safe system actors, and `FOR NO KEY UPDATE SKIP LOCKED` keeping concurrent
 * drains (two publishers = two API instances) from delivering a row twice. Needs DATABASE_URL with
 * the migrations deployed. Skipped otherwise.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('events outbox on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const uow = new UnitOfWork(prisma);
  const clock = new FakeClock(new Date());
  const repo = new PrismaEventsRepository(prisma);
  const tag = `it_${Date.now().toString(36)}`;

  function instance() {
    const registry = new SubscriberRegistry();
    const publisher = new OutboxPublisher(repo, registry, uow, clock, null);
    const events = new EventsService(repo, registry, publisher, clock, uow);
    events.useTripOrderLookup(null);
    return { registry, publisher, events };
  }

  afterAll(async () => {
    const db = prisma.prisma;
    const outbox = await db.outbox.findMany({ where: { aggregateId: { startsWith: tag } }, select: { id: true, eventId: true } });
    await db.subscriberDelivery.deleteMany({ where: { outboxId: { in: outbox.map((o) => o.id) } } });
    await db.outbox.deleteMany({ where: { id: { in: outbox.map((o) => o.id) } } });
    await db.event.deleteMany({ where: { aggregateId: { startsWith: tag } } });
    await prisma.onModuleDestroy();
  });

  it('commits event + outbox with the caller, rolls both back with it, and short-circuits a repeated key', async () => {
    const a = instance();
    const agg = { name: 'order', id: `${tag}_o1` };
    await expect(
      uow.run(async (tx) => {
        await a.events.emit(tx, { type: 'order.placed', actorId: 'system:test', occurredAt: clock.now(), orderId: agg.id }, agg);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await a.events.forOrder(agg.id)).toEqual([]);

    const key = `${tag}:k1`;
    const first = await uow.run((tx) => a.events.emit(tx, { type: 'order.placed', actorId: 'system:test', occurredAt: clock.now(), orderId: agg.id, idempotencyKey: key, location: { lat: 32.91, lng: 45.06 } }, agg));
    const again = await uow.run((tx) => a.events.emit(tx, { type: 'order.placed', actorId: 'system:test', occurredAt: clock.now(), orderId: agg.id, idempotencyKey: key }, agg));
    expect(again.id).toBe(first.id);
    const stored = await a.events.forOrder(agg.id);
    expect(stored.map((e) => e.id)).toEqual([first.id]);
    expect(stored[0]).toMatchObject({ actorId: 'system:test', orderId: agg.id, location: { lat: 32.91, lng: 45.06 } });
    const row = await prisma.prisma.event.findUnique({ where: { id: first.id } });
    expect(row).toMatchObject({ actorId: null, orderId: null, idempotencyKey: key }); // FKs only when they resolve
  });

  it('two publishers draining at once never deliver the same row twice', async () => {
    const a = instance();
    const b = instance();
    const delivered = new Map<string, number>();
    const count = async (e: { id: string; aggregateId: string }) => {
      if (!e.aggregateId.startsWith(tag)) return;
      delivered.set(e.id, (delivered.get(e.id) ?? 0) + 1);
    };
    a.registry.subscribe('it:count', '*', count);
    b.registry.subscribe('it:count', '*', count);
    for (let i = 0; i < 40; i++) await b.events.emit(undefined, { type: 'order.placed', actorId: 'system:test', occurredAt: clock.now() }, { name: 'order', id: `${tag}_c${i}` });
    // `b` drained after each commit (sync mode); reset the rows and race two drains over them.
    const rows = await prisma.prisma.outbox.findMany({ where: { aggregateId: { startsWith: `${tag}_c` } } });
    await prisma.prisma.subscriberDelivery.deleteMany({ where: { outboxId: { in: rows.map((r) => r.id) } } });
    await prisma.prisma.outbox.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'pending', publishedAt: null } });
    delivered.clear();
    let both = 0;
    for (;;) {
      const [ra, rb] = await Promise.all([a.publisher.drainOnce(15), b.publisher.drainOnce(15)]);
      if (ra.claimed > 0 && rb.claimed > 0) both += 1;
      if (ra.claimed + rb.claimed === 0) break;
    }
    expect(both).toBeGreaterThan(0); // the two drains really overlapped
    expect(delivered.size).toBe(40);
    expect([...delivered.values()].every((n) => n === 1)).toBe(true);
  });
});
