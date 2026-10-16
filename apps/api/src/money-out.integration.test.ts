import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';
import { MoneyOutService } from './modules/control-room/index.js';
import { AuditLogService } from './modules/controls/index.js';
import { IdentityService } from './modules/identity/index.js';
import { AdjustmentService, LedgerService, MerchantCashService } from './modules/ledger/index.js';
import { RefundApprovalsService } from './modules/orders/index.js';
import { OrgsService } from './modules/orgs/index.js';
import { SupportService } from './modules/support/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import { PrismaService } from './shared/db/prisma.service.js';
import { UnitOfWork } from './shared/db/unit-of-work.js';

/**
 * The daily solo cap on ledger corrections (Ali, 2026-10-12: 50,000 a Baghdad day without a second
 * OK) on a real Postgres, across two "API instances": two money-out services with their own in-process
 * locks, so only the advisory transaction lock keeps one finance person's corrections one at a time.
 * Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('ledger corrections: the daily solo cap on Postgres (needs DATABASE_URL)', () => {
  const clock = new FakeClock('2026-10-06T12:00:00Z');
  const run = Date.now().toString(36);
  const phone = (n: number) => `0773${String((Date.now() + n) % 10_000_000).padStart(7, '0')}`;
  let app: INestApplication;
  let db: PrismaService['prisma'];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
    db = app.get(PrismaService).prisma;
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it('two 20,000 corrections at once on two instances, after a solo 20,000: one posts alone, one waits', async () => {
    const identity = app.get(IdentityService);
    const fin = await identity.ensurePersonByPhone(phone(1), 'system:test', 'money_out_it');
    await db.role.create({ data: { personId: fin, kind: 'finance' } });
    const actor = { personId: fin, sessionId: `s_${run}` };
    const ticket = await app.get(SupportService).open(actor, { cityId: 'aziziyah', kind: 'question', channel: 'phone', subject: 'تصحيحات اليوم' });
    const toAccount = `merchant_cash:m_cap_${run}`;
    const input = { cityId: 'aziziyah', fromAccount: 'platform', toAccount, amountIqd: 20_000, reason: 'payout typed short by mistake', incidentId: ticket.id };

    const podA = app.get(MoneyOutService);
    // A second instance: same database, its own in-process lock.
    const podB = new MoneyOutService(
      app.get(MerchantCashService),
      app.get(AdjustmentService),
      app.get(RefundApprovalsService),
      app.get(SupportService),
      identity,
      app.get(OrgsService),
      app.get(AuditLogService),
      app.get(UnitOfWork),
    );
    expect(await podA.adjust(actor, input)).toMatchObject({ status: 'posted' });
    const both = await Promise.all([podA.adjust(actor, input), podB.adjust(actor, input)]);
    expect(both.map((r) => r.status).sort()).toEqual(['pending_second_approval', 'posted']);
    expect(both.find((r) => r.status !== 'posted')?.queuedBecause).toBe('daily_cap');
    expect((await app.get(LedgerService).balance(toAccount)).amount).toBe(40_000);
    expect(await db.consoleAuditLog.count({ where: { actorId: fin, action: 'finance.adjustment_posted' } })).toBe(2);
  }, 60_000);
});
