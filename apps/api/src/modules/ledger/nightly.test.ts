import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES as rules, type LedgerEvent } from '@driver/contracts';
import { InMemoryQueue } from '../../shared/queue.js';
import { localDay, nextNightlyRunAt } from './nightly.job.js';
import { postSettlement } from './postings.js';
import { InMemoryLedgerRepository } from './repository.js';
import { ledgerHarness, workedExample } from './test-harness.js';

/** A store with one row that crosses books, as if something bypassed `record` (e.g. a raw SQL insert). */
class CorruptedRepository extends InMemoryLedgerRepository {
  override async all(): Promise<LedgerEvent[]> {
    const at = new Date('2026-10-03T10:00:00Z');
    const corrupt: LedgerEvent = { id: 'bad', kind: 'money', type: 'credit_issued', amount: 500, currency: 'IQD', fromAccount: 'platform', toAccount: 'points:c1', occurredAt: at, recordedAt: at };
    return [...(await super.all()), corrupt];
  }
}

describe('nightly close (02:00 Asia/Baghdad)', () => {
  it('balanced books: ok, Arabic tick, per-driver owed/cap report, no incident', async () => {
    const h = ledgerHarness();
    await h.posting.orderClosed(workedExample());
    await h.posting.ride({ tripId: 't1', occurredAt: new Date('2026-10-03T12:00:00Z'), customerId: 'c2', payment: 'wallet', driverId: 'd1', takeClass: 'car', fareIqd: 5000 });
    const report = await h.facade.runNightly({ requestedBy: 'fin1' });
    expect(report.ok).toBe(true);
    expect(report.message_ar).toBe('الدفتر متوازن ✓');
    expect(report.money).toMatchObject({ ok: true, net: 0 });
    expect(report.points).toMatchObject({ ok: true, net: 0, events: 2 });
    expect(report.kindViolations).toBe(0);
    expect(report.incidentId).toBeNull();
    expect(report.drivers).toEqual([
      { driverId: 'd1', owedIqd: 0, capIqd: 75000, capRemainingIqd: 75000, overCap: false, payoutDueIqd: 0 },
      { driverId: 'k1', owedIqd: 15500, capIqd: 75000, capRemainingIqd: 59500, overCap: false, payoutDueIqd: 0 },
    ]);
    expect(h.bus.last('ledger.nightly_closed')).toMatchObject({ actorId: 'fin1', aggregate: { name: 'ledger', id: '2026-10-03' } });
    expect(h.incidents.opened()).toEqual([]);
  });

  it('an injected cross-book row unbalances both books and opens an incident', async () => {
    const h = ledgerHarness({ repo: new CorruptedRepository() });
    await h.posting.orderClosed(workedExample());
    const report = await h.nightly.run();
    expect(report.ok).toBe(false);
    expect(report.money).toMatchObject({ ok: false, net: -500 });
    expect(report.points).toMatchObject({ ok: false, net: 500 });
    expect(report.kindViolations).toBe(1);
    expect(report.incidentId).toMatch(/^inc_ledger_/);
    expect(report.message_ar).toContain('الدفتر مو متوازن');
    expect(h.incidents.opened()).toEqual([expect.objectContaining({ id: report.incidentId, kind: 'ledger_imbalance' })]);
    expect(h.bus.last('incident.opened')?.payload).toMatchObject({ kind: 'ledger_imbalance' });
  });

  it('next run is 02:00 Baghdad (23:00 UTC), strictly in the future', () => {
    expect(nextNightlyRunAt(new Date('2026-10-03T12:00:00Z'), rules).toISOString()).toBe('2026-10-03T23:00:00.000Z');
    expect(nextNightlyRunAt(new Date('2026-10-03T21:30:00Z'), rules).toISOString()).toBe('2026-10-03T23:00:00.000Z');
    expect(nextNightlyRunAt(new Date('2026-10-03T23:00:00Z'), rules).toISOString()).toBe('2026-10-04T23:00:00.000Z');
    expect(localDay(new Date('2026-10-03T23:00:00Z'), rules)).toBe('2026-10-04');
  });

  it('runs off the queue at 02:00 and schedules the next night', async () => {
    const h = ledgerHarness({ start: '2026-10-03T12:00:00Z' });
    const queue = new InMemoryQueue<{ day: string }>('ledger-nightly', () => h.clock.now());
    h.nightly.attach(queue);
    await h.nightly.schedule(queue);
    expect(queue.pending().map((j) => [j.id, j.readyAt.toISOString()])).toEqual([['ledger-nightly:2026-10-04', '2026-10-03T23:00:00.000Z']]);
    expect(await queue.drain(new Date('2026-10-03T22:59:00Z'))).toBe(0);
    h.clock.set('2026-10-03T23:00:00Z');
    expect(await queue.drain()).toBe(1);
    expect(h.bus.types()).toContain('ledger.nightly_closed');
    expect(queue.pending().map((j) => j.id)).toEqual(['ledger-nightly:2026-10-05']);
  });

  it('Sunday runs mark every positive driver balance as payout due (G-86 weekly)', async () => {
    const h = ledgerHarness({ start: '2026-10-03T12:00:00Z' }); // Saturday
    await h.posting.ride({ tripId: 't1', occurredAt: new Date('2026-10-03T12:00:00Z'), customerId: 'c2', payment: 'wallet', driverId: 'd1', takeClass: 'car', fareIqd: 5000 });
    expect((await h.nightly.run()).drivers[0]?.payoutDueIqd).toBe(0);
    h.clock.set('2026-10-03T23:00:00Z'); // 02:00 Sunday in Baghdad
    expect((await h.nightly.run()).drivers[0]?.payoutDueIqd).toBe(4400);
    await h.ledger.recordAll(postSettlement({ kind: 'driver_payout', driverId: 'd1', amountIqd: 4400, channel: 'zaincash', reference: 'P-1', occurredAt: h.clock.now() }));
    expect((await h.nightly.run()).drivers[0]?.payoutDueIqd).toBe(0);
  });
});
