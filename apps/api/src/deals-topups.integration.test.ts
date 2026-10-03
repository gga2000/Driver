import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from './shared/db/prisma.service.js';
import { UnitOfWork } from './shared/db/unit-of-work.js';
import { PrismaIdentityRepository } from './modules/identity/identity.repository.js';
import { PrismaPromotionsRepository } from './modules/promotions/index.js';
import { PrismaTopUpsRepository } from './modules/topups/index.js';

/**
 * Merchant deals at checkout and wallet top-ups on a real Postgres: the deal's spend counter is one
 * conditional UPDATE, so concurrent orders never spend past the budget cap; a top-up code confirms
 * once however many agents tap at the same time; a rolled-back order gives its reservation back.
 * Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('deals spend cap and top-up codes on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const uow = new UnitOfWork(prisma);
  const run = `dt${Date.now().toString(36)}`;
  const at = new Date('2026-10-04T12:00:00Z');
  let ownerId = '';
  let merchantOrgId = '';

  beforeAll(async () => {
    const identity = new PrismaIdentityRepository(prisma);
    ownerId = (await identity.createPersonWithIdentity({ locale: 'ar-IQ', sharedFamilyPhone: false, phoneE164: `+9647${Date.now() % 1e9}5`, phoneHash: `${run}-h1`, name: null, now: at })).id;
    merchantOrgId = (await prisma.prisma.org.create({ data: { type: 'restaurant', name: `مطعم ${run}`, cityId: 'aziziyah' } })).id;
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  async function newDeal(budgetCapIqd: number | null) {
    const repo = new PrismaPromotionsRepository(prisma);
    return repo.createDeal({
      cityId: 'aziziyah',
      merchantOrgId,
      ownerId,
      nameAr: 'خصم 20%',
      type: 'percent',
      value: 20,
      itemIds: [],
      schedule: { startsAt: at, endsAt: new Date(at.getTime() + 7 * 86_400_000), days: [] },
      minOrderIqd: 0,
      budgetCapIqd,
      spentIqd: 0,
      projection: { ordersPerWeek: 0, costPerOrderIqd: 0, weeklyCostIqd: 0, totalCostIqd: 0, basisOrders: 0 },
      proposalState: 'approved',
      active: true,
      approvedAt: at,
      createdAt: at,
    });
  }

  it('concurrent reservations never pass the budget cap', async () => {
    const repo = new PrismaPromotionsRepository(prisma);
    const deal = await newDeal(10_000);
    // Twelve orders at once, 3,000 each: exactly three fit under 10,000.
    const results = await Promise.all(Array.from({ length: 12 }, () => uow.run((tx) => repo.reserveSpend(deal.id, 3000, tx))));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect((await repo.deal(deal.id))?.spentIqd).toBe(9000);
    await uow.run((tx) => repo.releaseSpend(deal.id, 3000, tx));
    expect((await repo.deal(deal.id))?.spentIqd).toBe(6000);
    expect(await uow.run((tx) => repo.reserveSpend(deal.id, 4000, tx))).toBe(true);
    expect(await uow.run((tx) => repo.reserveSpend(deal.id, 1, tx))).toBe(false);
  });

  it('a reservation inside a failed order transaction is rolled back with it', async () => {
    const repo = new PrismaPromotionsRepository(prisma);
    const deal = await newDeal(null);
    await expect(
      uow.run(async (tx) => {
        expect(await repo.reserveSpend(deal.id, 2500, tx)).toBe(true);
        throw new Error('order insert failed');
      }),
    ).rejects.toThrow('order insert failed');
    expect((await repo.deal(deal.id))?.spentIqd).toBe(0);
  });

  it('top-up codes: round trip, newest-first lookups, single-use confirmation under concurrency', async () => {
    const repo = new PrismaTopUpsRepository(prisma);
    const code = String(Date.now() % 1_000_000).padStart(6, '0');
    const row = await repo.create({ customerId: ownerId, amountIqd: 25_000, code, expiresAt: new Date(at.getTime() + 86_400_000), createdAt: at });
    expect(await repo.get(row.id)).toMatchObject({ state: 'pending', amountIqd: 25_000, code, channel: null });
    expect((await repo.byCode(code))[0]?.id).toBe(row.id);
    expect((await repo.latestOf(ownerId))?.id).toBe(row.id);
    const confirms = await Promise.all(
      ['a', 'b', 'c'].map((who, i) =>
        uow.run((tx) => repo.confirm(row.id, { confirmedAt: at, confirmedById: `ops_${who}`, channel: 'ops_agent', reference: `T-${run}-${i}`, idempotencyKey: null }, tx)),
      ),
    );
    expect(confirms.filter(Boolean)).toHaveLength(1);
    expect(await repo.get(row.id)).toMatchObject({ state: 'confirmed', channel: 'ops_agent' });
    const other = await repo.create({ customerId: ownerId, amountIqd: 5000, code: `${code.slice(0, 5)}9`, expiresAt: at, createdAt: new Date(at.getTime() + 1000) });
    await repo.cancel(other.id);
    expect((await repo.get(other.id))?.state).toBe('cancelled');
    expect((await repo.ofCustomer(ownerId, at)).map((r) => r.id)).toEqual([other.id, row.id]);
  });
});
