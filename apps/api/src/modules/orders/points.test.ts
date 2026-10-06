import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, DriverError, type OrderMoneyPayload } from '@driver/contracts';
import { postOrderClosed } from '../ledger/postings.js';
import { HOME, ordersHarness } from './test-harness.js';

/**
 * W-02 / J-D10 (Ali, 2026-10-05): «استخدم نقاطك» at checkout. The server decides how many points an
 * order takes (the customer's free balance, capped by delivery + service fee and by the price), takes
 * them off the delivery fee first, then the service fee, and the ledger posts the same at close.
 * Worked basket: items 15,000 + delivery 1,000 + service 500 = 16,500.
 */
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

function withPoints(points: number) {
  const h = ordersHarness();
  h.wallets.set('points:c1', points);
  return h;
}

describe('points at checkout (W-02, J-D10)', () => {
  it('orders.quote offers the points without spending them; with usePoints the total drops', async () => {
    const h = withPoints(400);
    const offer = await h.orders.quote('c1', h.foodInput());
    expect(offer).toMatchObject({ points: { balance: 400, usable: 150, valueIqd: 1_500 }, pointsIqd: 0, totalIqd: 16_500 });
    const used = await h.orders.quote('c1', h.foodInput({ usePoints: true }));
    expect(used).toMatchObject({ pointsIqd: 1_500, totalIqd: 15_000 });
  });

  it('a small balance is used whole, off the delivery fee first', async () => {
    const h = withPoints(40);
    const q = await h.orders.quote('c1', h.foodInput({ usePoints: true }));
    expect(q).toMatchObject({ points: { balance: 40, usable: 40, valueIqd: 400 }, pointsIqd: 400, totalIqd: 16_250 });
  });

  it('no points, no offer', async () => {
    const h = withPoints(0);
    expect((await h.orders.quote('c1', h.foodInput())).points).toBeNull();
    expect((await h.orders.place('c1', h.foodInput({ usePoints: true }))).pointsRedeemed).toBe(0);
  });

  it('orders.place spends them, holds them against a second open order, and checks the expectation', async () => {
    const h = withPoints(400);
    const o = await h.orders.place('c1', h.foodInput({ usePoints: true, pointsIqd: 1_500 }));
    expect(o).toMatchObject({ pointsRedeemed: 150, pointsIqd: 1_500, totalIqd: 15_000 });
    // The first order holds 150 until it closes: 250 are free for the next one.
    expect((await h.orders.quote('c1', h.foodInput())).points).toMatchObject({ balance: 250, usable: 150 });
    // The checkout showed 1,500 but only 250 points are left on a basket that can take 150 — same figure, fine;
    // a figure the server does not agree with is a refresh.
    expect(await code(h.orders.place('c1', h.foodInput({ usePoints: true, pointsIqd: 900 })))).toBe('price_changed');
    // Without the switch nothing is spent.
    expect((await h.orders.place('c1', h.foodInput())).pointsRedeemed).toBe(0);
  });

  it('a free-delivery deal leaves only the service fee for points', async () => {
    const h = withPoints(400);
    await h.promotions.addDeal({ type: 'free_delivery', minOrderIqd: 0 });
    const q = await h.orders.quote('c1', h.foodInput({ usePoints: true }));
    expect(q).toMatchObject({ discountIqd: 1_000, points: { usable: 50, valueIqd: 500 }, pointsIqd: 500, totalIqd: 15_000 });
  });

  it('a wallet order pays the exact price after points', async () => {
    const h = withPoints(120);
    h.wallets.set('customer:c1', 50_000);
    const o = await h.orders.place('c1', h.foodInput({ usePoints: true, paymentMethod: 'wallet' }));
    expect(o).toMatchObject({ pointsRedeemed: 120, pointsIqd: 1_200, totalIqd: 15_300 });
  });

  it('the ledger posts the same redemption when the order closes', async () => {
    const h = withPoints(400);
    const o = await h.orders.place('c1', h.foodInput({ usePoints: true }));
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    const drop = (await h.trips.get(t.id)).stops.find((s) => s.type === 'dropoff')!;
    await h.trips.arrive(t.id, drop.id, 'd1', { pin: HOME });
    await h.dropoff(t.id, { cashCollectedIqd: 15_000 });
    await h.advance(2 * 60 * 60_000);
    const fact = h.events.last('order.closed')!.payload['order'] as OrderMoneyPayload;
    expect(fact).toMatchObject({ pointsRedeemed: 150 });
    const posted = postOrderClosed(fact, AZIZIYAH_MONEY_RULES);
    expect(posted.totalIqd).toBe(15_000);
    expect(posted.money.lines.filter((l) => l.memo?.startsWith('points:')).map((l) => [l.memo, l.amount])).toEqual([
      ['points:delivery_fee', 1_000],
      ['points:service_fee', 500],
    ]);
    expect(posted.redeem?.lines[0]?.amount).toBe(150);
    // Closed: the points are the ledger's now, no longer held by the order.
    h.wallets.set('points:c1', 250);
    expect((await h.orders.quote('c1', h.foodInput())).points).toMatchObject({ balance: 250 });
  });
});
