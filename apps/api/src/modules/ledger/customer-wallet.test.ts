import { describe, expect, it } from 'vitest';
import { LATE_PROMISE_MEMO, orderTicketNumber, type Actor, type LedgerEvent } from '@driver/contracts';
import { Accounts } from './accounts.js';
import { claimablePending, CustomerWalletService, moneyLines, pageLines, pointsWorthIqd, topupAgentsFromEnv, type WalletHouseholds } from './customer-wallet.js';
import type { PostingGroup } from './postings.js';
import { postOrderClosed, postPoints } from './postings.js';
import { ledgerHarness, workedExample } from './test-harness.js';

const actor = (personId: string): Actor => ({ personId, sessionId: `s_${personId}` });

function walletHarness(opts: { households?: WalletHouseholds; hashes?: Record<string, string> } = {}) {
  const h = ledgerHarness();
  const hashes = opts.hashes ?? { c1: 'hash_c1' };
  const wallet = new CustomerWalletService(h.ledger, h.rules, { phoneHashOf: async (id) => hashes[id] ?? null }, opts.households ?? { householdOf: () => null }, h.clock);
  return { ...h, wallet };
}

const group = (id: string, kind: 'money' | 'points', at: string, lines: PostingGroup['lines']): PostingGroup => ({ id, kind, occurredAt: new Date(at), refs: {}, lines, controls: [] });

describe('customer wallet: balance and points worth (domain §10, decisions §2)', () => {
  it('100 points = 1,000 IQD: 2,500 points are worth 25,000', () => {
    const { rules } = ledgerHarness();
    expect(rules.points.pointValueIqd).toBe(10);
    expect(pointsWorthIqd(100, rules)).toBe(1_000);
    expect(pointsWorthIqd(2_500, rules)).toBe(25_000);
    expect(pointsWorthIqd(0, rules)).toBe(0);
  });

  it('balance = customer account, points and their worth, pending under the own phone hash, household wallet', async () => {
    const h = walletHarness({ households: { householdOf: (id) => (id === 'c1' ? { id: 'org_9', name: 'بيت علي', role: 'payer' } : null) } });
    await h.ledger.recordAll([
      group('topup:1', 'money', '2026-10-01T10:00:00Z', [{ type: 'credit_issued', amount: 20_000, fromAccount: Accounts.bank, toAccount: Accounts.customer('c1'), memo: 'topup:agent' }]),
      group('pts:1', 'points', '2026-10-01T11:00:00Z', [{ type: 'points_earned', amount: 2_500, fromAccount: Accounts.pointsPool, toAccount: Accounts.points('c1') }]),
      group('pend:1', 'points', '2026-10-02T11:00:00Z', [{ type: 'points_pending', amount: 40, fromAccount: Accounts.pointsPool, toAccount: Accounts.pointsPending('hash_c1') }]),
      group('pend:other', 'points', '2026-10-02T11:00:00Z', [{ type: 'points_pending', amount: 99, fromAccount: Accounts.pointsPool, toAccount: Accounts.pointsPending('hash_c2') }]),
      group('hh:1', 'money', '2026-10-02T12:00:00Z', [{ type: 'credit_issued', amount: 50_000, fromAccount: Accounts.bank, toAccount: Accounts.household('org_9'), memo: 'topup:agent' }]),
    ]);
    const b = await h.wallet.balance(actor('c1'));
    expect(b).toMatchObject({
      moneyIqd: 20_000,
      points: 2_500,
      pointsWorthIqd: 25_000,
      pendingPoints: 40,
      pendingWorthIqd: 400,
      pointValueIqd: 10,
      household: { id: 'org_9', name: 'بيت علي', role: 'payer', balanceIqd: 50_000 },
    });
    expect(b.pendingExpiresAt?.toISOString()).toBe('2026-12-31T11:00:00.000Z');
    // Another person sees only his own accounts.
    const other = await h.wallet.balance(actor('c2'));
    expect(other).toMatchObject({ moneyIqd: 0, points: 0, pendingPoints: 0, household: null });
  });

  it('a cash order short of the total leaves a negative balance (you owe)', async () => {
    const h = walletHarness();
    const p = postOrderClosed(workedExample({ cashCollectedIqd: 16_000 }), h.rules);
    await h.ledger.recordAll(p.money);
    expect((await h.wallet.balance(actor('c1'))).moneyIqd).toBe(-500);
  });
});

describe('customer wallet: readable lines', () => {
  it('a cash order is one line (−16,500, cash), its extra cash a separate +500 change line; splits never show', async () => {
    const h = walletHarness();
    const p = postOrderClosed(workedExample({ cashCollectedIqd: 17_000 }), h.rules);
    await h.ledger.recordAll(p.money);
    const lines = moneyLines(Accounts.customer('c1'), (await h.ledger.eventsFor(Accounts.customer('c1'))) as LedgerEvent[]);
    expect(lines.map((l) => [l.kind, l.amount, l.method, l.title_ar, l.detail_ar])).toEqual([
      ['food', -16_500, 'cash', 'طلب أكل', 'كاش عند الاستلام'],
      ['cash_change', 500, null, 'الباقي رصيد', 'صار رصيد إلك'],
    ]);
    expect(lines[0]!.orderId).toBe('o1');
  });

  it('"الخردة علينا": the rest of a note the courier had no change for is its own "باقي الكاش" line, apart from the rounding change', async () => {
    const h = walletHarness();
    // 16,600 (a 100 tip) → 16,750 cash with 150 rounding change; he handed 20,000 and the courier had no change.
    const p = postOrderClosed(workedExample({ tipIqd: 100, cashCollectedIqd: 20_000, changeToWalletIqd: 3_250 }), h.rules);
    await h.ledger.recordAll(p.money);
    const lines = moneyLines(Accounts.customer('c1'), (await h.ledger.eventsFor(Accounts.customer('c1'))) as LedgerEvent[]);
    expect(lines.map((l) => [l.kind, l.amount, l.title_ar, l.detail_ar])).toEqual([
      ['food', -16_600, 'طلب أكل', 'كاش عند الاستلام'],
      ['cash_change', 150, 'الباقي رصيد', 'صار رصيد إلك'],
      ['change_to_wallet', 3_250, 'باقي الكاش', 'الدليفري ما عنده خردة، صارت رصيد إلك'],
    ]);
    expect((await h.wallet.balance(actor('c1'))).moneyIqd).toBe(3_400);
  });

  it('M-3: owed fees paid with an order\'s cash are their own «سددت الرسوم» line, never part of what the order cost', async () => {
    const h = walletHarness();
    // He owed 1,000 from a cancelled order and handed over 17,750: 16,500 order + 1,000 fees + 250 change.
    await h.ledger.recordAll(group('cancel:1', 'money', '2026-10-02T10:00:00Z', [{ type: 'cancellation_fee', amount: 1_000, fromAccount: Accounts.customer('c1'), toAccount: Accounts.merchantCash('m1') }]));
    const p = postOrderClosed(workedExample({ debtCollectIqd: 1_000, cashCollectedIqd: 17_750 }), h.rules);
    await h.ledger.recordAll(p.money);
    const lines = moneyLines(Accounts.customer('c1'), (await h.ledger.eventsFor(Accounts.customer('c1'))) as LedgerEvent[]).filter((l) => l.orderId === 'o1');
    expect(lines.map((l) => [l.kind, l.amount, l.title_ar, l.detail_ar])).toEqual([
      ['food', -16_500, 'طلب أكل', 'كاش عند الاستلام'],
      ['cash_change', 250, 'الباقي رصيد', 'صار رصيد إلك'],
      ['debt', 1_000, 'سددت الرسوم', 'رسوم إلغاء كانت عليك، دفعتها كاش ويا هالطلب'],
    ]);
    expect((await h.wallet.balance(actor('c1'))).moneyIqd).toBe(250);
  });

  it('the honest-delay credit says it was for the late order («تعويض التأخير · طلب #…»), fee back or free-delivery 1,000; other credits stay «رصيد مضاف»', async () => {
    const h = walletHarness();
    const late = (orderId: string, amount: number, at: string): PostingGroup => ({
      id: `late_promise:${orderId}`,
      kind: 'money',
      occurredAt: new Date(at),
      refs: { orderId },
      lines: [{ type: 'credit_issued', amount, fromAccount: Accounts.platform, toAccount: Accounts.customer('c1'), memo: LATE_PROMISE_MEMO }],
      controls: [],
    });
    await h.ledger.recordAll(group('goodwill:1', 'money', '2026-10-01T10:00:00Z', [{ type: 'credit_issued', amount: 2_000, fromAccount: Accounts.platform, toAccount: Accounts.customer('c1'), memo: 'support' }]));
    await h.ledger.recordAll(late('o7', 500, '2026-10-02T10:00:00Z'));
    await h.ledger.recordAll(late('o8', 1_000, '2026-10-03T10:00:00Z'));
    const lines = moneyLines(Accounts.customer('c1'), (await h.ledger.eventsFor(Accounts.customer('c1'))) as LedgerEvent[]);
    expect(lines.map((l) => [l.kind, l.amount, l.title_ar, l.detail_ar, l.title_en, l.detail_en, l.orderId ?? null])).toEqual([
      ['credit', 2_000, 'رصيد مضاف', null, 'Credit issued', null, null],
      ['late_credit', 500, 'تعويض التأخير', `طلب #${orderTicketNumber('o7')}`, 'Late delivery credit', `Order #${orderTicketNumber('o7')}`, 'o7'],
      ['late_credit', 1_000, 'تعويض التأخير', `طلب #${orderTicketNumber('o8')}`, 'Late delivery credit', `Order #${orderTicketNumber('o8')}`, 'o8'],
    ]);
  });

  it('M-15: a driver\'s cancel paid to the customer reads as credit; the customer\'s own cancel fee stays a penalty', async () => {
    const h = walletHarness();
    await h.ledger.recordAll(group('order:o1:driver_cancel:t1', 'money', '2026-10-02T10:00:00Z', [{ type: 'cancellation_fee', amount: 500, fromAccount: Accounts.driver('d1'), toAccount: Accounts.customer('c1'), memo: 'driver_cancel' }]));
    await h.ledger.recordAll(group('order:o2:cancel', 'money', '2026-10-03T10:00:00Z', [{ type: 'cancellation_fee', amount: 500, fromAccount: Accounts.customer('c1'), toAccount: Accounts.driver('d1') }]));
    const lines = moneyLines(Accounts.customer('c1'), (await h.ledger.eventsFor(Accounts.customer('c1'))) as LedgerEvent[]);
    expect(lines.map((l) => [l.kind, l.amount])).toEqual([
      ['credit', 500],
      ['penalty', -500],
    ]);
  });

  it('M-17: a merchant\'s late-reject credit paid to the customer reads as credit', async () => {
    const h = walletHarness();
    await h.ledger.recordAll(group('order:o3:merchant_late_reject', 'money', '2026-10-02T10:00:00Z', [{ type: 'cancellation_fee', amount: 500, fromAccount: Accounts.merchantCash('m1'), toAccount: Accounts.customer('c1'), memo: 'merchant_late_reject' }]));
    const lines = moneyLines(Accounts.customer('c1'), (await h.ledger.eventsFor(Accounts.customer('c1'))) as LedgerEvent[]);
    expect(lines.map((l) => [l.kind, l.amount])).toEqual([['credit', 500]]);
  });

  it('M-11: a الرجعة driver who never came (or cancelled late) pays the rider a credit that says why', async () => {
    const h = walletHarness();
    await h.ledger.recordAll(group('departure:dep1:cancel', 'money', '2026-10-02T10:00:00Z', [{ type: 'departure_cancel_fee', amount: 2_000, fromAccount: Accounts.driver('d1'), toAccount: Accounts.customer('c1') }]));
    const lines = moneyLines(Accounts.customer('c1'), (await h.ledger.eventsFor(Accounts.customer('c1'))) as LedgerEvent[]);
    expect(lines.map((l) => [l.kind, l.amount, l.title_ar, l.title_en])).toEqual([['credit', 2_000, 'تعويض: السايق ما طلع بالرحلة', "Credit: your driver didn't make the trip"]]);
  });

  it('a wallet-paid order and a top-up read as purchase and top-up; points lines carry points', async () => {
    const h = walletHarness();
    await h.ledger.recordAll(group('topup:1', 'money', '2026-10-01T09:00:00Z', [{ type: 'credit_issued', amount: 20_000, fromAccount: Accounts.bank, toAccount: Accounts.customer('c1'), memo: 'topup:agent' }]));
    const p = postOrderClosed(workedExample({ orderId: 'o2', payment: 'wallet', occurredAt: new Date('2026-10-02T09:00:00Z') }), h.rules);
    await h.ledger.recordAll(p.money);
    const pts = postPoints({ groupId: 'order:o2:points', occurredAt: new Date('2026-10-02T09:00:00Z'), refs: { orderId: 'o2' }, points: 27, ordererId: 'c1', recipients: [], rules: h.rules });
    await h.ledger.recordAll(pts!);
    const view = await h.wallet.transactions(actor('c1'), { limit: 30 });
    expect(view.lines.map((l) => [l.book, l.kind, l.amount, l.unit, l.method])).toEqual([
      ['money', 'food', -16_500, 'iqd', 'wallet'],
      ['points', 'points', 27, 'points', null],
      ['money', 'topup', 20_000, 'iqd', null],
    ]);
    expect(view.lines[0]!.detail_ar).toBe('من رصيدك');
    expect(view.lines[1]!.title_ar).toBe('نقاط مكتسبة');
    expect(view.lines[2]!.title_ar).toBe('شحن رصيد');
    expect(view.nextBefore).toBeNull();
    expect((await h.wallet.balance(actor('c1'))).moneyIqd).toBe(3_500);
  });

  it('pages newest first without splitting a timestamp', () => {
    const at = (iso: string) => new Date(iso);
    const mk = (id: string, iso: string) => ({ id, occurredAt: at(iso), book: 'money' as const, kind: 'credit' as const, title_ar: '', title_en: '', detail_ar: null, detail_en: null, amount: 1, unit: 'iqd' as const, method: null });
    const lines = [mk('a', '2026-10-01T00:00:00Z'), mk('b', '2026-10-02T00:00:00Z'), mk('c', '2026-10-02T00:00:00Z'), mk('d', '2026-10-03T00:00:00Z')];
    const p1 = pageLines(lines, 2);
    expect(p1.lines.map((l) => l.id)).toEqual(['d', 'c', 'b']);
    expect(p1.nextBefore?.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    const p2 = pageLines(lines, 2, p1.nextBefore!);
    expect(p2.lines.map((l) => l.id)).toEqual(['a']);
    expect(p2.nextBefore).toBeNull();
  });
});

describe('customer wallet: pending points (domain §3, §10)', () => {
  it('only pending credits younger than 90 days are claimable', () => {
    const acc = Accounts.pointsPending('h');
    const ev = (id: string, amount: number, iso: string, out = false) =>
      ({ id, kind: 'points', type: out ? 'points_claimed' : 'points_pending', amount, fromAccount: out ? acc : Accounts.pointsPool, toAccount: out ? 'points:x' : acc, occurredAt: new Date(iso) }) as unknown as LedgerEvent;
    const now = new Date('2026-10-03T00:00:00Z');
    expect(claimablePending(acc, [ev('1', 30, '2026-06-01T00:00:00Z'), ev('2', 20, '2026-09-01T00:00:00Z')], now)).toEqual({ points: 20, expiresAt: new Date('2026-11-30T00:00:00Z') });
    expect(claimablePending(acc, [ev('1', 30, '2026-09-01T00:00:00Z'), ev('2', 30, '2026-09-02T00:00:00Z', true)], now)).toEqual({ points: 0, expiresAt: null });
  });

  it('claimPoints moves own pending points into points once (points_claimed), never another number’s', async () => {
    const h = walletHarness({ hashes: { c1: 'hash_c1', c2: 'hash_c2' } });
    await h.ledger.recordAll(group('pend:1', 'points', '2026-10-02T11:00:00Z', [{ type: 'points_pending', amount: 40, fromAccount: Accounts.pointsPool, toAccount: Accounts.pointsPending('hash_c1') }]));
    expect(await h.wallet.claimPoints(actor('c2'))).toEqual({ claimed: 0, points: 0 });
    expect(await h.wallet.claimPoints(actor('c1'))).toEqual({ claimed: 40, points: 40 });
    expect(await h.wallet.claimPoints(actor('c1'))).toEqual({ claimed: 0, points: 40 });
    const b = await h.wallet.balance(actor('c1'));
    expect(b).toMatchObject({ points: 40, pointsWorthIqd: 400, pendingPoints: 0 });
    const inv = await h.ledger.checkInvariant();
    expect(inv.points.ok).toBe(true);
    const lines = (await h.wallet.transactions(actor('c1'), { limit: 10 })).lines;
    expect(lines.map((l) => [l.title_ar, l.amount])).toEqual([['نقاط مستلمة', 40]]);
  });

  it('topupOptions (FLOW-24, THIN-11): no placeholder agents; the courier bringing the order; ZainCash soon', async () => {
    const h = walletHarness();
    const t = await h.wallet.topupOptions(actor('c1'));
    expect(t.placeholder).toBe(false);
    expect(t.channels.map((c) => [c.id, c.available])).toEqual([
      ['agent', false],
      ['driver', true],
      ['zaincash', false],
    ]);
    expect(t.agents).toEqual([]);
    expect(t.channels.find((c) => c.id === 'driver')!.body_ar).toContain('اللي جايب طلبك');
    expect(t.channels.find((c) => c.id === 'driver')!.title_ar).not.toContain('السايق');
  });

  it('topupOptions lists signed agents from TOPUP_AGENTS_JSON only (unknown zones and broken rows dropped)', async () => {
    const env = {
      TOPUP_AGENTS_JSON: JSON.stringify([
        { id: 'ag_1', zoneId: 'centre', name_ar: 'مكتب أبو علي', name_en: 'Abu Ali office', hours_ar: 'كل يوم 9 – 9', hours_en: 'Daily 9–9' },
        { id: 'ag_2', zoneId: 'nowhere', name_ar: 'x', name_en: 'x', hours_ar: 'x', hours_en: 'x' },
        { id: 'ag_3' },
      ]),
    };
    expect(topupAgentsFromEnv(env).map((a) => a.id)).toEqual(['ag_1']);
    expect(topupAgentsFromEnv({ TOPUP_AGENTS_JSON: 'not json' })).toEqual([]);
    const h = walletHarness();
    const wallet = new CustomerWalletService(h.ledger, h.rules, { phoneHashOf: async () => null }, { householdOf: () => null }, h.clock, topupAgentsFromEnv(env));
    const t = await wallet.topupOptions(actor('c1'));
    expect(t.channels.find((c) => c.id === 'agent')!.available).toBe(true);
    expect(t.agents).toEqual([expect.objectContaining({ id: 'ag_1', zoneId: 'centre', pin: expect.any(Object) })]);
    expect(t.agents.every((a) => !/[٠-٩]/.test(a.zoneName_ar))).toBe(true);
  });
});
