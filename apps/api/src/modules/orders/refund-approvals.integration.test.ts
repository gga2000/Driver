import { afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { PrismaRefundApprovalsRepository } from './refund-approvals.js';

const url = process.env['DATABASE_URL'];
const CITY = `ra_it_${Date.now()}`;

describe.skipIf(!url)('refunds waiting for a second OK on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaRefundApprovalsRepository(prisma);

  afterAll(async () => {
    await prisma.prisma.$executeRaw`DELETE FROM "public"."refund_approvals" WHERE "city_id" = ${CITY}`;
    await prisma.onModuleDestroy();
  });

  const at = (m: number) => new Date(Date.UTC(2026, 9, 9, 10, m));
  const ask = (key: string, m: number) =>
    repo.create({
      kind: 'ticket',
      cityId: CITY,
      ticketId: `tk_${CITY}`,
      orderId: null,
      amountIqd: 30_000,
      limitKind: 'per_refund',
      payload: { method: 'wallet', faultParty: 'platform', note: null, idempotencyKey: key },
      requestedBy: 'agent_1',
      requestedAt: at(m),
      state: 'pending',
      decidedBy: null,
      decidedAt: null,
      declineNote: null,
      idempotencyKey: `${CITY}:${key}`,
    });

  it('one row per request key; only a pending row moves, once; pending oldest first', async () => {
    const [a, b] = await Promise.all([ask('a', 1), ask('a', 1)]);
    expect(a.id).toBe(b.id);
    expect(a.payload).toMatchObject({ method: 'wallet', idempotencyKey: 'a' });
    const c = await ask('c', 2);
    expect((await repo.list({ pending: true, cityId: CITY, limit: 10 })).map((r) => r.id)).toEqual([a.id, c.id]);
    expect((await repo.pendingFor({ ticketId: `tk_${CITY}` })).map((r) => r.id)).toEqual([a.id, c.id]);

    const decide = () => repo.decide(a.id, { state: 'approved', decidedBy: 'fin_1', decidedAt: at(5), declineNote: null });
    const [first, second] = await Promise.all([decide(), decide()]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(await repo.get(a.id)).toMatchObject({ state: 'approved', decidedBy: 'fin_1' });
    expect(await repo.decide(a.id, { state: 'declined', decidedBy: 'fin_2', decidedAt: at(6), declineNote: 'لا' })).toBeNull();
    expect((await repo.list({ pending: false, cityId: CITY, limit: 10 })).map((r) => r.id)).toEqual([a.id]);
    expect(await repo.byKey(`${CITY}:c`)).toMatchObject({ id: c.id, state: 'pending' });
  });
});
