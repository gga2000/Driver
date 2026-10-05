import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, DriverError, type OrderMoneyPayload, type RideMoneyPayload } from '@driver/contracts';
import { Accounts } from '../ledger/accounts.js';
import { postOrderClosed, postRideCompleted } from '../ledger/postings.js';
import { ledgerHarness } from '../ledger/test-harness.js';
import { HOME, KITCHEN, ordersHarness } from './test-harness.js';

/**
 * "الخردة علينا" (Phase 3, 2026-10-05): the customer's stated note at checkout, and the courier with
 * no change putting the rest of the note into the customer's wallet — checked on the server,
 * idempotent, and booked as its own balanced ledger line.
 */
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

function nets(lines: ReadonlyArray<{ amount: number; fromAccount: string; toAccount: string }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) {
    m.set(l.toAccount, (m.get(l.toAccount) ?? 0) + l.amount);
    m.set(l.fromAccount, (m.get(l.fromAccount) ?? 0) - l.amount);
  }
  return m;
}

/** A 16,500 cash order (15,000 items + 1,000 delivery + 500 service), carried to the door. */
async function atTheDoor(over: Parameters<ReturnType<typeof ordersHarness>['foodInput']>[0] = {}) {
  const h = ordersHarness();
  const o = await h.orders.place('c1', h.foodInput(over));
  await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
  const t = await h.tripFor(o.id);
  await h.pickup(t.id);
  const drop = (await h.trips.get(t.id)).stops.find((s) => s.type === 'dropoff')!;
  await h.trips.arrive(t.id, drop.id, 'd1', { pin: HOME });
  return { h, o, t, drop };
}

describe('"راح أدفع بـ …" — the stated note at checkout', () => {
  it('is stored on a cash order and shown to the courier at the drop-off', async () => {
    const { h, o, t } = await atTheDoor({ statedTenderIqd: 25_000 });
    expect(o).toMatchObject({ totalIqd: 16_500, statedTenderIqd: 25_000, changeToWalletIqd: null });
    expect((await h.orders.get(o.id)).statedTenderIqd).toBe(25_000);
    expect((await h.trips.get(t.id)).stops.length).toBeGreaterThan(0);
  });

  it('is refused below the total, too far above it, off the 250 step, or on a wallet order', async () => {
    const h = ordersHarness();
    expect(await code(h.orders.place('c1', h.foodInput({ statedTenderIqd: 15_000 })))).toBe('tender_invalid');
    expect(await code(h.orders.place('c1', h.foodInput({ statedTenderIqd: 70_000 })))).toBe('tender_invalid');
    expect(await code(h.orders.place('c1', h.foodInput({ statedTenderIqd: 20_100 })))).toBe('tender_invalid');
    h.wallets.set('customer:c1', 100_000);
    expect(await code(h.orders.place('c1', h.foodInput({ paymentMethod: 'wallet', statedTenderIqd: 20_000 })))).toBe('tender_invalid');
    expect((await h.orders.place('c1', h.foodInput({ statedTenderIqd: 16_500 }))).statedTenderIqd).toBe(16_500);
    expect((await h.orders.place('c1', h.foodInput({ statedTenderIqd: 66_500 }))).statedTenderIqd).toBe(66_500);
    expect((await h.orders.place('c1', h.foodInput())).statedTenderIqd).toBeNull();
  });

  it('keeps the checkout idempotent: a retry with the same key returns the same order and note', async () => {
    const h = ordersHarness();
    const input = h.foodInput({ statedTenderIqd: 20_000, clientRequestId: 'checkout-attempt-1' });
    const first = await h.orders.place('c1', input);
    const again = await h.orders.place('c1', input);
    expect(again.id).toBe(first.id);
    expect(again.statedTenderIqd).toBe(20_000);
    expect(h.events.types().filter((x) => x === 'order.placed')).toHaveLength(1);
  });
});

describe('"ما عندي خردة · حطها رصيد بمحفظته" — change to the wallet at the door', () => {
  it('records the whole note, credits the rest as its own line, and tells the customer', async () => {
    const { h, o, t } = await atTheDoor({ statedTenderIqd: 25_000 });
    await h.dropoff(t.id, { cashCollectedIqd: 25_000, changeToWalletIqd: 8_500 });
    const after = await h.orders.get(o.id);
    expect(after).toMatchObject({ state: 'delivered', changeToWalletIqd: 8_500 });
    expect(h.events.last('order.cash_collected')!.payload).toMatchObject({ amountIqd: 25_000, expectedIqd: 16_500, changeToWalletIqd: 8_500, order: { cashCollectedIqd: 25_000, changeToWalletIqd: 8_500 } });
    expect(h.events.last('order.change_to_wallet')!.payload).toMatchObject({ customerId: 'c1', courierId: 'd1', amountIqd: 8_500, collectedIqd: 25_000, totalIqd: 16_500 });

    // The ledger: balanced, the courier holds the whole note, the customer gets exactly the extra.
    const fact = h.events.last('order.cash_collected')!.payload['order'] as OrderMoneyPayload;
    const posted = postOrderClosed(fact, AZIZIYAH_MONEY_RULES);
    const n = nets(posted.money.lines);
    expect([...n.values()].reduce((a, b) => a + b, 0)).toBe(0);
    expect(n.get(Accounts.cash('d1'))).toBe(-25_000);
    expect(n.get(Accounts.customer('c1'))).toBe(8_500);
    expect(posted.money.lines.find((l) => l.type === 'cash_change_to_wallet')).toMatchObject({ amount: 8_500, fromAccount: 'cash:d1', toAccount: 'customer:c1', memo: 'no_change' });
    expect(posted.money.lines.some((l) => l.type === 'cash_rounding_credit')).toBe(false);

    // The real ledger accepts it (controls hold), and the close fact posts the same group (a no-op).
    const lh = ledgerHarness();
    await lh.ledger.recordAll(posted.money);
    expect((await lh.ledger.balance(Accounts.customer('c1'))).amount).toBe(8_500);
    expect((await lh.ledger.balance(Accounts.cash('d1'))).amount).toBe(-25_000);
    await h.advance(2 * 60 * 60_000);
    const closed = h.events.last('order.closed')!.payload['order'] as OrderMoneyPayload;
    expect(closed).toMatchObject({ cashCollectedIqd: 25_000, changeToWalletIqd: 8_500 });
    expect(postOrderClosed(closed, AZIZIYAH_MONEY_RULES).money.lines).toEqual(posted.money.lines);
    expect((await lh.ledger.recordAll(postOrderClosed(closed, AZIZIYAH_MONEY_RULES).money)).recorded).toHaveLength(0);
  });

  it('keeps the rounding change apart from the no-change credit', async () => {
    // A 100 tip: price 16,600 → 16,750 cash (150 rounding change); a 20,000 note leaves 3,250 for the wallet.
    const { h, t } = await atTheDoor({ tipIqd: 100 });
    await h.dropoff(t.id, { cashCollectedIqd: 20_000, changeToWalletIqd: 3_250 });
    const posted = postOrderClosed(h.events.last('order.cash_collected')!.payload['order'] as OrderMoneyPayload, AZIZIYAH_MONEY_RULES);
    expect(posted.money.lines.find((l) => l.type === 'cash_rounding_credit')).toMatchObject({ amount: 150 });
    expect(posted.money.lines.find((l) => l.type === 'cash_change_to_wallet')).toMatchObject({ amount: 3_250 });
    expect(nets(posted.money.lines).get(Accounts.customer('c1'))).toBe(3_400);
  });

  it('refuses a figure that is not collected − total, or cash above the total without it', async () => {
    const { h, t, drop, o } = await atTheDoor();
    expect(await code(h.trips.completeStop(t.id, drop.id, 'd1', { handover: { cashCollectedIqd: 25_000, changeToWalletIqd: 9_000 } }))).toBe('change_to_wallet_mismatch');
    expect(await code(h.trips.completeStop(t.id, drop.id, 'd1', { handover: { changeToWalletIqd: 8_500 } }))).toBe('change_to_wallet_mismatch');
    expect(await code(h.trips.completeStop(t.id, drop.id, 'd1', { handover: { cashCollectedIqd: 25_000 } }))).toBe('change_to_wallet_mismatch');
    // Nothing was recorded: the stop is still open and the order not delivered.
    expect((await h.trips.get(t.id)).stops.find((s) => s.id === drop.id)!.state).toBe('arrived');
    expect((await h.orders.get(o.id)).state).toBe('picked_up');
  });

  it('refuses more than the cap (25,000): the courier hands that back in cash', async () => {
    const { h, t, drop } = await atTheDoor();
    expect(await code(h.trips.completeStop(t.id, drop.id, 'd1', { handover: { cashCollectedIqd: 50_000, changeToWalletIqd: 33_500 } }))).toBe('change_to_wallet_above_cap');
    // At the cap exactly it goes through.
    await h.dropoff(t.id, { cashCollectedIqd: 41_500, changeToWalletIqd: 25_000 });
    expect(h.events.last('order.change_to_wallet')!.payload).toMatchObject({ amountIqd: 25_000 });
  });

  it('refuses it on a wallet-paid order', async () => {
    const h = ordersHarness();
    h.wallets.set('customer:c1', 100_000);
    const o = await h.orders.place('c1', h.foodInput({ paymentMethod: 'wallet' }));
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    const drop = (await h.trips.get(t.id)).stops.find((s) => s.type === 'dropoff')!;
    await h.trips.arrive(t.id, drop.id, 'd1', { pin: HOME });
    expect(await code(h.trips.completeStop(t.id, drop.id, 'd1', { handover: { cashCollectedIqd: 20_000, changeToWalletIqd: 3_500 } }))).toBe('change_to_wallet_not_cash');
    // And the ledger itself never books one on a wallet payment.
    expect(() => postOrderClosed({ orderId: o.id, orderType: 'food', occurredAt: new Date(), customerId: 'c1', payment: 'wallet', merchantId: 'm1', courierId: 'd1', itemsSubtotalIqd: 15_000, commissionTier: 'featured', changeToWalletIqd: 3_500 } as OrderMoneyPayload, AZIZIYAH_MONEY_RULES)).toThrow(RangeError);
  });

  it('is idempotent: a retried hand-over adds no event, no second credit', async () => {
    const { h, t, drop } = await atTheDoor({ statedTenderIqd: 20_000 });
    const handover = { cashCollectedIqd: 20_000, changeToWalletIqd: 3_500 };
    await h.trips.completeStop(t.id, drop.id, 'd1', { handover, idempotencyKey: 'k-drop' });
    await h.deliver();
    const credits = () => h.events.types().filter((x) => x === 'order.change_to_wallet').length;
    expect(credits()).toBe(1);
    await h.trips.completeStop(t.id, drop.id, 'd1', { handover, idempotencyKey: 'k-drop' });
    await h.trips.completeStop(t.id, drop.id, 'd1', { handover });
    await h.deliver();
    expect(credits()).toBe(1);
    expect(h.events.types().filter((x) => x === 'order.cash_collected')).toHaveLength(1);
  });

  it('works the same on a cash ride (taxi): the whole note on the driver, the rest in the wallet', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', { cityId: 'aziziyah', type: 'ride', fareIqd: 3000, pickup: { zoneKey: 'centre', pin: KITCHEN }, dropoff: { zoneKey: 'street_30', pin: HOME } });
    const t = await h.tripFor(o.id, { vertical: 'taxi', vehicleClass: 'car' });
    await h.pickup(t.id);
    await h.dropoff(t.id, { cashCollectedIqd: 5_000, changeToWalletIqd: 2_000 });
    expect(await h.orders.get(o.id)).toMatchObject({ state: 'completed', changeToWalletIqd: 2_000 });
    const fact = h.events.last('order.cash_collected')!.payload['ride'] as RideMoneyPayload;
    const posted = postRideCompleted(fact, AZIZIYAH_MONEY_RULES);
    const n = nets(posted.money.lines);
    expect(n.get(Accounts.cash('d1'))).toBe(-5_000);
    expect(n.get(Accounts.customer('c1'))).toBe(2_000);
    expect(posted.money.lines.find((l) => l.type === 'cash_change_to_wallet')).toMatchObject({ amount: 2_000 });
  });
});
