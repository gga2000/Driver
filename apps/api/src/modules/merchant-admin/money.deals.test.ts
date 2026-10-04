import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, type Order } from '@driver/contracts';
import { Accounts } from '../ledger/accounts.js';
import { postOrderClosed } from '../ledger/postings.js';
import { ledgerHarness, workedExample } from '../ledger/test-harness.js';
import { composeMoneyToday, composeStatement } from './money.js';

const order = (id: string, over: Partial<Order> = {}) => [id, { id, paymentMethod: 'cash', state: 'closed', discountIqd: 0, discount: null, ...over } as unknown as Order] as const;

describe('merchant money with its own deals (G-87)', () => {
  it('money.today: dealsIqd is what the merchant’s deals cost; commission base is items after an items deal', async () => {
    const h = ledgerHarness();
    // 15,000 at the featured 15 % tier: a 3,000 items deal, a 1,000 free delivery, and a plain order.
    const a = workedExample({ orderId: 'oa', merchantDeal: { promotionId: 'deal_1', target: 'items', amountIqd: 3000 } });
    const b = workedExample({ orderId: 'ob', merchantDeal: { promotionId: 'deal_2', target: 'delivery', amountIqd: 1000 } });
    const c = workedExample({ orderId: 'oc' });
    await h.ledger.recordAll([a, b, c].map((f) => postOrderClosed(f, AZIZIYAH_MONEY_RULES).money));
    const statement = await h.ledger.statement(Accounts.merchantCash('m1'));
    const orders = new Map([
      order('oa', { discountIqd: 3000, discount: { promotionId: 'deal_1', funder: 'merchant', target: 'items', type: 'percent', label_ar: 'خصم', label_en: 'off', amountIqd: 3000 } }),
      order('ob', { discountIqd: 1000, discount: { promotionId: 'deal_2', funder: 'merchant', target: 'delivery', type: 'free_delivery', label_ar: 'توصيل', label_en: 'free', amountIqd: 1000 } }),
      order('oc'),
    ]);
    const balance = await h.merchantCash.balance('m1');
    const today = composeMoneyToday({ merchantOrgId: 'm1', localDate: '2026-10-03', statement, orders, balance, rules: AZIZIYAH_MONEY_RULES });
    // Commission: 15 % of 12,000 + 15 % of 15,000 × 2 = 1,800 + 2,250 + 2,250.
    expect(today).toMatchObject({ orders: 3, salesIqd: 45000, commissionIqd: 6300, dealsIqd: 4000, netIqd: 45000 - 6300 - 4000 });
    expect(today.commissionByTier).toEqual([{ tier: 'featured', pct: 15, baseIqd: 42000, commissionIqd: 6300, orders: 3 }]);
    expect(today.netIqd).toBe(statement.closingIqd);

    const week = composeStatement({ merchantOrgId: 'm1', from: new Date('2026-09-27T21:00:00Z'), to: new Date('2026-10-04T21:00:00Z'), statement, orders });
    expect(week.lines.map((l) => [l.orderId, l.itemsIqd, l.discountIqd, l.discountFunder, l.commissionIqd, l.netIqd])).toEqual([
      ['oa', 15000, 3000, 'merchant', 1800, 10200],
      ['ob', 15000, 1000, 'merchant', 2250, 11750],
      ['oc', 15000, 0, null, 2250, 12750],
    ]);
  });

  it('statement: a rounded deal shows the exact deal and the rounding given back; the net is the ledger cost', async () => {
    const h = ledgerHarness();
    // 15 % of 15,000 = 2,250 promised; the total rounded up to the 500 step, so the deal cost 2,000.
    await h.ledger.recordAll(postOrderClosed(workedExample({ orderId: 'or', merchantDeal: { promotionId: 'deal_1', target: 'items', amountIqd: 2000 } }), AZIZIYAH_MONEY_RULES).money);
    const statement = await h.ledger.statement(Accounts.merchantCash('m1'));
    const orders = new Map([order('or', { discountIqd: 2000, discount: { promotionId: 'deal_1', funder: 'merchant', target: 'items', type: 'percent', label_ar: 'خصم', label_en: 'off', amountIqd: 2000, dealIqd: 2250, roundingIqd: 250 } })]);
    const week = composeStatement({ merchantOrgId: 'm1', from: new Date('2026-09-27T21:00:00Z'), to: new Date('2026-10-04T21:00:00Z'), statement, orders });
    expect(week.lines[0]).toMatchObject({ discountIqd: 2000, dealIqd: 2250, roundingIqd: 250, discountFunder: 'merchant', netIqd: 15000 - 2000 - 1950 });
  });

  it('a platform promo is shown for information and does not lower the merchant net', async () => {
    const h = ledgerHarness();
    await h.ledger.recordAll(postOrderClosed(workedExample({ orderId: 'op', platformPromo: { promotionId: 'promo_launch', amountIqd: 1000 } }), AZIZIYAH_MONEY_RULES).money);
    const statement = await h.ledger.statement(Accounts.merchantCash('m1'));
    const orders = new Map([order('op', { discountIqd: 1000, discount: { promotionId: 'promo_launch', funder: 'platform', target: 'order', type: null, label_ar: 'خصم', label_en: 'off', amountIqd: 1000 } })]);
    const today = composeMoneyToday({ merchantOrgId: 'm1', localDate: '2026-10-03', statement, orders, balance: await h.merchantCash.balance('m1'), rules: AZIZIYAH_MONEY_RULES });
    expect(today).toMatchObject({ dealsIqd: 0, netIqd: 12750 });
    const week = composeStatement({ merchantOrgId: 'm1', from: new Date('2026-09-27T21:00:00Z'), to: new Date('2026-10-04T21:00:00Z'), statement, orders });
    expect(week.lines[0]).toMatchObject({ discountIqd: 1000, discountFunder: 'platform', netIqd: 12750 });
  });
});
