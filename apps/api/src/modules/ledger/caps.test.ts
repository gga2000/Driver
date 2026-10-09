import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES as rules } from '@driver/contracts';
import { CapsService, IdentityScoringCapProfiles, canOfferJob, capFor, capRoleOf, isOverCapAmount, newCustomerCashDecision, owedOf, payoutDue } from './caps.js';
import { postMerchantPaidByCourier, postRideCompleted, postSettlement } from './postings.js';
import { ledgerHarness, workedExample } from './test-harness.js';

const at = new Date('2026-10-03T12:00:00Z');

describe('caps by role (G-80)', () => {
  it('city roles 75k / 150k / 300k by tier; intercity drivers 300k', () => {
    expect(capFor('courier', 'bronze', rules)).toBe(75000);
    expect(capFor('courier', 'silver', rules)).toBe(150000);
    expect(capFor('driver', 'gold', rules)).toBe(300000);
    expect(capFor('intercity_driver', 'bronze', rules)).toBe(300000);
  });

  it('owed = cash held that is not his, net of what the platform owes him', () => {
    expect(owedOf({ cashIqd: -16500, earningsIqd: 1000 })).toBe(15500);
    expect(owedOf({ cashIqd: 0, earningsIqd: 4000 })).toBe(0);
  });

  it('exactly at the cap counts as over; over cap gets no new offers', () => {
    expect(isOverCapAmount(74999, 75000)).toBe(false);
    expect(isOverCapAmount(75000, 75000)).toBe(true);
    expect(canOfferJob(75000, 75000, { valueIqd: 1000, prepaid: false }, rules)).toBe(false);
  });

  it('a single job may push past the cap only if it is worth ≤ 50 % of the cap; prepaid jobs never count', () => {
    expect(canOfferJob(60000, 75000, { valueIqd: 15000, prepaid: false }, rules)).toBe(true); // fits exactly
    expect(canOfferJob(60000, 75000, { valueIqd: 37500, prepaid: false }, rules)).toBe(true); // ≤ 50 % of cap
    expect(canOfferJob(60000, 75000, { valueIqd: 37501, prepaid: false }, rules)).toBe(false);
    expect(canOfferJob(0, 75000, { valueIqd: 100000, prepaid: false }, rules)).toBe(false); // a Baghdad private fare on a bronze courier
    expect(canOfferJob(0, 300000, { valueIqd: 100000, prepaid: false }, rules)).toBe(true); // same fare, intercity driver
    expect(canOfferJob(70000, 75000, { valueIqd: 200000, prepaid: true }, rules)).toBe(true);
  });

  it('G-86: payout due when the platform owes him more than 20,000, or anything positive on the weekly run', () => {
    expect(payoutDue({ cashIqd: 0, earningsIqd: 20000 }, rules)).toBe(0);
    expect(payoutDue({ cashIqd: 0, earningsIqd: 20001 }, rules)).toBe(20001);
    expect(payoutDue({ cashIqd: -5000, earningsIqd: 8000 }, rules, true)).toBe(3000);
    expect(payoutDue({ cashIqd: -9000, earningsIqd: 8000 }, rules, true)).toBe(0);
  });

  it('decisions §4: first three cash orders of a new account capped at 25,000 with an arriving call', () => {
    expect(newCustomerCashDecision(0, 25000, rules)).toEqual({ allowed: true, requiresArrivingCall: true });
    expect(newCustomerCashDecision(2, 25001, rules)).toEqual({ allowed: false, requiresArrivingCall: true });
    expect(newCustomerCashDecision(3, 60000, rules)).toEqual({ allowed: true, requiresArrivingCall: false });
  });
});

describe('CapsService (CapsPort for dispatch)', () => {
  it('cash orders push a bronze courier over 75,000; returning the merchant cash brings him back', async () => {
    const h = ledgerHarness();
    for (let i = 0; i < 5; i++) await h.posting.orderMoney(workedExample({ orderId: `o${i}`, merchantId: 'm1' }));
    // 5 × 15,500 owed (12,750 merchant + 2,750 platform) = 77,500
    expect((await h.caps.status('k1')).owedIqd).toBe(77500);
    expect(await h.caps.isOverCap('k1')).toBe(true);
    expect(await h.caps.canOffer('k1', { valueIqd: 1000, prepaid: true })).toBe(false);
    await h.ledger.recordAll(postMerchantPaidByCourier({ handoverId: 'h1', courierId: 'k1', merchantId: 'm1', amountIqd: 12750, occurredAt: at }));
    const s = await h.caps.status('k1');
    expect(s).toMatchObject({ owedIqd: 64750, capIqd: 75000, capRemainingIqd: 10250, overCap: false });
    expect(await h.caps.canOffer('k1', { valueIqd: 30000, prepaid: false })).toBe(true); // 50 % rule
    expect(await h.caps.canOffer('k1', { valueIqd: 40000, prepaid: false })).toBe(false);
  });

  it('role and tier come from the profile resolver; prepaid rides only add earnings', async () => {
    const h = ledgerHarness();
    h.profiles.set('d9', { role: 'intercity_driver', tier: 'bronze' });
    await h.ledger.recordAll(postRideCompleted({ tripId: 't1', occurredAt: at, customerId: 'c', payment: 'cash', driverId: 'd9', takeClass: 'intercity_private', fareIqd: 100000 }, rules).money);
    await h.ledger.recordAll(postRideCompleted({ tripId: 't2', occurredAt: at, customerId: 'c', payment: 'wallet', driverId: 'd9', takeClass: 'intercity_private', fareIqd: 50000 }, rules).money);
    const s = await h.caps.status('d9');
    // cash fare: owes the 8,000 take; prepaid fare: platform owes him 46,000 → net he is owed money
    expect(s).toMatchObject({ capIqd: 300000, owedIqd: 0, overCap: false, payoutDueIqd: 38000 });
    await h.ledger.recordAll(postSettlement({ kind: 'driver_payout', driverId: 'd9', amountIqd: 38000, channel: 'zaincash', reference: 'P-d9', occurredAt: at }));
    expect((await h.caps.status('d9')).payoutDueIqd).toBe(0);
  });

  it('CashRiskPort counts completed cash orders from the ledger', async () => {
    const h = ledgerHarness();
    expect(await h.caps.newCustomerCash('c1', 30000)).toEqual({ allowed: false, requiresArrivingCall: true, priorCashOrders: 0 });
    for (let i = 0; i < 3; i++) await h.posting.orderMoney(workedExample({ orderId: `o${i}` }));
    await h.posting.orderMoney(workedExample({ orderId: 'w1', payment: 'wallet' }));
    expect(await h.caps.newCustomerCash('c1', 30000)).toEqual({ allowed: true, requiresArrivingCall: false, priorCashOrders: 3 });
  });
});

describe('cap profiles from identity (role) and scoring (tier)', () => {
  const roles = (byPerson: Record<string, string[]>) => ({ activeRoles: async (id: string) => byPerson[id] ?? [] });
  const tiers = (byDriver: Record<string, 'bronze' | 'silver' | 'gold'>) => ({ capTier: async (id: string) => byDriver[id] ?? null });

  it('the driving role with the highest cap wins; no driving role is a courier', () => {
    expect(capRoleOf(['customer', 'courier'], rules)).toBe('courier');
    expect(capRoleOf(['driver'], rules)).toBe('driver');
    expect(capRoleOf(['courier', 'intercity_driver'], rules)).toBe('intercity_driver');
    expect(capRoleOf(['shopper'], rules)).toBe('courier');
    expect(capRoleOf([], rules)).toBe('courier');
  });

  it('tier from the scorecard, bronze when there is none; the cap follows', async () => {
    const h = ledgerHarness();
    const profiles = new IdentityScoringCapProfiles(roles({ k1: ['courier'], d1: ['driver'], x1: ['intercity_driver'] }), tiers({ k1: 'silver' }), h.clock, rules);
    expect(await profiles.profile('k1')).toEqual({ role: 'courier', tier: 'silver' });
    expect(await profiles.profile('d1')).toEqual({ role: 'driver', tier: 'bronze' });
    const caps = new CapsService(h.ledger, rules, profiles);
    expect((await caps.status('k1')).capIqd).toBe(150000);
    expect((await caps.status('d1')).capIqd).toBe(75000);
    expect((await caps.status('x1')).capIqd).toBe(300000);
  });

  it("speed x2: the partner app's reads keep his limit; his cash is read every time and dispatch's check stays live", async () => {
    const h = ledgerHarness();
    let reads = 0;
    let tier: 'silver' | 'bronze' = 'silver';
    const caps = new CapsService(h.ledger, rules, {
      profile: async () => {
        reads += 1;
        return { role: 'courier', tier };
      },
    });
    const first = await caps.status('k1', { keptLimit: true });
    expect(first.capIqd).toBe(150000);
    tier = 'bronze';
    await h.ledger.recordAll(postMerchantPaidByCourier({ handoverId: 'h1', courierId: 'k1', merchantId: 'm1', amountIqd: 9000, occurredAt: at }));
    const kept = await caps.status('k1', { keptLimit: true });
    expect(kept).toMatchObject({ tier: 'silver', capIqd: 150000 });
    expect(Math.abs(kept.cashIqd - first.cashIqd)).toBe(9000);
    expect(reads).toBe(1);
    expect(await caps.status('k1')).toMatchObject({ tier: 'bronze', capIqd: 75000 });
    expect(reads).toBe(2);
  });
});
