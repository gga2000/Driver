import { describe, expect, it } from 'vitest';
import { LATE_PROMISE_MEMO, type Actor, type LedgerEvent } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { Accounts } from './accounts.js';
import { CustomerWalletService, moneyLines } from './customer-wallet.js';
import type { PostingGroup } from './postings.js';
import { ledgerHarness } from './test-harness.js';

const actor = (personId: string): Actor => ({ personId, sessionId: `s_${personId}` });
const group = (id: string, at: string, lines: PostingGroup['lines']): PostingGroup => ({ id, kind: 'money', occurredAt: new Date(at), refs: {}, lines, controls: [] });

describe('customer wallet: lines that open what they were, and what you saved this year (joy w8, w10)', () => {
  it('a seat line names its booking, a top-up its request and receipt reference', () => {
    const c = Accounts.customer('c1');
    const at = new Date('2026-10-05T10:00:00Z');
    const ev = (id: string, over: Partial<LedgerEvent>): LedgerEvent => ({ id, kind: 'money', currency: 'IQD', occurredAt: at, recordedAt: at, ...over }) as LedgerEvent;
    const lines = moneyLines(c, [
      ev('e1', { type: 'credit_issued', amount: 25_000, fromAccount: Accounts.bank, toAccount: c, memo: 'topup:agent:T-4XQ6-91AB', postingGroupId: 'topup:tu_7' }),
      ev('e2', { type: 'fare', amount: 10_000, fromAccount: c, toAccount: Accounts.driver('d1'), memo: 'seat', postingGroupId: 'seat:bk_9.front:money' }),
    ]);
    expect(lines.find((l) => l.kind === 'topup')).toMatchObject({ topUpId: 'tu_7', reference: 'T-4XQ6-91AB' });
    expect(lines.find((l) => l.kind === 'seat')).toMatchObject({ bookingId: 'bk_9' });
  });

  it('sums points used, deals, late credits and change kept since 1 January (Baghdad) only', async () => {
    const clock = new FakeClock('2026-10-06T09:00:00Z');
    const h = ledgerHarness({ clock });
    const wallet = new CustomerWalletService(h.ledger, h.rules, { phoneHashOf: async () => null }, { householdOf: () => null }, clock);
    const c = Accounts.customer('c1');
    await h.ledger.recordAll([
      group('o1', '2026-10-01T10:00:00Z', [
        { type: 'promo_funded', amount: 1_000, fromAccount: Accounts.platform, toAccount: c, memo: 'points:delivery_fee' },
        { type: 'promo_funded', amount: 3_000, fromAccount: Accounts.platform, toAccount: c, memo: 'deal:p1' },
      ]),
      group('late1', '2026-10-02T10:00:00Z', [{ type: 'credit_issued', amount: 1_000, fromAccount: Accounts.platform, toAccount: c, memo: LATE_PROMISE_MEMO }]),
      group('chg1', '2026-10-03T10:00:00Z', [{ type: 'cash_change_to_wallet', amount: 2_250, fromAccount: Accounts.cash('cour'), toAccount: c }]),
      // A top-up is the customer's own money, not a saving; last year's deal is not this year's.
      group('tu1', '2026-10-03T11:00:00Z', [{ type: 'credit_issued', amount: 25_000, fromAccount: Accounts.bank, toAccount: c, memo: 'topup:agent' }]),
      group('old', '2025-12-31T20:00:00Z', [{ type: 'promo_funded', amount: 9_000, fromAccount: Accounts.platform, toAccount: c, memo: 'deal:p0' }]),
    ]);
    const b = await wallet.balance(actor('c1'));
    expect(b.savedThisYearIqd).toBe(7_250);
    expect(b.pointsMaxPerOrder).toBe(h.rules.points.maxPerOrder);
  });
});
