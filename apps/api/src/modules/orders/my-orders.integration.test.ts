import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { InMemoryOrdersRepository, PrismaOrdersRepository } from './orders.repository.js';

/**
 * «طلباتي» on a real Postgres (SCALE-02): forPerson takes the orders a person placed plus the ones they
 * ride or eat on, newest first, from two index-backed halves instead of a scan of every order. Needs
 * DATABASE_URL with the migrations deployed and the seed (city `aziziyah`); skipped otherwise.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('orders.forPerson on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaOrdersRepository(prisma);
  const ids = { me: '', friend: '', stranger: '', org: '' };
  const order: Record<string, string> = {};
  const at = (h: number) => new Date(Date.UTC(2026, 8, 20, h));

  beforeAll(async () => {
    const db = prisma.prisma;
    ids.me = (await db.person.create({ data: {} })).id;
    ids.friend = (await db.person.create({ data: {} })).id;
    ids.stranger = (await db.person.create({ data: {} })).id;
    ids.org = (await db.org.create({ data: { type: 'restaurant', name: 'مطعم طلباتي', cityId: 'aziziyah' } })).id;
    const place = async (key: string, ordererId: string, placedAt: Date, guests: string[] = []) => {
      const o = await db.order.create({ data: { cityId: 'aziziyah', type: 'food', ordererId, merchantOrgId: ids.org, placedAt } });
      for (const personId of guests) await db.participant.create({ data: { orderId: o.id, role: 'diner', personId } });
      order[key] = o.id;
    };
    await place('mineOld', ids.me, at(8));
    await place('friendTreat', ids.friend, at(9), [ids.me]); // I eat on my friend's order
    await place('mineNew', ids.me, at(11), [ids.me, ids.friend]); // placed by me and I'm also a diner: once
    await place('tieA', ids.me, at(10));
    await place('tieB', ids.friend, at(10), [ids.me]);
    await place('notMine', ids.friend, at(12), [ids.stranger]);
  });

  afterAll(async () => {
    const db = prisma.prisma;
    await db.participant.deleteMany({ where: { orderId: { in: Object.values(order) } } });
    await db.order.deleteMany({ where: { merchantOrgId: ids.org } });
    await db.org.deleteMany({ where: { id: ids.org } });
    await db.person.deleteMany({ where: { id: { in: [ids.me, ids.friend, ids.stranger] } } });
    await prisma.onModuleDestroy();
  });

  it('returns placed and joined orders once each, newest first, ties by id', async () => {
    const got = (await repo.forPerson(ids.me)).map((o) => o.id);
    const ties = [order['tieA']!, order['tieB']!].sort().reverse();
    expect(got).toEqual([order['mineNew'], ...ties, order['friendTreat'], order['mineOld']]);
  });

  it('is empty for a person with no orders, and the in-memory twin agrees on that', async () => {
    const nobody = (await prisma.prisma.person.create({ data: {} })).id;
    try {
      expect(await repo.forPerson(nobody)).toEqual([]);
      expect(await new InMemoryOrdersRepository().forPerson(nobody)).toEqual([]);
    } finally {
      await prisma.prisma.person.delete({ where: { id: nobody } });
    }
  });

  it('can answer both halves from indexes (no scan of every order)', async () => {
    const plan = await prisma.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      return tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>`
        EXPLAIN SELECT "id" FROM "public"."orders" WHERE "orderer_id" = ${ids.me}
        UNION
        SELECT "order_id" FROM "public"."participants" WHERE "person_id" = ${ids.me}`;
    });
    const text = plan.map((r) => r['QUERY PLAN']).join('\n');
    expect(text).toContain('participants_person_id_idx');
    expect(text).toMatch(/Index (Only )?Scan using orders_orderer_id_\w+ on orders/); // either orderer-led index will do
    expect(text).not.toMatch(/Seq Scan/);
  });
});
