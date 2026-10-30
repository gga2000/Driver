import { describe, expect, it } from 'vitest';
import type { Tx } from '@driver/db';
import { UnitOfWork, type TransactionRunner } from '../../shared/db/unit-of-work.js';
import { MoneyOutService } from './money-out.service.js';

/** A runner whose transactions keep their writes only when they commit. */
class RecordingRunner implements TransactionRunner {
  readonly committed: string[] = [];

  async $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = { writes: [] as string[] };
    const out = await fn(tx as unknown as Tx);
    this.committed.push(...tx.writes);
    return out;
  }
}

const write = (tx: Tx, what: string) => (tx as unknown as { writes: string[] }).writes.push(what);

function harness(opts: { auditFails: boolean }) {
  const runner = new RecordingRunner();
  const uow = new UnitOfWork(runner);
  // The ledger posts the payout in a unit of work of its own (joining one already open).
  const merchantCash = {
    recordPayout: () => uow.run(async (tx) => (write(tx, 'payout'), 5_000)),
    recordDriverPayout: () => uow.run(async (tx) => (write(tx, 'payout'), 5_000)),
  };
  const audits = {
    record: async (entry: { action: string }, tx: Tx) => {
      if (opts.auditFails) throw new Error('audit log unavailable');
      write(tx, entry.action);
    },
  };
  const orgs = { get: async () => ({ name: 'مطعم خالد', members: [] }) };
  const service = new MoneyOutService(merchantCash as never, {} as never, {} as never, {} as never, {} as never, orgs as never, audits as never, uow);
  return { runner, service };
}

const actor = { personId: 'fin_1', sessionId: 's1' };
const merchant = { cityId: 'aziziyah', merchantId: 'm1', amountIqd: 10_000, channel: 'zaincash', idempotencyKey: 'k-1' } as never;
const driver = { cityId: 'aziziyah', driverId: 'd1', amountIqd: 10_000, channel: 'zaincash', idempotencyKey: 'k-2' } as never;

describe('money out: a payout never exists without its audit row', () => {
  it('the payout and its audit row commit in one transaction', async () => {
    const h = harness({ auditFails: false });
    await h.service.payMerchant(actor, merchant);
    await h.service.payDriver(actor, driver);
    expect(h.runner.committed).toEqual(['payout', 'finance.merchant_payout', 'payout', 'finance.driver_payout']);
  });

  it('when the audit row cannot be written, the payout is rolled back with it', async () => {
    const h = harness({ auditFails: true });
    await expect(h.service.payMerchant(actor, merchant)).rejects.toThrow('audit log unavailable');
    await expect(h.service.payDriver(actor, driver)).rejects.toThrow('audit log unavailable');
    expect(h.runner.committed).toEqual([]);
  });
});
