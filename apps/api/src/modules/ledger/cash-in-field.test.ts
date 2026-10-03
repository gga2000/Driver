import { describe, expect, it } from 'vitest';
import { ledgerHarness, workedExample } from './test-harness.js';

describe('LedgerService.cashInField (Console right-now bar)', () => {
  it('is zero on an empty book', async () => {
    expect(await ledgerHarness().ledger.cashInField()).toEqual({ totalIqd: 0, holders: [] });
  });

  it('sums the cash every courier holds, largest first, and drops it when he hands it over', async () => {
    const h = ledgerHarness();
    await h.posting.orderMoney(workedExample({ orderId: 'o1', courierId: 'k1' }));
    await h.posting.orderMoney(workedExample({ orderId: 'o2', courierId: 'k1' }));
    await h.posting.orderMoney(workedExample({ orderId: 'o3', courierId: 'k2' }));
    // Wallet orders put no cash in anyone's hands.
    await h.posting.orderMoney(workedExample({ orderId: 'o4', courierId: 'k3', payment: 'wallet' }));

    const k1 = (await h.caps.status('k1')).cashIqd;
    const k2 = (await h.caps.status('k2')).cashIqd;
    expect(k1).toBeLessThan(0);
    const field = await h.ledger.cashInField();
    expect(field.holders).toEqual([
      { driverId: 'k1', amountIqd: -k1 },
      { driverId: 'k2', amountIqd: -k2 },
    ]);
    expect(field.totalIqd).toBe(-k1 - k2);
  });
});
