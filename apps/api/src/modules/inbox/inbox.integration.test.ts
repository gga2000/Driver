import { afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { PrismaInboxRepository } from './inbox.repository.js';

const url = process.env['DATABASE_URL'];
const CITY = `inbox_it_${Date.now()}`;

describe.skipIf(!url)('the Today list on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaInboxRepository(prisma);

  afterAll(async () => {
    await prisma.prisma.$executeRaw`DELETE FROM "public"."inbox_items" WHERE "city_id" = ${CITY}`;
    await prisma.onModuleDestroy();
  });

  it('one row per kind and subject, even when two machines see it at once; closes and comes back', async () => {
    const t = new Date('2026-10-09T18:00:00Z');
    const later = (s: number) => new Date(t.getTime() + s * 1000);
    const trip = `trp_${CITY}`;
    const sight = (at: Date, reason: string) =>
      repo.sight({
        cityId: CITY,
        kind: 'no_driver',
        subjectKind: 'trip',
        subjectId: trip,
        orderId: null,
        tripId: trip,
        facts: { reason },
        at,
      });
    const [a, b] = await Promise.all([sight(t, 'no_acceptance'), sight(t, 'no_acceptance')]);
    expect([a.created, b.created].filter(Boolean)).toHaveLength(1);
    expect(a.item.id).toBe(b.item.id);

    const order = `ord_${CITY}`;
    await repo.sight({
      cityId: CITY,
      kind: 'late',
      subjectKind: 'order',
      subjectId: order,
      orderId: order,
      tripId: null,
      facts: {},
      at: t,
    });
    expect(
      (await repo.openFor({ orderId: order, kinds: ['late'] })).map((r) => r.subjectId),
    ).toEqual([order]);
    expect(await repo.openFor({ orderId: order, kinds: ['store_silent'] })).toEqual([]);

    const taken = await repo.updateOpen(a.item.id, { assigneeId: 'p_sara', assignedAt: later(5) });
    expect(taken).toMatchObject({ assigneeId: 'p_sara' });
    const closed = await repo.updateOpen(a.item.id, { doneAt: later(10), outcome: 'auto' });
    expect(closed?.doneAt).toEqual(later(10));
    expect(await repo.updateOpen(a.item.id, { note: 'x' })).toBeNull();

    // A replay from before the close changes nothing; a new sighting after it brings the row back.
    expect((await sight(later(1), 'no_acceptance')).reopened).toBe(false);
    const back = await sight(later(60), 'override_declined');
    expect(back).toMatchObject({
      reopened: true,
      item: {
        id: a.item.id,
        times: 2,
        doneAt: null,
        assigneeId: null,
        facts: { reason: 'override_declined' },
      },
    });

    const rows = await repo.forCity(CITY, later(0), 50);
    expect(rows.map((r) => r.kind).sort()).toEqual(['late', 'no_driver']);
    expect(await repo.bySubject('late', order)).toMatchObject({ kind: 'late', orderId: order });
  });
});
