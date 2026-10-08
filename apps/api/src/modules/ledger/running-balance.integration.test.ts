import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { LedgerService } from './ledger.service.js';
import { postSettlement } from './postings.js';
import { PrismaLedgerBalanceStore, PrismaLedgerRepository, type LedgerEventDelegate, type RawSqlRunner } from './prisma.repository.js';

/**
 * Perf item 13 on a real Postgres (migrations deployed): the `ledger_balances` trigger keeps each
 * driver account's running balance equal to the full ledger sum — through posting groups, replays,
 * rollbacks and concurrent postings — the migration's backfill query computes the same numbers, and
 * the nightly check repairs a line written past the trigger. Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];
const migration = fileURLToPath(new URL('../../../../../packages/db/prisma/migrations/20261011100000_driver_running_balance/migration.sql', import.meta.url));

describe.skipIf(!url)('running driver balance on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const uow = new UnitOfWork(prisma);
  const run = `rb${Date.now().toString(36)}`;
  const at = new Date('2026-10-10T09:00:00Z');
  let ledger: LedgerService;
  let plain: LedgerService;
  const drivers = [0, 1, 2].map((i) => `${run}d${i}`);
  const accounts = drivers.flatMap((d) => [`driver:${d}`, `cash:${d}`]);

  beforeAll(async () => {
    const repo = new PrismaLedgerRepository(prisma.prisma.ledgerEvent as unknown as LedgerEventDelegate, new PrismaLedgerBalanceStore(prisma.prisma as unknown as RawSqlRunner));
    ledger = new LedgerService(repo, uow);
    // Same rows, no running balance: every read sums the full history.
    plain = new LedgerService(new PrismaLedgerRepository(prisma.prisma.ledgerEvent as unknown as LedgerEventDelegate), uow);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  async function expectAllEqual(): Promise<void> {
    for (const account of accounts) {
      const full = await plain.balance(account);
      expect(await ledger.balance(account), account).toEqual(full);
      expect(await ledger.fullBalance(account), account).toEqual(full);
    }
  }

  it('random postings, a replayed group and a rolled-back group: running = full sum on every driver account', async () => {
    let seed = 13;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const pool = [...accounts, 'platform', 'bank', `customer:${run}c`, `merchant_cash:${run}m`];
    for (let i = 0; i < 60; i++) {
      const from = pool[Math.floor(rand() * pool.length)]!;
      let to = pool[Math.floor(rand() * pool.length)]!;
      if (to === from) to = pool[(pool.indexOf(from) + 1) % pool.length]!;
      await ledger.record({ type: 'adjustment', amount: 250 * (1 + Math.floor(rand() * 40)), fromAccount: from, toAccount: to, occurredAt: new Date(at.getTime() + i * 1000), idempotencyKey: `${run}:r${i}` });
    }
    const payout = postSettlement({ kind: 'driver_payout', driverId: drivers[0]!, amountIqd: 1500, channel: 'zaincash', reference: `${run}-P1`, occurredAt: at });
    await ledger.recordAll(payout);
    expect((await ledger.recordAll(payout)).skipped).toEqual([payout.id]);

    const before = await ledger.balance(`driver:${drivers[1]}`);
    const doomed = postSettlement({ kind: 'driver_payout', driverId: drivers[1]!, amountIqd: 2000, channel: 'zaincash', reference: `${run}-P2`, occurredAt: at });
    await expect(
      uow.run(async (tx) => {
        await ledger.recordAll(doomed, tx);
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect(await ledger.balance(`driver:${drivers[1]}`)).toEqual(before);
    await expectAllEqual();
  });

  it('concurrent postings on one driver: nothing lost, nothing counted twice', async () => {
    const d = drivers[2]!;
    await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        uow.run((tx) =>
          ledger.recordAll(
            {
              id: `${run}:c${i}`,
              kind: 'money',
              occurredAt: at,
              refs: {},
              lines: [
                { type: 'adjustment', amount: 1000, fromAccount: 'platform', toAccount: `driver:${d}` },
                { type: 'adjustment', amount: 250, fromAccount: `cash:${d}`, toAccount: 'platform' },
              ],
              controls: [],
            },
            tx,
          ),
        ),
      ),
    );
    const full = await plain.balance(`driver:${d}`);
    expect(full.events).toBeGreaterThanOrEqual(16);
    await expectAllEqual();
  });

  it("the migration's backfill query gives the same numbers as the trigger", async () => {
    const sql = readFileSync(migration, 'utf8');
    const select = /SELECT gen_random_uuid\(\)::TEXT, account[\s\S]*?GROUP BY account/.exec(sql)?.[0];
    expect(select).toBeTruthy();
    const rows = await prisma.prisma.$queryRawUnsafe<Array<{ account: string; amount: bigint; events: bigint }>>(
      `SELECT account, amount, events FROM (${select}) b(id, account, amount, events, updated_at) WHERE account = ANY($1::text[]) ORDER BY account`,
      accounts,
    );
    for (const r of rows) {
      const running = await ledger.balance(r.account);
      expect({ amount: Number(r.amount), events: Number(r.events) }, r.account).toEqual({ amount: running.amount, events: running.events });
    }
    expect(rows.length).toBeGreaterThan(0);
  });

  it('a line written past the trigger is caught by the nightly check and repaired from the full sum', async () => {
    const d = drivers[0]!;
    const before = await ledger.balance(`cash:${d}`);
    // The deploy window: a posting that lands without the trigger (DDL is transactional, so no other session sees it off).
    await prisma.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('ALTER TABLE "public"."ledger_events" DISABLE TRIGGER "ledger_balances_apply"');
      await tx.ledgerEvent.create({ data: { type: 'adjustment', amountIqd: 3000, fromAccount: `cash:${d}`, toAccount: 'platform', occurredAt: at, idempotencyKey: `${run}:bypass` } });
      await tx.$executeRawUnsafe('ALTER TABLE "public"."ledger_events" ENABLE TRIGGER "ledger_balances_apply"');
    });
    expect(await ledger.balance(`cash:${d}`)).toEqual(before); // the projection missed it
    const drift = (await ledger.reconcileRunningBalances()).filter((x) => x.accountId.includes(run));
    expect(drift).toEqual([{ accountId: `cash:${d}`, runningIqd: before.amount, fullIqd: before.amount - 3000, runningEvents: before.events, fullEvents: before.events + 1 }]);
    await expectAllEqual();
    expect((await ledger.balance(`cash:${d}`)).amount).toBe(before.amount - 3000);
  });
});
