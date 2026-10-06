import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, type OrderMoneyPayload } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { Accounts } from '../ledger/accounts.js';
import { ledgerHarness } from '../ledger/test-harness.js';
import { InMemoryReferralsRepository, ReferralsService } from '../referrals/index.js';
import { HOME, ordersHarness } from './test-harness.js';

/**
 * Invite as a gift (joy g2): the referral rule was in the ledger (decisions §1) but no closed order
 * ever named the inviter, so it could never pay. The orders module now sends `referredBy`; the
 * ledger's own rule decides: 200 points each once the friend's 2nd cash order of ≥ 10,000 closes.
 */
describe('the closed order names the inviter, and the existing rule pays', () => {
  async function closedFact(h: ReturnType<typeof ordersHarness>, customerId: string): Promise<OrderMoneyPayload> {
    const o = await h.orders.place(customerId, h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    const drop = (await h.trips.get(t.id)).stops.find((s) => s.type === 'dropoff')!;
    await h.trips.arrive(t.id, drop.id, 'd1', { pin: HOME });
    await h.dropoff(t.id, { cashCollectedIqd: o.totalIqd });
    await h.advance(2 * 60 * 60_000);
    return h.events.last('order.closed')!.payload['order'] as OrderMoneyPayload;
  }

  it('sends referredBy for an invited friend only; two qualifying cash orders unlock 200 points each', async () => {
    const h = ordersHarness();
    const referrals = new ReferralsService(new InMemoryReferralsRepository(), { firstNamesFor: async () => ({}) }, { eventsFor: async () => [] }, AZIZIYAH_MONEY_RULES, () => 0, new FakeClock());
    referrals.bindOrders({ placedCount: (id) => h.orders.placedCount(id) });
    h.orders.bindReferrals({ referrerOf: (id) => referrals.referrerOf(id) });

    const { code } = await referrals.mine({ personId: 'ali', sessionId: 's' });
    await referrals.claim({ personId: 'zaid', sessionId: 's' }, { code });

    const lh = ledgerHarness();
    const first = await closedFact(h, 'zaid');
    expect(first.referredBy).toBe('ali');
    expect(first.itemsSubtotalIqd).toBeGreaterThanOrEqual(10_000);
    await lh.posting.orderClosed(first);
    expect((await lh.ledger.balance(Accounts.points('ali'))).amount).toBe(0);

    await lh.posting.orderClosed(await closedFact(h, 'zaid'));
    const bonus = async (id: string) => (await lh.ledger.eventsFor(Accounts.points(id))).filter((e) => e.type === 'referral_bonus').reduce((a, e) => a + e.amount, 0);
    expect(await bonus('ali')).toBe(200);
    expect(await bonus('zaid')).toBe(200);

    const stranger = await closedFact(h, 'sara');
    expect(stranger.referredBy).toBeUndefined();
  });

  it('a person who already ordered cannot accept an invitation', async () => {
    const h = ordersHarness();
    const referrals = new ReferralsService(new InMemoryReferralsRepository(), { firstNamesFor: async () => ({}) }, { eventsFor: async () => [] }, AZIZIYAH_MONEY_RULES, () => 0, new FakeClock());
    referrals.bindOrders({ placedCount: (id) => h.orders.placedCount(id) });
    await h.orders.place('old', h.foodInput());
    const { code } = await referrals.mine({ personId: 'ali', sessionId: 's' });
    await expect(referrals.claim({ personId: 'old', sessionId: 's' }, { code })).rejects.toMatchObject({ code: 'invite_not_new' });
  });
});
