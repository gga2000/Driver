import { beforeEach, describe, expect, it } from 'vitest';
import { Accounts, LedgerService, sumFor } from './ledger.service.js';
import { PrismaLedgerRepository, type LedgerEventDelegate } from './prisma.repository.js';
import { InMemoryLedgerRepository } from './repository.js';

const at = new Date('2026-10-02T10:00:00Z');

describe('LedgerService', () => {
  let ledger: LedgerService;

  beforeEach(() => {
    ledger = new LedgerService(new InMemoryLedgerRepository());
  });

  it('runs the full cash-on-delivery flow and every balance follows from events', async () => {
    const tripId = 't1';
    const customer = Accounts.customer('c1');
    const cash = Accounts.cash('d1');
    const driver = Accounts.driver('d1');
    const merchant = Accounts.merchant('m1');
    const platform = Accounts.platform;

    // Order 25,000 (food) + 3,000 delivery. Driver collects 28,000 cash at the door.
    await ledger.record({ type: 'cash_collected', amount: 28000, fromAccount: customer, toAccount: cash, tripId, occurredAt: at });
    // Platform earns 15% commission on the 25,000 food value (3,750) from the merchant's share.
    await ledger.record({ type: 'merchant_payable', amount: 25000, fromAccount: cash, toAccount: merchant, tripId, occurredAt: at });
    await ledger.record({ type: 'commission_accrued', amount: 3750, fromAccount: merchant, toAccount: platform, tripId, occurredAt: at });
    // The 3,000 delivery fee is the driver's, minus the platform's 20% take on it (600).
    await ledger.record({ type: 'driver_settlement', amount: 3000, fromAccount: cash, toAccount: driver, tripId, occurredAt: at });
    await ledger.record({ type: 'commission_accrued', amount: 600, fromAccount: driver, toAccount: platform, tripId, occurredAt: at });

    expect((await ledger.balance(customer)).amount).toBe(-28000);
    expect((await ledger.balance(cash)).amount).toBe(0);
    expect((await ledger.balance(merchant)).amount).toBe(21250);
    expect((await ledger.balance(driver)).amount).toBe(2400);
    expect((await ledger.balance(platform)).amount).toBe(4350);

    // Weekly merchant payout leaves the system: what we owed the merchant drops to zero.
    await ledger.record({ type: 'merchant_payout', amount: 21250, fromAccount: merchant, toAccount: Accounts.bank, occurredAt: at, memo: 'weekly' });
    expect((await ledger.balance(merchant)).amount).toBe(0);
    expect((await ledger.balance(Accounts.bank)).amount).toBe(21250);

    const inv = await ledger.checkInvariant();
    expect(inv.ok).toBe(true);
    expect(inv.net).toBe(0);
    expect(inv.events).toBe(6);
    expect((await ledger.eventsForTrip(tripId)).length).toBe(5);
  });

  it('the invariant holds for any sequence of valid events', async () => {
    const accounts = ['platform', 'driver:a', 'driver:b', 'merchant:x', 'customer:y', 'cash:a'];
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
  });

  it('enforces the driver credit cap on cash held', async () => {
    const cap = 100000;
    const customer = Accounts.customer('c');
    for (let i = 0; i < 4; i++) {
      await ledger.record({ type: 'cash_collected', amount: 24000, fromAccount: customer, toAccount: Accounts.cash('d9'), occurredAt: at });
    }
    expect(await ledger.isOverCap('d9', cap)).toBe(false); // 96,000
    await ledger.record({ type: 'cash_collected', amount: 4000, fromAccount: customer, toAccount: Accounts.cash('d9'), occurredAt: at });
    expect(await ledger.isOverCap('d9', cap)).toBe(true); // exactly 100,000 blocks
    // Settlement brings the driver back under the cap.
    await ledger.record({ type: 'driver_settlement', amount: 60000, fromAccount: Accounts.cash('d9'), toAccount: Accounts.platform, occurredAt: at });
    expect(await ledger.isOverCap('d9', cap)).toBe(false);
  });

  it('rejects zero, negative, fractional and self-transfers', async () => {
    const base = { type: 'adjustment' as const, fromAccount: 'platform', toAccount: 'driver:d', occurredAt: at };
    await expect(ledger.record({ ...base, amount: 0 })).rejects.toThrow(/positive integer/);
    await expect(ledger.record({ ...base, amount: -500 })).rejects.toThrow(/positive integer/);
    await expect(ledger.record({ ...base, amount: 12.5 })).rejects.toThrow(/positive integer/);
    await expect(ledger.record({ ...base, amount: 500, toAccount: 'platform' })).rejects.toThrow(/same/);
  });

  it('is idempotent on idempotency key (offline action queue replays)', async () => {
    const e = { type: 'cash_collected' as const, amount: 5000, fromAccount: 'customer:c', toAccount: 'cash:d', occurredAt: at, idempotencyKey: 'k1' };
    const first = await ledger.record(e);
    const second = await ledger.record(e);
    expect(second.id).toBe(first.id);
    expect((await ledger.balance('cash:d')).amount).toBe(5000);
  });

  it('stored events are immutable', async () => {
    const e = await ledger.record({ type: 'adjustment', amount: 1000, fromAccount: 'platform', toAccount: 'driver:d', occurredAt: at });
    expect(() => {
      (e as { amount: number }).amount = 1;
    }).toThrow();
  });
});

describe('sumFor', () => {
  it('nets inflows against outflows', () => {
    const mk = (from: string, to: string, amount: number) => ({
      id: 'x', type: 'adjustment' as const, amount, currency: 'IQD' as const, fromAccount: from, toAccount: to, occurredAt: at, recordedAt: at,
    });
    expect(sumFor('a', [mk('a', 'b', 100), mk('b', 'a', 250)])).toBe(150);
  });
});

describe('PrismaLedgerRepository', () => {
  it('maps contract events to rows and back through a fake delegate', async () => {
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
        const or = where['OR'] as Array<Record<string, string>>;
        return rows.filter((r) => or.some((c) => r.fromAccount === c['fromAccount'] || r.toAccount === c['toAccount']));
      },
      async findUnique({ where }) {
        return rows.find((r) => r.idempotencyKey === where.idempotencyKey) ?? null;
      },
    };
    const ledger = new LedgerService(new PrismaLedgerRepository(delegate));
    await ledger.record({ type: 'cash_collected', amount: 7000, fromAccount: 'customer:c', toAccount: 'cash:d', tripId: 't', occurredAt: at, idempotencyKey: 'ik' });
    await ledger.record({ type: 'cash_collected', amount: 7000, fromAccount: 'customer:c', toAccount: 'cash:d', tripId: 't', occurredAt: at, idempotencyKey: 'ik' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amountIqd).toBe(7000);
    expect((await ledger.balance('cash:d')).amount).toBe(7000);
    expect((await ledger.eventsForTrip('t'))[0]?.amount).toBe(7000);
    expect((await ledger.checkInvariant()).ok).toBe(true);
  });
});
