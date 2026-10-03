import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES as rules, type OrderMoneyPayload } from '@driver/contracts';
import { validateGroup } from './ledger.service.js';
import {
  allocate,
  guaranteeTopUp,
  lateMeterBlocks,
  orderPointRecipients,
  pointsForRevenue,
  pointsForRideTake,
  postCancellation,
  postDepartureCancelled,
  postLateMeter,
  postOrderClosed,
  postPoints,
  postReferral,
  postRideCompleted,
  postSeat,
  postSettlement,
  postSubscription,
  roundCustomerTotal,
  takeOf,
  type PostingGroup,
} from './postings.js';
import { workedExample } from './test-harness.js';

const at = new Date('2026-10-03T12:00:00Z');

/** Net per account inside one group. */
function nets(g: PostingGroup): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of g.lines) {
    out[l.toAccount] = (out[l.toAccount] ?? 0) + l.amount;
    out[l.fromAccount] = (out[l.fromAccount] ?? 0) - l.amount;
  }
  return out;
}

describe('order closed — money §2 worked example', () => {
  it('15,000 across town → platform 2,750 / courier 1,000 / merchant 12,750; customer pays 16,500', () => {
    const p = postOrderClosed(workedExample(), rules);
    validateGroup(p.money);
    const n = nets(p.money);
    expect(n['platform']).toBe(2750);
    expect(n['driver:k1']).toBe(1000);
    expect(n['merchant_cash:m1']).toBe(12750);
    expect(n['cash:k1']).toBe(-16500); // the courier holds it all until he hands it over
    expect(n['customer:c1']).toBe(0);
    expect(p.totalIqd).toBe(16500);
    expect(p.revenueIqd).toBe(2750);
    expect(p.redeem).toBeNull();
    expect(p.money.id).toBe('order:o1:money');
    expect(p.money.lines.map((l) => l.type)).toEqual(['merchant_payable', 'commission_accrued', 'service_fee', 'delivery_fee', 'cash_collected']);
  });

  it('commission base is the item subtotal after merchant-funded discounts, never service fee or delivery (G-87)', () => {
    const p = postOrderClosed(workedExample({ itemsSubtotalIqd: 10000, commissionTier: 'base', deliveryFeeIqd: 1500 }), rules);
    expect(p.money.lines.find((l) => l.type === 'commission_accrued')?.amount).toBe(1200);
  });

  it('batched second order: courier earns 70 % of its fee, the customer pays it in full', () => {
    const p = postOrderClosed(workedExample({ batchedSecond: true }), rules);
    const n = nets(p.money);
    expect(n['driver:k1']).toBe(700);
    expect(n['platform']).toBe(2750 + 300);
    expect(p.totalIqd).toBe(16500);
  });

  it('far band: customer 2,000, courier 1,500, platform keeps 500', () => {
    const n = nets(postOrderClosed(workedExample({ deliveryFeeIqd: 2000, courierDeliveryIqd: 1500 }), rules).money);
    expect(n['driver:k1']).toBe(1500);
    expect(n['platform']).toBe(2750 + 500);
  });

  it('wallet order: no cash moves, the wallet is charged the total', () => {
    const p = postOrderClosed(workedExample({ payment: 'wallet' }), rules);
    validateGroup(p.money);
    expect(p.money.lines.some((l) => l.type === 'cash_collected')).toBe(false);
    expect(nets(p.money)['customer:c1']).toBe(-16500);
  });

  it('household wallet pays instead of the member', () => {
    const n = nets(postOrderClosed(workedExample({ payment: 'wallet', householdId: 'h1' }), rules).money);
    expect(n['household:h1']).toBe(-16500);
    expect(n['customer:c1']).toBeUndefined();
  });

  it('pickup order (5 %): the merchant collects and owes commission + service fee', () => {
    const p = postOrderClosed(workedExample({ courierId: undefined, deliveryFeeIqd: 0, commissionTier: 'pickup' }), rules);
    validateGroup(p.money);
    expect(nets(p.money)['merchant_cash:m1']).toBe(-(750 + 500));
    expect(() => postOrderClosed(workedExample({ courierId: undefined }), rules)).toThrow(/without a courier/);
  });

  it('short cash stays as wallet debt; extra cash becomes a rounding credit', () => {
    const short = postOrderClosed(workedExample({ cashCollectedIqd: 16000 }), rules);
    validateGroup(short.money);
    expect(nets(short.money)['customer:c1']).toBe(-500);
    const extra = postOrderClosed(workedExample({ cashCollectedIqd: 17000 }), rules);
    validateGroup(extra.money);
    expect(nets(extra.money)['customer:c1']).toBe(500);
    expect(extra.money.lines.find((l) => l.type === 'cash_rounding_credit')?.amount).toBe(500);
  });

  it('points redeem against the service fee first, then delivery; the platform funds them', () => {
    const p = postOrderClosed(workedExample({ pointsRedeemed: 60 }), rules);
    validateGroup(p.money);
    const promo = p.money.lines.filter((l) => l.type === 'promo_funded');
    expect(promo.map((l) => [l.memo, l.amount])).toEqual([
      ['points:service_fee', 500],
      ['points:delivery_fee', 100],
    ]);
    expect(nets(p.money)['platform']).toBe(2750 - 600);
    expect(p.totalIqd).toBe(16000); // 16,500 − 600 = 15,900 → rounds to 16,000
    expect(nets(p.money)['rounding']).toBe(100);
    expect(p.redeem && nets(p.redeem)).toEqual({ 'points:c1': -60, points_pool: 60 });
    // Never more than service fee + delivery: 1,000 points ask for 10,000 but only 150 apply.
    expect(postOrderClosed(workedExample({ pointsRedeemed: 1000 }), rules).redeem?.lines[0]?.amount).toBe(150);
  });

  it('platform promo is drawn from its budget line', () => {
    const n = nets(postOrderClosed(workedExample({ platformPromo: { promotionId: 'free3', amountIqd: 1000 } }), rules).money);
    expect(n['promo:free3']).toBe(-1000);
    expect(n['cash:k1']).toBe(-15500);
  });
});

describe('rounding (G-88)', () => {
  it('customer totals are multiples of 500, half up; 250 only with a 250 component', () => {
    expect(roundCustomerTotal(16250, rules)).toBe(16500);
    expect(roundCustomerTotal(16249, rules)).toBe(16000);
    expect(roundCustomerTotal(16250, rules, true)).toBe(16250);
    expect(roundCustomerTotal(16100, rules, true)).toBe(16000);
  });

  it('residue posts to the rounding account in either direction', () => {
    const up = postOrderClosed(workedExample({ itemsSubtotalIqd: 14750 }), rules);
    validateGroup(up.money);
    expect(up.totalIqd).toBe(16500);
    expect(nets(up.money)['rounding']).toBe(250);
    const down = postOrderClosed(workedExample({ itemsSubtotalIqd: 14600 }), rules);
    validateGroup(down.money);
    expect(down.totalIqd).toBe(16000);
    expect(nets(down.money)['rounding']).toBe(-100);
    const quarter = postOrderClosed(workedExample({ itemsSubtotalIqd: 14750, has250Component: true }), rules);
    expect(quarter.totalIqd).toBe(16250);
    expect(nets(quarter.money)['rounding']).toBeUndefined();
  });
});

describe('review L: postings agree with the order total rule (has250Component)', () => {
  it('a 16,250 night order (+250 delivery) collected in full nets the customer to zero even without the flag', () => {
    const p = postOrderClosed(
      { orderId: 'o1', orderType: 'food', occurredAt: at, customerId: 'c', payment: 'cash', cashCollectedIqd: 16250, merchantId: 'm', courierId: 'k', itemsSubtotalIqd: 15000, commissionTier: 'base', serviceFeeIqd: 0, deliveryFeeIqd: 1250 },
      rules,
    );
    validateGroup(p.money);
    expect(p.totalIqd).toBe(16250);
    expect(nets(p.money)['customer:c'] ?? 0).toBe(0);
    expect(nets(p.money)['rounding']).toBeUndefined();
  });

  it('a street hand-over (−250) and a 250-step ride fare round to 250 too', () => {
    const street = postOrderClosed(workedExample({ deliveryFeeIqd: 750, cashCollectedIqd: 16250 }), rules);
    expect(street.totalIqd).toBe(16250);
    expect(nets(street.money)['customer:c1'] ?? 0).toBe(0);
    const ride = postRideCompleted({ tripId: 't', occurredAt: at, customerId: 'c', payment: 'cash', driverId: 'd', takeClass: 'tuktuk', fareIqd: 2750, cashCollectedIqd: 2750 }, rules);
    expect(ride.totalIqd).toBe(2750);
    expect(nets(ride.money)['customer:c'] ?? 0).toBe(0);
  });
});

describe('rides, seats, subscriptions — money §3 take', () => {
  it('tuktuk 10 % with a 100 floor; car 12 %; parcel 15 % as a parcel_fee line', () => {
    expect(takeOf(3000, rules.take.tuktuk)).toBe(300);
    expect(takeOf(500, rules.take.tuktuk)).toBe(100);
    expect(takeOf(80, rules.take.tuktuk)).toBe(80); // never more than the fare
    const ride = postRideCompleted({ tripId: 't1', occurredAt: at, customerId: 'c1', payment: 'cash', driverId: 'd1', takeClass: 'tuktuk', fareIqd: 1000 }, rules);
    validateGroup(ride.money);
    expect(ride.takeIqd).toBe(100);
    expect(nets(ride.money)).toMatchObject({ 'driver:d1': 900, platform: 100, 'cash:d1': -1000, 'customer:c1': 0 });
    expect(postRideCompleted({ tripId: 't2', occurredAt: at, customerId: 'c1', payment: 'cash', driverId: 'd1', takeClass: 'car', fareIqd: 5000 }, rules).takeIqd).toBe(600);
    const parcel = postRideCompleted({ tripId: 't3', occurredAt: at, customerId: 'c1', payment: 'wallet', driverId: 'd1', takeClass: 'parcel', fareIqd: 2000 }, rules);
    expect(parcel.money.lines[0]?.type).toBe('parcel_fee');
    expect(parcel.takeIqd).toBe(300);
  });

  it('rebroadcast compensation is platform-funded, not charged to the customer', () => {
    const r = postRideCompleted({ tripId: 't4', occurredAt: at, customerId: 'c1', payment: 'cash', driverId: 'd1', takeClass: 'car', fareIqd: 5000, pickupCompensationIqd: 500 }, rules);
    validateGroup(r.money);
    expect(nets(r.money)).toMatchObject({ platform: 600 - 500, 'driver:d1': 4400 + 500, 'customer:c1': 0 });
  });

  it('intercity seat 10 % and front-seat premium 25 %; walk-ups carry no commission', () => {
    const s = postSeat({ seatId: 's1', departureId: 'dep1', occurredAt: at, customerId: 'r1', payment: 'cash', driverId: 'd2', fareIqd: 15000, frontPremiumIqd: 2000 }, rules);
    validateGroup(s.money);
    expect(s.takeIqd).toBe(1500 + 500);
    expect(nets(s.money)).toMatchObject({ 'driver:d2': 17000 - 2000, platform: 2000, 'cash:d2': -17000 });
    const walkUp = postSeat({ seatId: 's2', departureId: 'dep1', occurredAt: at, customerId: 'r2', payment: 'cash', driverId: 'd2', fareIqd: 15000, walkUp: true }, rules);
    expect(walkUp.takeIqd).toBe(0);
    expect(nets(walkUp.money)['platform']).toBeUndefined();
  });

  it('khat seat: 8 % + 1,000 fixed per rider-month', () => {
    const s = postSubscription({ subscriptionId: 'sub1', routeId: 'r1', cycle: '2026-11', occurredAt: at, customerId: 'g1', payment: 'wallet', driverId: 'd3', amountIqd: 30000 }, rules);
    validateGroup(s.money);
    expect(s.takeIqd).toBe(2400 + 1000);
    expect(s.money.id).toBe('subscription:sub1:2026-11');
  });
});

describe('late meter — 100 % to the wronged party', () => {
  it('5-minute grace, then a block per 10 minutes, capped at 20 minutes', () => {
    expect(lateMeterBlocks(5, rules)).toBe(0);
    expect(lateMeterBlocks(6, rules)).toBe(1);
    expect(lateMeterBlocks(15, rules)).toBe(1);
    expect(lateMeterBlocks(16, rules)).toBe(2);
    expect(lateMeterBlocks(45, rules)).toBe(2);
  });

  it('late rider pays the driver 1,000 and each waiting rider 500 per block; the platform takes nothing', () => {
    const g = postLateMeter({ departureId: 'dep1', occurredAt: at, minutesLate: 16, late: { kind: 'rider', id: 'r9' }, driverId: 'd2', waitingRiderIds: ['r1', 'r2', 'r9'] }, rules)!;
    validateGroup(g);
    expect(nets(g)).toEqual({ 'customer:r9': -4000, 'driver:d2': 2000, 'customer:r1': 1000, 'customer:r2': 1000 });
    expect(g.lines.every((l) => l.fromAccount !== 'platform' && l.toAccount !== 'platform')).toBe(true);
  });

  it('late driver pays each waiting rider from his balance; inside the grace nothing posts', () => {
    const g = postLateMeter({ departureId: 'dep1', occurredAt: at, minutesLate: 9, late: { kind: 'driver', id: 'd2' }, driverId: 'd2', waitingRiderIds: ['r1', 'r2'] }, rules)!;
    expect(nets(g)).toEqual({ 'driver:d2': -2000, 'customer:r1': 1000, 'customer:r2': 1000 });
    expect(postLateMeter({ departureId: 'dep1', occurredAt: at, minutesLate: 4, late: { kind: 'rider', id: 'r9' }, driverId: 'd2' }, rules)).toBeNull();
  });
});

describe('cancellations', () => {
  const cancelled = (over: Record<string, unknown>) =>
    ({ from: 'merchant_accepted', to: 'customer_cancelled', cancelledState: 'customer_cancelled', orderId: 'o2', occurredAt: at, customerId: 'c1', by: 'customer', reason: 'customer_request', free: false, ...over }) as Parameters<typeof postCancellation>[0];

  it('fee goes 100 % to the wronged parties and stays as wallet debt; free cancel posts nothing', () => {
    const g = postCancellation(cancelled({ feeIqd: 1500, beneficiaries: [{ kind: 'merchant', id: 'm1', amountIqd: 1000 }, { kind: 'driver', id: 'k1', amountIqd: 500 }] }))!;
    validateGroup(g);
    expect(nets(g)).toEqual({ 'customer:c1': -1500, 'merchant_cash:m1': 1000, 'driver:k1': 500 });
    expect(postCancellation(cancelled({ orderId: 'o3', feeIqd: 0, free: true, beneficiaries: [] }))).toBeNull();
  });

  it('a fee whose beneficiaries do not add up is refused (the contract refine)', () => {
    expect(() => postCancellation(cancelled({ feeIqd: 1000, beneficiaries: [{ kind: 'merchant', id: 'm1', amountIqd: 500 }] }))).toThrow(/add up/);
  });

  it('driver cancelling a departure inside 2 h shares his fee across booked riders; low-fill posts nothing', () => {
    const g = postDepartureCancelled({ departureId: 'dep2', occurredAt: at, driverId: 'd2', cancelledBy: 'driver', feeIqd: 2000, riderIds: ['a', 'b', 'c'] })!;
    validateGroup(g);
    expect(g.lines.map((l) => l.amount)).toEqual([667, 667, 666]);
    expect(postDepartureCancelled({ departureId: 'dep3', occurredAt: at, driverId: 'd2', cancelledBy: 'low_fill', feeIqd: 2000, riderIds: ['a'] })).toBeNull();
  });
});

describe('points on platform revenue (decisions §2)', () => {
  it('1 point per 100 IQD of revenue, capped at 50; rides 1 per 200 of take', () => {
    expect(pointsForRevenue(2750, rules)).toBe(27);
    expect(pointsForRevenue(99, rules)).toBe(0);
    expect(pointsForRevenue(60000, rules)).toBe(50);
    expect(pointsForRideTake(300, rules)).toBe(1);
    expect(pointsForRideTake(1999, rules)).toBe(9);
  });

  it('a big order earns no more than the cap, whatever the GMV', () => {
    const big = postOrderClosed(workedExample({ itemsSubtotalIqd: 400000, commissionTier: 'base' }), rules);
    expect(pointsForRevenue(big.revenueIqd, rules)).toBe(50);
  });

  it('split by tagged items; phone-only participants get pending points; orderer gets the +10 % organiser bonus', () => {
    const order = { customerId: 'c1', itemsSubtotalIqd: 15000, participants: [{ personId: 'p2', itemsIqd: 10000 }, { phoneHash: 'h3', itemsIqd: 5000 }] };
    const g = postPoints({ groupId: 'order:o1:points', occurredAt: at, refs: { orderId: 'o1' }, points: 27, ordererId: 'c1', recipients: orderPointRecipients(order), rules })!;
    validateGroup(g);
    expect(g.kind).toBe('points');
    expect(nets(g)).toEqual({ points_pool: -(18 + 9 + 2), 'points:p2': 18, 'points_pending:h3': 9, 'points:c1': 2 });
  });

  it('review M: the per-order cap of 50 covers the organiser bonus too', () => {
    const g = postPoints({ groupId: 'g', occurredAt: at, refs: {}, points: pointsForRevenue(100000, rules), ordererId: 'o', recipients: [{ personId: 'friend', weight: 1 }], rules })!;
    validateGroup(g);
    expect(g.lines.reduce((a, l) => a + l.amount, 0)).toBe(50);
    expect(nets(g)).toEqual({ points_pool: -50, 'points:friend': 45, 'points:o': 5 });
    // Under the cap nothing changes: 27 shared + 2 bonus.
    const small = postPoints({ groupId: 'h', occurredAt: at, refs: {}, points: 27, ordererId: 'o', recipients: [{ personId: 'friend', weight: 1 }], rules })!;
    expect(nets(small)).toEqual({ points_pool: -29, 'points:friend': 27, 'points:o': 2 });
  });

  it('a solo order sends every point to the orderer with no organiser bonus', () => {
    const g = postPoints({ groupId: 'x', occurredAt: at, refs: {}, points: 27, ordererId: 'c1', recipients: orderPointRecipients({ customerId: 'c1', itemsSubtotalIqd: 15000, participants: [] }), rules })!;
    expect(nets(g)).toEqual({ points_pool: -27, 'points:c1': 27 });
  });

  it('referral: 200 points per side; the referrer side drops at his monthly cap', () => {
    expect(nets(postReferral({ refereeId: 'b', referrerId: 'a', referrerWithinCap: true, occurredAt: at, rules }))).toEqual({ points_pool: -400, 'points:a': 200, 'points:b': 200 });
    expect(nets(postReferral({ refereeId: 'b', referrerId: 'a', referrerWithinCap: false, occurredAt: at, rules }))).toEqual({ points_pool: -200, 'points:b': 200 });
  });
});

describe('settlements and incentives', () => {
  it('driver settlement, merchant payout and driver payout move real money through `bank`', () => {
    expect(nets(postSettlement({ kind: 'driver_settlement', driverId: 'k1', amountIqd: 2750, channel: 'zaincash', reference: 'D-AAAA-BBBB', occurredAt: at }))).toEqual({ bank: -2750, 'cash:k1': 2750 });
    expect(nets(postSettlement({ kind: 'merchant_payout', merchantId: 'm1', amountIqd: 12750, channel: 'ops_round', reference: 'M-1', occurredAt: at }))).toEqual({ 'merchant_cash:m1': -12750, bank: 12750 });
    expect(nets(postSettlement({ kind: 'driver_payout', driverId: 'd1', amountIqd: 25000, channel: 'zaincash', reference: 'P-1', occurredAt: at }))).toEqual({ 'driver:d1': -25000, bank: 25000 });
  });

  it('shift guarantee needs ≥ 85 % acceptance, ≤ 1 cancel after accept and ≥ 3 jobs (G-91)', () => {
    const ok = { earningsIqd: 6000, acceptanceRate: 0.9, cancelsAfterAccept: 1, completedJobs: 3 };
    expect(guaranteeTopUp(ok, rules)).toBe(4000);
    expect(guaranteeTopUp({ ...ok, acceptanceRate: 0.84 }, rules)).toBe(0);
    expect(guaranteeTopUp({ ...ok, cancelsAfterAccept: 2 }, rules)).toBe(0);
    expect(guaranteeTopUp({ ...ok, completedJobs: 2 }, rules)).toBe(0);
    expect(guaranteeTopUp({ ...ok, earningsIqd: 12000 }, rules)).toBe(0);
  });
});

describe('property: random orders always balance', () => {
  it('2,000 random orders/rides validate, the customer nets to what he paid minus the total, and no fee exceeds a fare', () => {
    let seed = 20261003;
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
    for (let i = 0; i < 2000; i++) {
      if (rand() < 0.7) {
        const courier = rand() < 0.9;
        const delivery = courier ? pick([500, 1000, 1500, 2000]) : 0;
        const o: OrderMoneyPayload = {
          orderId: `o${i}`,
          orderType: 'food',
          occurredAt: at,
          customerId: `c${i % 37}`,
          payment: rand() < 0.8 ? 'cash' : 'wallet',
          merchantId: `m${i % 11}`,
          ...(courier ? { courierId: `k${i % 13}` } : {}),
          itemsSubtotalIqd: 250 * Math.floor(rand() * 200),
          commissionTier: courier ? pick(['base', 'featured', 'marketing'] as const) : 'pickup',
          deliveryFeeIqd: delivery,
          batchedSecond: courier && rand() < 0.2,
          tipIqd: courier && rand() < 0.1 ? 1000 : 0,
          pointsRedeemed: rand() < 0.2 ? Math.floor(rand() * 200) : 0,
          has250Component: rand() < 0.3,
          ...(rand() < 0.3 ? { cashCollectedIqd: 250 * Math.floor(rand() * 220) } : {}),
          participants: rand() < 0.3 ? [{ personId: `p${i}`, itemsIqd: 0 }] : [],
        };
        const p = postOrderClosed(o, rules);
        validateGroup(p.money);
        if (p.redeem) validateGroup(p.redeem);
        expect(p.totalIqd % 250).toBe(0);
        if (!o.has250Component) expect(p.totalIqd % 500).toBe(0);
        const sum = Object.values(nets(p.money)).reduce((a, b) => a + b, 0);
        expect(sum).toBe(0);
        expect(p.money.lines.every((l) => Number.isInteger(l.amount) && l.amount > 0)).toBe(true);
      } else {
        const fare = 250 * (1 + Math.floor(rand() * 120));
        const r = postRideCompleted(
          { tripId: `t${i}`, occurredAt: at, customerId: `c${i % 37}`, payment: rand() < 0.85 ? 'cash' : 'wallet', driverId: `d${i % 17}`, takeClass: pick(['tuktuk', 'car', 'intercity_private', 'parcel', 'parcel_intercity'] as const), fareIqd: fare },
          rules,
        );
        validateGroup(r.money);
        expect(r.takeIqd).toBeLessThanOrEqual(fare);
      }
    }
  });

  it('allocate always sums exactly', () => {
    expect(allocate(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocate(27, [10000, 5000])).toEqual([18, 9]);
    expect(allocate(5, [0, 0])).toEqual([5, 0]);
  });
});
