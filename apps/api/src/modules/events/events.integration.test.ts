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

  function instance(opts: { leaseMs?: number } = {}) {
    const registry = new SubscriberRegistry();
    const publisher = new OutboxPublisher(repo, registry, uow, clock, null, opts);
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
    await prisma.prisma.outbox.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'pending', publishedAt: null, nextAttemptAt: clock.now() } });
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

  it('the claim commits before delivery: subscribers run with no lock on the outbox rows', async () => {
    const a = instance();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const running = new Promise<void>((r) => (entered = r));
    const id = `${tag}_slow`;
    a.registry.subscribe('it:slow', '*', async (e) => {
      if (e.aggregateId !== id) return;
      entered();
      await gate; // a slow subscriber (an SMS, a push)
    });
    // Sync mode: the emit drains after its commit, so it settles only once the subscriber is done.
    const drain = a.events.emit(undefined, { type: 'order.placed', actorId: 'system:test', occurredAt: clock.now() }, { name: 'order', id });
    await running;
    // Another connection may lock the row at once: the drain holds no lock while delivering.
    const row = await prisma.prisma.outbox.findFirstOrThrow({ where: { aggregateId: id } });
    const locked = await prisma.prisma.$transaction((tx) => tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "public"."outbox" WHERE "id" = ${row.id} FOR UPDATE NOWAIT`);
    expect(locked).toHaveLength(1);
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(clock.now().getTime()); // leased: other drains skip it
    release();
    await drain;
    expect((await prisma.prisma.outbox.findFirstOrThrow({ where: { aggregateId: id } })).status).toBe('published');
  });

  it('a row two drains hold (the first one\'s lease ran out) still runs each handler once', async () => {
    const a = instance({ leaseMs: 60_000 });
    const b = instance({ leaseMs: 60_000 });
    const id = `${tag}_twice`;
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    const slow = async (e: { aggregateId: string }) => {
      if (e.aggregateId !== id) return;
      runs += 1;
      entered();
      await gate;
    };
    a.registry.subscribe('it:twice', '*', slow);
    b.registry.subscribe('it:twice', '*', slow);
    // `a` (sync mode) starts delivering the row after the emit's commit and stops in the subscriber.
    const first = a.events.emit(undefined, { type: 'order.placed', actorId: 'system:test', occurredAt: clock.now() }, { name: 'order', id });
    await inside;
    // a's lease runs out while it is still delivering: b reclaims the row and starts on it too.
    clock.advance(60_001);
    const second = b.publisher.drainOnce();
    await new Promise((r) => setTimeout(r, 300)); // b is now waiting for a's delivery
    release();
    await Promise.all([first, second]);
    expect(runs).toBe(1);
    expect((await prisma.prisma.outbox.findFirstOrThrow({ where: { aggregateId: id } })).status).toBe('published');
  });

  it('narrows an aggregate by occurred_at and type on its index; orderIds reads only resolved order rows', async () => {
    const a = instance();
    const agg = { name: 'org', id: `${tag}_org` };
    const base = clock.now().getTime();
    const at = (min: number) => new Date(base + min * 60_000);
    await a.events.emit(undefined, { type: 'item.sold_out', actorId: 'system:test', occurredAt: at(1) }, agg);
    await a.events.emit(undefined, { type: 'item.restocked', actorId: 'system:test', occurredAt: at(61) }, agg);
    await a.events.emit(undefined, { type: 'item.price_changed', actorId: 'system:test', occurredAt: at(62) }, agg);
    expect((await a.events.forAggregate(agg.name, agg.id)).map((e) => e.type)).toEqual(['item.sold_out', 'item.restocked', 'item.price_changed']);
    expect((await a.events.forAggregate(agg.name, agg.id, { from: at(0), to: at(60) })).map((e) => e.type)).toEqual(['item.sold_out']);
    expect((await a.events.forAggregate(agg.name, agg.id, { from: at(1), to: at(62), types: ['item.sold_out', 'item.restocked'] })).map((e) => e.type)).toEqual(['item.sold_out', 'item.restocked']);
    // An order id that is not an orders row is stored with a NULL order_id: the indexed read does not see it.
    await a.events.emit(undefined, { type: 'order.ready', actorId: 'system:test', occurredAt: at(2), orderId: `${tag}_ghost` }, { name: 'order', id: `${tag}_ghost` });
    expect(await a.events.forOrders([`${tag}_ghost`], { types: ['order.ready'] })).toEqual([]);
    expect(await a.events.forOrders([])).toEqual([]);
    await expect(repo.find({ types: ['order.ready'] })).rejects.toThrow(/need/);
  });
});
