import { describe, expect, it } from 'vitest';
import { matchTransfer, settlementReference } from './settlement-ref.js';
import { ledgerHarness } from './test-harness.js';

const finance = (personId: string) => ({ personId, roles: ['finance'] as const });

describe('adjustments (G-85)', () => {
  it('need the finance role, a reason and a linked incident', async () => {
    const h = ledgerHarness();
    const incidentId = await h.incidents.open({ kind: 'cash_discrepancy', summary: 'k1 short 2,000' });
    const req = { amountIqd: 2000, fromAccount: 'platform', toAccount: 'cash:k1', reason: 'counted stack short by 2,000', incidentId };
    await expect(h.adjustments.request({ personId: 'ops1', roles: ['admin', 'dispatcher'] }, req)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.adjustments.request(finance('f1'), { ...req, reason: '' })).rejects.toMatchObject({ code: 'adjustment_incident_required' });
    await expect(h.adjustments.request(finance('f1'), { ...req, incidentId: 'inc_unknown' })).rejects.toMatchObject({ code: 'adjustment_incident_required' });
    expect(await h.repo.all()).toHaveLength(0);

    const adj = await h.adjustments.request(finance('f1'), req);
    expect(adj).toMatchObject({ status: 'posted', requestedBy: 'f1', approvedBy: null });
    const [row] = await h.repo.all();
    expect(row).toMatchObject({ type: 'adjustment', amount: 2000, memo: `counted stack short by 2,000 [incident:${incidentId}]` });
  });

  it('above 25,000 a second, different finance person approves before anything posts', async () => {
    const h = ledgerHarness();
    h.incidents.register('inc_support_7');
    const req = { amountIqd: 30000, fromAccount: 'merchant_cash:m1', toAccount: 'platform', reason: 'double payout reversed', incidentId: 'inc_support_7' };
    const pending = await h.adjustments.request(finance('f1'), req);
    expect(pending.status).toBe('pending_second_approval');
    expect(await h.repo.all()).toHaveLength(0);
    await expect(h.adjustments.approve(finance('f1'), pending.id)).rejects.toMatchObject({ code: 'adjustment_second_approver' });
    await expect(h.adjustments.approve({ personId: 'f2', roles: ['support'] }, pending.id)).rejects.toMatchObject({ code: 'forbidden' });
    const posted = await h.adjustments.approve(finance('f2'), pending.id);
    expect(posted).toMatchObject({ status: 'posted', requestedBy: 'f1', approvedBy: 'f2' });
    expect((await h.ledger.balance('merchant_cash:m1')).amount).toBe(-30000);
    expect(h.adjustments.pendingApprovals()).toEqual([]);
    await expect(h.adjustments.approve(finance('f3'), pending.id)).rejects.toMatchObject({ code: 'not_found' });
    // exactly 25,000 needs no second approver
    expect((await h.adjustments.request(finance('f1'), { ...req, amountIqd: 25000 })).status).toBe('posted');
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
