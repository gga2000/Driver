import { afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { PrismaEventsRepository } from '../events/events.repository.js';
import { PrismaNotifyRepository } from '../notify/notify.repository.js';

/**
 * The delivery purges on a real Postgres (speed audit z1). Rows are dated 2001 and the cut-offs
 * fall in 2001, so a run never touches anything another test (or a dev database) wrote.
 * Needs DATABASE_URL with the migrations deployed.
 */
const url = process.env['DATABASE_URL'];
const at = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe.skipIf(!url)('delivery retention on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const db = prisma.prisma;
  const tag = `it_${Date.now().toString(36)}`;

  afterAll(async () => {
    const rows = await db.outbox.findMany({ where: { aggregateId: { startsWith: tag } }, select: { id: true } });
    await db.subscriberDelivery.deleteMany({ where: { outboxId: { in: rows.map((r) => r.id) } } });
    await db.outbox.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    await db.notifyDelivery.deleteMany({ where: { dedupeKey: { startsWith: tag } } });
    await prisma.onModuleDestroy();
  });

  it("deletes subscriber records of rows published before the cut-off, in batches, and keeps the outbox rows", async () => {
    const repo = new PrismaEventsRepository(prisma);
    const row = (id: string, status: 'published' | 'pending' | 'failed', publishedAt: Date | null) =>
      db.outbox.create({ data: { id: `${tag}_${id}`, aggregate: 'order', aggregateId: `${tag}_${id}`, type: 'order.placed', payload: {}, status, publishedAt, createdAt: at('2001-01-01') } });
    await row('old', 'published', at('2001-02-01'));
    await row('fresh', 'published', at('2001-03-15'));
    await row('pending', 'pending', null);
    await row('failed', 'failed', null);
    for (const id of ['old', 'fresh', 'pending', 'failed'])
      for (const subscriber of ['a', 'b', 'c']) await db.subscriberDelivery.create({ data: { outboxId: `${tag}_${id}`, subscriber, deliveredAt: at('2001-02-01') } });

    expect(await repo.purgeDeliveries(at('2001-03-01'), 2)).toBe(2);
    expect(await repo.purgeDeliveries(at('2001-03-01'), 2)).toBe(1);
    expect(await repo.purgeDeliveries(at('2001-03-01'), 2)).toBe(0);
    const left = await db.subscriberDelivery.groupBy({ by: ['outboxId'], where: { outboxId: { startsWith: tag } }, _count: true });
    expect(Object.fromEntries(left.map((r) => [r.outboxId.slice(tag.length + 1), r._count]))).toEqual({ fresh: 3, pending: 3, failed: 3 });
    expect(await db.outbox.count({ where: { aggregateId: { startsWith: tag } } })).toBe(4);
  });

  it('deletes settled message records created before the cut-off; queued and deferred stay', async () => {
    const repo = new PrismaNotifyRepository(prisma);
    const msg = (key: string, status: string, createdAt: Date) =>
      db.notifyDelivery.create({ data: { dedupeKey: `${tag}_${key}`, eventId: 'ev', template: 'order_accepted', personId: 'p', channel: 'push', status, payload: {}, createdAt } });
    for (const status of ['sent', 'delivered', 'read', 'failed', 'suppressed', 'skipped', 'queued', 'deferred']) await msg(status, status, at('2001-02-01'));
    await msg('fresh', 'sent', at('2001-03-15'));

    expect(await repo.purgeDeliveries(at('2001-03-01'), 4)).toBe(4);
    expect(await repo.purgeDeliveries(at('2001-03-01'), 4)).toBe(2);
    expect(await repo.purgeDeliveries(at('2001-03-01'), 4)).toBe(0);
    const left = await db.notifyDelivery.findMany({ where: { dedupeKey: { startsWith: tag } }, select: { dedupeKey: true } });
    expect(left.map((r) => r.dedupeKey.slice(tag.length + 1)).sort()).toEqual(['deferred', 'fresh', 'queued']);
  });
});
