import { describe, expect, it } from 'vitest';
import { matchTransfer, settlementReference } from './settlement-ref.js';
import type { Adjustment } from './adjustments.service.js';
import { ledgerHarness } from './test-harness.js';

const finance = (personId: string) => ({ personId, roles: ['finance'] as const });
/** A test queue standing in for the Console's persisted second-OK queue. */
const parked: Adjustment[] = [];
const park = async (adj: Adjustment) => (parked.push(adj), adj);
const parkedWhy: string[] = [];
const parkWhy = async (adj: Adjustment, why: string) => (parkedWhy.push(why), adj);

describe('adjustments (G-85)', () => {
  it('need the finance role, a reason and a linked incident', async () => {
    const h = ledgerHarness();
    const incidentId = await h.incidents.open({ kind: 'cash_discrepancy', summary: 'k1 short 2,000' });
    const req = { amountIqd: 2000, fromAccount: 'platform', toAccount: 'cash:k1', reason: 'counted stack short by 2,000', incidentId };
    await expect(h.adjustments.request({ personId: 'ops1', roles: ['admin', 'dispatcher'] }, req, park)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.adjustments.request(finance('f1'), { ...req, reason: '' }, park)).rejects.toMatchObject({ code: 'adjustment_incident_required' });
    await expect(h.adjustments.request(finance('f1'), { ...req, incidentId: 'inc_unknown' }, park)).rejects.toMatchObject({ code: 'adjustment_incident_required' });
    expect(await h.repo.all()).toHaveLength(0);

    const adj = await h.adjustments.request(finance('f1'), req, park);
    expect(adj).toMatchObject({ status: 'posted', requestedBy: 'f1', approvedBy: null });
    const [row] = await h.repo.all();
    expect(row).toMatchObject({ type: 'adjustment', amount: 2000, memo: `counted stack short by 2,000 [incident:${incidentId}]` });
  });

  it('above 25,000 a second, different finance person approves before anything posts', async () => {
    const h = ledgerHarness();
    h.incidents.register('inc_support_7');
    const req = { amountIqd: 30000, fromAccount: 'merchant_cash:m1', toAccount: 'platform', reason: 'double payout reversed', incidentId: 'inc_support_7' };
    const pending = await h.adjustments.request(finance('f1'), req, park);
    expect(pending.status).toBe('pending_second_approval');
    expect(parked.at(-1)).toEqual(pending);
    expect(await h.repo.all()).toHaveLength(0);
    await expect(h.adjustments.approve(finance('f1'), pending)).rejects.toMatchObject({ code: 'adjustment_second_approver' });
    await expect(h.adjustments.approve({ personId: 'f2', roles: ['support'] }, pending)).rejects.toMatchObject({ code: 'forbidden' });
    const posted = await h.adjustments.approve(finance('f2'), pending);
    expect(posted).toMatchObject({ status: 'posted', requestedBy: 'f1', approvedBy: 'f2' });
    expect((await h.ledger.balance('merchant_cash:m1')).amount).toBe(-30000);
    // Approving the same request again posts nothing more (one group per adjustment).
    await h.adjustments.approve(finance('f3'), pending);
    expect((await h.ledger.balance('merchant_cash:m1')).amount).toBe(-30000);
    // exactly 25,000 needs no second approver
    expect((await h.adjustments.request(finance('f1'), { ...req, amountIqd: 25000 }, park)).status).toBe('posted');
  });

  it('one person posts at most 50,000 alone in a Baghdad day; over it waits for a second OK', async () => {
    const h = ledgerHarness();
    h.incidents.register('inc_cap');
    const req = { amountIqd: 20_000, fromAccount: 'platform', toAccount: 'cash:k9', reason: 'counted stack short', incidentId: 'inc_cap' };
    let solo = 0;
    const days: Array<{ from: Date; to: Date }> = [];
    const opts = {
      soloPostedToday: async (day: { from: Date; to: Date }) => (days.push(day), solo),
    };
    const send = async (amountIqd: number) => {
      const adj = await h.adjustments.request(finance('f1'), { ...req, amountIqd }, parkWhy, opts);
      if (adj.status === 'posted') solo += amountIqd;
      return adj.status;
    };
    expect(await send(20_000)).toBe('posted');
    expect(await send(20_000)).toBe('posted');
    expect(await send(20_000)).toBe('pending_second_approval');
    expect(parkedWhy.at(-1)).toBe('daily_cap');
    expect(await send(10_000)).toBe('posted'); // exactly 50,000
    expect(await send(30_000)).toBe('pending_second_approval');
    expect(parkedWhy.at(-1)).toBe('above_line');
    // The day asked about is the Baghdad calendar day (UTC+3).
    const now = h.clock.now();
    const day = days.at(-1)!;
    expect(day.to.getTime() - day.from.getTime()).toBe(86_400_000);
    expect(day.from.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(day.to.getTime()).toBeGreaterThan(now.getTime());
    expect((day.from.getUTCHours() + 3) % 24).toBe(0);
    expect((await h.ledger.balance('cash:k9')).amount).toBe(50_000);
  });

  it('may link an incident from another source (a support ticket), and never moves money to the same account', async () => {
    const h = ledgerHarness();
    h.adjustments.linkIncidents(async (id) => id === 'tk_42');
    const req = { amountIqd: 1000, fromAccount: 'platform', toAccount: 'driver:k1', reason: 'missed tip from the door', incidentId: 'tk_42' };
    expect((await h.adjustments.request(finance('f1'), req, park)).status).toBe('posted');
    await expect(h.adjustments.request(finance('f1'), { ...req, incidentId: 'tk_43' }, park)).rejects.toMatchObject({ code: 'adjustment_incident_required' });
    await expect(h.adjustments.request(finance('f1'), { ...req, toAccount: 'platform' }, park)).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('settlement references (G-82)', () => {
  it('short, typeable, stable per party/day/seq', () => {
    const at = new Date('2026-10-03T12:00:00Z');
    const ref = settlementReference('D', 'k1', at);
    expect(ref).toMatch(/^D-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(settlementReference('D', 'k1', at)).toBe(ref);
    expect(settlementReference('D', 'k1', at, 1)).not.toBe(ref);
    expect(settlementReference('D', 'k2', at)).not.toBe(ref);
  });

  it('match on reference first, amount ± 500 second, manual queue third', () => {
    const open = [
      { reference: 'D-4K7Q-9MZT', partyId: 'k1', expectedIqd: 75000 },
      { reference: 'D-8H2R-1PXA', partyId: 'k2', expectedIqd: 75000 },
      { reference: 'D-3N5S-7WQB', partyId: 'k3', expectedIqd: 40000 },
    ];
    expect(matchTransfer({ amountIqd: 74500, note: 'تسوية d 8h2r 1pxa' }, open)).toMatchObject({ by: 'reference', settlement: { partyId: 'k2' } });
    expect(matchTransfer({ amountIqd: 40500, note: '' }, open)).toMatchObject({ by: 'amount', settlement: { partyId: 'k3' } });
    // Two drivers sent 75,000 in the same hour and neither typed the reference: a person decides.
    expect(matchTransfer({ amountIqd: 75000, note: 'driver' }, open)).toMatchObject({ by: 'manual', candidates: [{ partyId: 'k1' }, { partyId: 'k2' }] });
    expect(matchTransfer({ amountIqd: 12000, note: '' }, open)).toEqual({ by: 'manual', candidates: [] });
  });
});
