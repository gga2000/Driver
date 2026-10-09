import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES as rules } from '@driver/contracts';
import { LedgerService } from './ledger.service.js';
import { postOrderClosed, postSettlement } from './postings.js';
import { InMemoryLedgerRepository, isProjectedAccount, type RunningBalance } from './repository.js';
import { ledgerHarness, workedExample } from './test-harness.js';

const at = new Date('2026-10-02T10:00:00Z');

/** A store whose running balances were knocked off (as if a write had bypassed them). */
class DriftedRepository extends InMemoryLedgerRepository {
  readonly offsets = new Map<string, RunningBalance>();

  override async runningBalance(accountId: string): Promise<RunningBalance | undefined> {
    const r = await super.runningBalance(accountId);
    const o = this.offsets.get(accountId);
    return r && o ? { amount: r.amount + o.amount, events: r.events + o.events } : r;
  }

  override async runningBalances(): Promise<Map<string, RunningBalance>> {
    const all = await super.runningBalances();
    for (const [k, o] of this.offsets) {
      const r = all.get(k) ?? { amount: 0, events: 0 };
      all.set(k, { amount: r.amount + o.amount, events: r.events + o.events });
    }
    return all;
  }

  override async repairRunningBalance(accountId: string): Promise<{ before: RunningBalance; after: RunningBalance }> {
    const before = (await this.runningBalance(accountId))!;
    const { after } = await super.repairRunningBalance(accountId);
    this.offsets.delete(accountId);
    return { before, after };
  }
}

async function randomBook(ledger: LedgerService, n: number, seed0: number): Promise<string[]> {
  const accounts = ['platform', 'driver:a', 'driver:b', 'cash:a', 'cash:b', 'merchant_cash:x', 'customer:y', 'bank'];
  let seed = seed0;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const from = accounts[Math.floor(rand() * accounts.length)]!;
    let to = accounts[Math.floor(rand() * accounts.length)]!;
    if (to === from) to = accounts[(accounts.indexOf(from) + 1) % accounts.length]!;
    await ledger.record({ type: 'adjustment', amount: 250 * (1 + Math.floor(rand() * 40)), fromAccount: from, toAccount: to, occurredAt: new Date(at.getTime() + i * 60_000) });
  }
  return accounts;
}

describe('running driver balance (perf item 13)', () => {
  it('only per-driver accounts are projected', () => {
    expect(['driver:a', 'cash:a'].every(isProjectedAccount)).toBe(true);
    expect(['platform', 'bank', 'customer:a', 'merchant_cash:a', 'household:h', 'points:p', 'drivers', 'cashier:x'].some(isProjectedAccount)).toBe(false);
  });

  it('equals the full-history sum after any sequence of postings, replays included', async () => {
    const ledger = new LedgerService(new InMemoryLedgerRepository());
    const accounts = await randomBook(ledger, 300, 11);
    const g = postOrderClosed(workedExample(), rules).money;
    await ledger.recordAll(g);
    await ledger.recordAll(g); // replay: skipped, so it must not count twice
    await ledger.recordAll(postSettlement({ kind: 'driver_payout', driverId: 'k1', amountIqd: 1000, channel: 'zaincash', reference: 'P-1', occurredAt: at }));
    for (const account of [...accounts, 'driver:k1', 'cash:k1']) {
      expect(await ledger.balance(account), account).toEqual(await ledger.fullBalance(account));
    }
    expect((await ledger.balance('driver:k1')).amount).toBe(0);
    expect((await ledger.balance('cash:k1')).amount).toBe(-16500);
    expect(await ledger.reconcileRunningBalances()).toEqual([]);
  });

  it('a driver with no lines reads 0 without touching the history', async () => {
    const repo = new InMemoryLedgerRepository();
    let historyReads = 0;
    const byAccount = repo.byAccount.bind(repo);
    repo.byAccount = async (id) => {
      historyReads += 1;
      return byAccount(id);
    };
    let sums = 0;
    const sumFor = repo.sumFor.bind(repo);
    repo.sumFor = async (id, before) => {
      sums += 1;
      return sumFor(id, before);
    };
    const ledger = new LedgerService(repo);
    await randomBook(ledger, 50, 3);
    expect(await ledger.balance('driver:new')).toEqual({ accountId: 'driver:new', amount: 0, events: 0 });
    await ledger.balance('driver:a');
    await ledger.balance('cash:b');
    expect(historyReads + sums).toBe(0);
    await ledger.balance('platform'); // not projected: summed by the store (SCALE-16), history never loaded
    await ledger.balance('driver:a', new Date(at.getTime() + 10 * 60_000)); // as of a past instant: summed too
    expect(sums).toBe(2);
    expect(historyReads).toBe(0);
  });

  it('reconcile repairs drift from the full sum and reports only what it changed', async () => {
    const repo = new DriftedRepository();
    const ledger = new LedgerService(repo);
    await randomBook(ledger, 120, 5);
    const truth = await ledger.fullBalance('cash:a');
    repo.offsets.set('cash:a', { amount: 750, events: 1 });
    repo.offsets.set('driver:ghost', { amount: 250, events: 1 }); // a row with no ledger lines at all
    expect((await ledger.balance('cash:a')).amount).toBe(truth.amount + 750);
    const drift = await ledger.reconcileRunningBalances();
    expect(drift).toEqual([
      { accountId: 'cash:a', runningIqd: truth.amount + 750, fullIqd: truth.amount, runningEvents: truth.events + 1, fullEvents: truth.events },
      { accountId: 'driver:ghost', runningIqd: 250, fullIqd: 0, runningEvents: 1, fullEvents: 0 },
    ]);
    expect(await ledger.balance('cash:a')).toEqual(truth);
    expect(await ledger.reconcileRunningBalances()).toEqual([]);
  });

  it('the nightly close repairs drift, logs it and opens an incident; clean books open none', async () => {
    const repo = new DriftedRepository();
    const h = ledgerHarness({ repo });
    await h.posting.orderClosed(workedExample());
    expect((await h.nightly.run()).ok).toBe(true);
    expect(h.incidents.opened()).toEqual([]);

    repo.offsets.set('cash:k1', { amount: -2000, events: 0 });
    const report = await h.nightly.run();
    expect(report.ok).toBe(true); // the books themselves balance; only the projection drifted
    expect(report.drivers.find((d) => d.driverId === 'k1')?.owedIqd).toBe(15500); // read after the repair
    expect(h.incidents.opened()).toEqual([expect.objectContaining({ kind: 'ledger_balance_drift' })]);
    expect((await h.ledger.balance('cash:k1')).amount).toBe(-16500);
  });
});
