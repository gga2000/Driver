import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { InMemoryOrdersRepository, PrismaOrdersRepository } from './orders.repository.js';

/**
 * «منين زبائنك» (maps program r6) on a real Postgres: the grouped JSON-path count the merchant's map
 * reads. Needs DATABASE_URL with the migrations deployed and the seed (city `aziziyah`); skipped
 * otherwise. The in-memory twin is held to the same answers in the merchant service tests.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('orders.deliveredByDropoffZone on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaOrdersRepository(prisma);
  const ids = { customer: '', org: '', otherOrg: '' };
  const IN = new Date('2026-09-20T10:00:00Z');
  const FROM = new Date('2026-09-01T00:00:00Z');
  const TO = new Date('2026-10-01T00:00:00Z');

  beforeAll(async () => {
    const db = prisma.prisma;
    ids.customer = (await db.person.create({ data: {} })).id;
    ids.org = (await db.org.create({ data: { type: 'restaurant', name: 'مطعم عدّاد المناطق', cityId: 'aziziyah' } })).id;
    ids.otherOrg = (await db.org.create({ data: { type: 'restaurant', name: 'مطعم ثاني', cityId: 'aziziyah' } })).id;
    const order = (merchantOrgId: string, zoneKey: string | null, placedAt: Date, delivered: boolean) =>
      db.order.create({
        data: {
          cityId: 'aziziyah',
          type: 'food',
          ordererId: ids.customer,
          merchantOrgId,
          placedAt,
          ...(delivered ? { state: 'delivered' as const, deliveredAt: placedAt } : {}),
          ...(zoneKey ? { dropoff: { zoneKey } } : {}),
        },
      });
    for (let i = 0; i < 3; i++) await order(ids.org, 'zakur', IN, true);
    await order(ids.org, 'hashimi', IN, true);
    await order(ids.org, null, IN, true);
    await order(ids.org, 'zakur', IN, false); // not delivered
    await order(ids.org, 'zakur', new Date('2026-08-20T10:00:00Z'), true); // before the window
    await order(ids.org, 'zakur', TO, true); // `to` is exclusive
    await order(ids.otherOrg, 'zakur', IN, true); // another store
  });

  afterAll(async () => {
    const db = prisma.prisma;
    await db.order.deleteMany({ where: { merchantOrgId: { in: [ids.org, ids.otherOrg] } } });
    await db.org.deleteMany({ where: { id: { in: [ids.org, ids.otherOrg] } } });
    await db.person.deleteMany({ where: { id: ids.customer } });
    await prisma.onModuleDestroy();
  });

  it('counts delivered orders per drop-off zone in [from, to), this store only, counts only', async () => {
    const rows = await repo.deliveredByDropoffZone(ids.org, FROM, TO);
    const sorted = [...rows].sort((a, b) => String(a.zoneKey).localeCompare(String(b.zoneKey)));
    expect(sorted).toEqual([
      { zoneKey: 'hashimi', orders: 1 },
      { zoneKey: null, orders: 1 },
      { zoneKey: 'zakur', orders: 3 },
    ]);
    expect(await new InMemoryOrdersRepository().deliveredByDropoffZone(ids.org, FROM, TO)).toEqual([]);
  });
});
