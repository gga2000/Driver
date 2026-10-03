import { beforeEach, describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES as rules, type LedgerEvent } from '@driver/contracts';
import type { Tx } from '@driver/db';
import { UnitOfWork, type TransactionRunner } from '../../shared/db/unit-of-work.js';
import { Accounts, LedgerService, sumFor } from './ledger.service.js';
import { postOrderClosed, postSettlement, type PostingGroup } from './postings.js';
import { PrismaLedgerRepository, type LedgerEventDelegate } from './prisma.repository.js';
import { InMemoryLedgerRepository } from './repository.js';
import { workedExample } from './test-harness.js';

const at = new Date('2026-10-02T10:00:00Z');

describe('LedgerService.record (single events)', () => {
  let ledger: LedgerService;

  beforeEach(() => {
    ledger = new LedgerService(new InMemoryLedgerRepository());
  });

  it('the invariant holds for any sequence of valid events', async () => {
    const accounts = ['platform', 'driver:a', 'driver:b', 'merchant_cash:x', 'customer:y', 'cash:a'];
    let seed = 7;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let i = 0; i < 200; i++) {
      const from = accounts[Math.floor(rand() * accounts.length)]!;
      let to = accounts[Math.floor(rand() * accounts.length)]!;
      if (to === from) to = accounts[(accounts.indexOf(from) + 1) % accounts.length]!;
      await ledger.record({ type: 'adjustment', amount: 250 * (1 + Math.floor(rand() * 40)), fromAccount: from, toAccount: to, occurredAt: at });
    }
    const inv = await ledger.checkInvariant();
    expect(inv.ok).toBe(true);
    expect(inv.events).toBe(200);
    expect(inv.money).toEqual({ ok: true, net: 0, events: 200 });
  });

  it('rejects zero, negative, fractional, self-transfers and unknown accounts', async () => {
    const base = { type: 'adjustment' as const, fromAccount: 'platform', toAccount: 'driver:d', occurredAt: at };
    await expect(ledger.record({ ...base, amount: 0 })).rejects.toThrow(/positive integer/);
    await expect(ledger.record({ ...base, amount: -500 })).rejects.toThrow(/positive integer/);
    await expect(ledger.record({ ...base, amount: 12.5 })).rejects.toThrow(/positive integer/);
    await expect(ledger.record({ ...base, amount: 500, toAccount: 'platform' })).rejects.toThrow(/same/);
    await expect(ledger.record({ ...base, amount: 500, toAccount: 'wallet:x' })).rejects.toMatchObject({ code: 'invalid_account' });
  });

  it('is idempotent on idempotency key (offline action queue replays)', async () => {
    const e = { type: 'cash_collected' as const, amount: 5000, fromAccount: 'cash:d', toAccount: 'customer:c', occurredAt: at, idempotencyKey: 'k1' };
    const first = await ledger.record(e);
    const second = await ledger.record(e);
    expect(second.id).toBe(first.id);
    expect((await ledger.balance('customer:c')).amount).toBe(5000);
  });

  it('stored events are immutable', async () => {
    const e = await ledger.record({ type: 'adjustment', amount: 1000, fromAccount: 'platform', toAccount: 'driver:d', occurredAt: at });
    expect(() => {
      (e as { amount: number }).amount = 1;
    }).toThrow();
  });
});

describe('money vs points books (domain §5)', () => {
  it('derives kind from type and records points on points accounts', async () => {
    const ledger = new LedgerService(new InMemoryLedgerRepository());
    const e = await ledger.record({ type: 'points_earned', amount: 150, fromAccount: Accounts.pointsPool, toAccount: Accounts.points('p1'), occurredAt: at });
    expect(e.kind).toBe('points');
    expect((await ledger.balance(Accounts.points('p1'))).amount).toBe(150);
    const inv = await ledger.checkInvariant();
    expect(inv.points).toEqual({ ok: true, net: 0, events: 1 });
    expect(inv.money.events).toBe(0);
  });

  it('a points event on a money account throws kind_mismatch and writes nothing', async () => {
    const ledger = new LedgerService(new InMemoryLedgerRepository());
    await expect(
      ledger.record({ type: 'points_earned', amount: 100, fromAccount: Accounts.platform, toAccount: Accounts.points('p1'), occurredAt: at }),
    ).rejects.toMatchObject({ code: 'kind_mismatch' });
    await expect(
      ledger.record({ type: 'cash_collected', amount: 100, fromAccount: Accounts.customer('c'), toAccount: Accounts.points('p1'), occurredAt: at }),
    ).rejects.toMatchObject({ code: 'kind_mismatch' });
    await expect(
      ledger.record({ type: 'cash_collected', kind: 'points', amount: 100, fromAccount: Accounts.customer('c'), toAccount: Accounts.cash('d'), occurredAt: at }),
    ).rejects.toMatchObject({ code: 'kind_mismatch' });
    expect((await ledger.checkInvariant()).events).toBe(0);
  });

  it('a posting group of one book may not carry a line of the other', async () => {
    const ledger = new LedgerService(new InMemoryLedgerRepository());
    const mixed: PostingGroup = {
      id: 'mixed',
      kind: 'money',
      occurredAt: at,
      refs: {},
      controls: [],
      lines: [
        { type: 'service_fee', amount: 500, fromAccount: 'customer:c', toAccount: 'platform' },
        { type: 'points_earned', amount: 5, fromAccount: 'points_pool', toAccount: 'points:c' },
      ],
    };
    await expect(ledger.recordAll(mixed)).rejects.toMatchObject({ code: 'kind_mismatch' });
    expect((await ledger.checkInvariant()).events).toBe(0);
  });
});

describe('LedgerService.recordAll (posting groups)', () => {
  it('records the worked example as one group and every balance follows', async () => {
    const ledger = new LedgerService(new InMemoryLedgerRepository());
    const p = postOrderClosed(workedExample(), rules);
    const res = await ledger.recordAll(p.money);
    expect(res.recorded).toEqual(['order:o1:money']);
    expect(res.events.every((e) => e.postingGroupId === 'order:o1:money' && e.orderId === 'o1')).toBe(true);
    expect((await ledger.balance('platform')).amount).toBe(2750);
    expect((await ledger.balance('driver:k1')).amount).toBe(1000);
    expect((await ledger.balance('merchant_cash:m1')).amount).toBe(12750);
    expect((await ledger.balance('cash:k1')).amount).toBe(-16500);
    expect((await ledger.balance('customer:c1')).amount).toBe(0);
    expect((await ledger.checkInvariant()).ok).toBe(true);
  });

  it('a replayed group is skipped, not doubled', async () => {
    const ledger = new LedgerService(new InMemoryLedgerRepository());
    const g = postOrderClosed(workedExample(), rules).money;
    await ledger.recordAll(g);
    const again = await ledger.recordAll(g);
    expect(again).toMatchObject({ recorded: [], skipped: ['order:o1:money'] });
    expect((await ledger.balance('platform')).amount).toBe(2750);
  });

  it('an unbalanced batch writes nothing — not even its valid groups', async () => {
    const repo = new InMemoryLedgerRepository();
    const ledger = new LedgerService(repo);
    const good = postOrderClosed(workedExample(), rules).money;
    const ok2 = postOrderClosed(workedExample({ orderId: 'o2' }), rules).money;
    // Charged 16,500 but the courier only "collected" 16,000 while the control says the customer nets to 0.
    const bad: PostingGroup = { ...ok2, controls: [{ account: 'customer:c1', net: 0 }], lines: ok2.lines.map((l) => (l.type === 'cash_collected' ? { ...l, amount: 16000 } : l)) };
    await expect(ledger.recordAll([good, bad])).rejects.toMatchObject({ code: 'unbalanced' });
    expect(await repo.all()).toHaveLength(0);
    const zero: PostingGroup = { ...good, id: 'z', lines: [{ ...good.lines[0]!, amount: 0 }] };
    await expect(ledger.recordAll([good, zero])).rejects.toMatchObject({ code: 'invalid_amount' });
    await expect(ledger.recordAll([good, good])).rejects.toMatchObject({ code: 'unbalanced' });
    await expect(ledger.recordAll({ ...good, lines: [] })).rejects.toMatchObject({ code: 'unbalanced' });
    expect(await repo.all()).toHaveLength(0);
  });

  it('runs inside the unit of work and rolls back with it', async () => {
    const log: string[] = [];
    const runner: TransactionRunner = {
      async $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
        log.push('begin');
        const out = await fn({ txId: 1 } as unknown as Tx);
        log.push('commit');
        return out;
      },
    };
    const ledger = new LedgerService(new InMemoryLedgerRepository(), new UnitOfWork(runner));
    await ledger.recordAll(postOrderClosed(workedExample(), rules).money);
    expect(log).toEqual(['begin', 'commit']);
  });
});

describe('statement with Arabic line labels', () => {
  it('labels, signs, running balance, opening balance and range', async () => {
    const ledger = new LedgerService(new InMemoryLedgerRepository());
    await ledger.recordAll(postOrderClosed(workedExample({ occurredAt: new Date('2026-10-01T10:00:00Z') }), rules).money);
    await ledger.recordAll(postOrderClosed(workedExample({ orderId: 'o2', occurredAt: new Date('2026-10-02T10:00:00Z') }), rules).money);
    await ledger.recordAll(postSettlement({ kind: 'driver_settlement', driverId: 'k1', amountIqd: 5500, channel: 'zaincash', reference: 'D-X', occurredAt: new Date('2026-10-02T20:00:00Z') }));

    const cash = await ledger.statement('cash:k1', { from: new Date('2026-10-02T00:00:00Z') });
    expect(cash.openingIqd).toBe(-16500);
    expect(cash.lines.map((l) => [l.label_ar, l.amountIqd, l.balanceAfterIqd])).toEqual([
      ['كاش مستلم', -16500, -33000],
      ['تسوية مع الشركة', 5500, -27500],
    ]);
    expect(cash.closingIqd).toBe(-27500);
    expect(cash).toMatchObject({ inIqd: 5500, outIqd: 16500 });

    const earnings = await ledger.statement('driver:k1');
    expect(earnings.lines.map((l) => l.label_ar)).toEqual(['أجور التوصيل', 'أجور التوصيل']);
    expect(earnings.lines[0]).toMatchObject({ label_en: 'Delivery fee', orderId: 'o1', counterparty: 'customer:c1' });

    const merchant = await ledger.statement('merchant_cash:m1', { to: new Date('2026-10-02T00:00:00Z') });
    expect(merchant.lines.map((l) => [l.label_ar, l.amountIqd])).toEqual([
      ['مستحق للمطعم', 15000],
      ['عمولة المنصة', -2250],
    ]);
  });
});

describe('sumFor', () => {
  it('nets inflows against outflows', () => {
    const mk = (from: string, to: string, amount: number): LedgerEvent => ({
      id: 'x', kind: 'money', type: 'adjustment', amount, currency: 'IQD', fromAccount: from, toAccount: to, occurredAt: at, recordedAt: at,
    });
    expect(sumFor('a', [mk('a', 'b', 100), mk('b', 'a', 250)])).toBe(150);
  });
});

describe('PrismaLedgerRepository', () => {
  function fakeDelegate() {
    const rows: Array<Parameters<LedgerEventDelegate['create']>[0]['data'] & { id: string; recordedAt: Date }> = [];
    const delegate: LedgerEventDelegate = {
      async create({ data }) {
        const row = { ...data, id: `row_${rows.length + 1}`, recordedAt: at };
        rows.push(row);
        return row;
      },
      async findMany({ where }) {
        if (!where) return rows;
        if ('tripId' in where) return rows.filter((r) => r.tripId === where['tripId']);
        if ('postingGroupId' in where) {
          const ids = (where['postingGroupId'] as { in: string[] }).in;
          return rows.filter((r) => r.postingGroupId && ids.includes(r.postingGroupId));
        }
        const or = where['OR'] as Array<Record<string, string>>;
        return rows.filter((r) => or.some((c) => r.fromAccount === c['fromAccount'] || r.toAccount === c['toAccount']));
      },
      async findUnique({ where }) {
        return rows.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null;
      },
    };
    return { rows, delegate };
  }

  it('maps contract events to rows and back through a fake delegate', async () => {
    const { rows, delegate } = fakeDelegate();
    const ledger = new LedgerService(new PrismaLedgerRepository(delegate));
    await ledger.record({ type: 'cash_collected', amount: 7000, fromAccount: 'cash:d', toAccount: 'customer:c', tripId: 't', occurredAt: at, idempotencyKey: 'ik' });
    await ledger.record({ type: 'cash_collected', amount: 7000, fromAccount: 'cash:d', toAccount: 'customer:c', tripId: 't', occurredAt: at, idempotencyKey: 'ik' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountIqd).toBe(7000);
    expect((await ledger.balance('cash:d')).amount).toBe(-7000);
    expect((await ledger.eventsForTrip('t'))[0]?.amount).toBe(7000);
    expect((await ledger.checkInvariant()).ok).toBe(true);
  });

  it('writes a group through the transaction delegate when one is given', async () => {
    const root = fakeDelegate();
    const scoped = fakeDelegate();
    const ledger = new LedgerService(new PrismaLedgerRepository(root.delegate));
    const g = postOrderClosed(workedExample(), rules).money;
    await ledger.recordAll(g, { ledgerEvent: scoped.delegate } as unknown as Tx);
    expect(root.rows).toHaveLength(0);
    expect(scoped.rows).toHaveLength(g.lines.length);
    expect(scoped.rows.every((r) => r.postingGroupId === 'order:o1:money' && r.kind === 'money')).toBe(true);
  });
});
