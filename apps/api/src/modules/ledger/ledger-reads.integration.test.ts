import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { LedgerService } from './ledger.service.js';
import { PrismaLedgerBalanceStore, PrismaLedgerRepository, type LedgerEventDelegate, type RawSqlRunner } from './prisma.repository.js';
import { InMemoryLedgerRepository, type NewLedgerEvent } from './repository.js';

/**
 * SCALE-16 on a real Postgres: the database sum, the filtered read and the paged read give exactly
 * what the in-memory store gives for the same lines (which loads the history), including pages whose
 * limit falls inside a run of lines that share a timestamp. Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('ledger reads without the whole history, on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const uow = new UnitOfWork(prisma);
  const run = `lr${Date.now().toString(36)}`;
  const account = `customer:${run}c`;
  const other = `merchant_cash:${run}m`;
  const t0 = Date.parse('2026-03-01T08:00:00Z');
  let repo: PrismaLedgerRepository;
  const mem = new InMemoryLedgerRepository();

  beforeAll(async () => {
    repo = new PrismaLedgerRepository(prisma.prisma.ledgerEvent as unknown as LedgerEventDelegate, new PrismaLedgerBalanceStore(prisma.prisma as unknown as RawSqlRunner));
    const rows: NewLedgerEvent[] = [];
    for (let i = 0; i < 90; i++) {
      const inbound = i % 3 !== 0;
      rows.push({
        type: i % 7 === 0 ? 'cash_collected' : 'adjustment',
        amount: 250 * (1 + (i % 9)),
        currency: 'IQD',
        fromAccount: inbound ? 'platform' : account,
        toAccount: inbound ? account : other,
        occurredAt: new Date(t0 + Math.floor(i / 4) * 60_000), // four lines per minute
        idempotencyKey: `${run}:${i}`,
      });
    }
    await repo.appendMany(rows);
    await mem.appendMany(rows);
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('the database sum equals the loaded sum, whole and before a cut-off (on a tie and between ties)', async () => {
    for (const before of [undefined, new Date(t0), new Date(t0 + 5 * 60_000), new Date(t0 + 5 * 60_000 + 1), new Date(t0 + 60 * 60_000)]) {
      expect(await repo.sumFor(account, before), String(before)).toEqual(await mem.sumFor(account, before));
    }
    const full = await mem.byAccount(account);
    expect((await repo.sumFor(account)).events).toBe(full.length);
  });

  it('filtered reads match: by type and from a date', async () => {
    const ids = (es: { idempotencyKey?: string | undefined }[]) => es.map((e) => e.idempotencyKey).sort();
    expect(ids(await repo.byAccountWhere(account, { types: ['cash_collected'] }))).toEqual(ids(await mem.byAccountWhere(account, { types: ['cash_collected'] })));
    const since = new Date(t0 + 10 * 60_000);
    expect(ids(await repo.byAccountWhere(account, { since }))).toEqual(ids(await mem.byAccountWhere(account, { since })));
  });

  it('walking pages covers every line once and never splits a timestamp', async () => {
    for (const take of [1, 3, 5, 40, 200]) {
      let before: Date | undefined;
      const seen: string[] = [];
      for (;;) {
        const page = await repo.byAccountPage(account, { before, take });
        const times = page.events.map((e) => e.occurredAt.getTime());
        expect([...times].sort((a, b) => a - b)).toEqual(times);
        seen.push(...page.events.map((e) => e.idempotencyKey!));
        if (page.events.length === 0) break;
        const floor = page.events[0]!.occurredAt;
        expect((await mem.byAccount(account)).filter((e) => e.occurredAt.getTime() === floor.getTime()).length).toBe(times.filter((t) => t === floor.getTime()).length);
        if (page.complete) break;
        before = floor;
      }
      expect(seen.sort(), `take ${take}`).toEqual((await mem.byAccount(account)).map((e) => e.idempotencyKey!).sort());
    }
  });

  it('a cap read inside a transaction counts lines that transaction already posted', async () => {
    const ledger = new LedgerService(repo, uow);
    const driver = `driver:${run}d`;
    await uow.run(async (tx) => {
      await ledger.record({ type: 'adjustment', amount: 1_000, fromAccount: 'platform', toAccount: driver, occurredAt: new Date(t0), idempotencyKey: `${run}:tx` }, tx);
      expect(await repo.runningBalance(driver, tx)).toEqual({ amount: 1_000, events: 1 });
      expect(await repo.sumFor(driver, undefined, tx)).toEqual({ amount: 1_000, events: 1 });
    });
  });
});
