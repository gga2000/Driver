import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, type Order } from '@driver/contracts';
import { Accounts } from '../ledger/accounts.js';
import { postOrderClosed } from '../ledger/postings.js';
import { ledgerHarness, workedExample } from '../ledger/test-harness.js';
import { composeMoneyToday, composeStatement } from './money.js';

const order = (id: string) => [id, { id, paymentMethod: 'cash', state: 'closed', discountIqd: 0, discount: null } as unknown as Order] as const;

describe('merchant money with a cart («عربانة») walk-over ticket', () => {
  it('the ticket’s pickup commission shows as its own row, in the commission and the net, not as an order', async () => {
    const h = ledgerHarness();
    await h.ledger.recordAll(postOrderClosed(workedExample({ orderId: 'oa' }), AZIZIYAH_MONEY_RULES).money);
    await h.posting.foodCartWalkup({ walkupId: 'w1', cartId: 'cart1', merchantOrgId: 'm1', occurredAt: new Date('2026-10-03T13:00:00Z'), totalIqd: 10000, commissionIqd: 500 });
    const statement = await h.ledger.statement(Accounts.merchantCash('m1'));
    const orders = new Map([order('oa')]);

    const week = composeStatement({ merchantOrgId: 'm1', from: new Date('2026-09-27T21:00:00Z'), to: new Date('2026-10-04T21:00:00Z'), statement, orders });
    expect(week.lines.map((l) => [l.orderId, l.walkup ?? false, l.itemsIqd, l.commissionTier, l.commissionPct, l.commissionIqd, l.netIqd])).toEqual([
      ['oa', false, 15000, 'featured', 15, 2250, 12750],
      ['w1', true, 0, 'pickup', 5, 500, -500],
    ]);
    expect(week.totals).toMatchObject({ orders: 1, itemsIqd: 15000, commissionIqd: 2750, netIqd: 12250, adjustmentsIqd: 0 });
    expect(week.closingIqd).toBe(12250);

    const today = composeMoneyToday({ merchantOrgId: 'm1', localDate: '2026-10-03', statement, orders, balance: await h.merchantCash.balance('m1'), rules: AZIZIYAH_MONEY_RULES });
    expect(today).toMatchObject({ orders: 1, salesIqd: 15000, commissionIqd: 2750, netIqd: 12250 });
    expect(today.netIqd).toBe(statement.closingIqd);
    // The tier breakdown is of orders (their base is in the ledger); the ticket's base is not.
    expect(today.commissionByTier).toEqual([{ tier: 'featured', pct: 15, baseIqd: 15000, commissionIqd: 2250, orders: 1 }]);
  });
});
