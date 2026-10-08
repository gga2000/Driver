import { AZIZIYAH_MONEY_RULES } from '@driver/contracts';
import { describe, expect, it } from 'vitest';
import { LEDGER_SUBSCRIBED_EVENTS } from './ledger.subscribers.js';
import { ledgerHarness, workedExample } from './test-harness.js';

/** The rules once Ali approves the invite amounts (M-5): the referral switch on, nothing else changed. */
const referralOn = { ...AZIZIYAH_MONEY_RULES, referral: { ...AZIZIYAH_MONEY_RULES.referral, enabled: true } };

const at = new Date('2026-10-03T12:00:00Z');
const day = (d: number) => new Date(Date.UTC(2026, 9, d, 12));

/** Payloads arrive as JSON from the outbox: dates are strings. */
const wire = <T,>(x: T): Record<string, unknown> => JSON.parse(JSON.stringify(x)) as Record<string, unknown>;

describe('ledger subscribers', () => {
  it('subscribes to exactly the domain events the ledger settles', () => {
    expect(LEDGER_SUBSCRIBED_EVENTS.sort()).toEqual(
      [
        'order.cash_collected',
        'departure.cancelled',
        'merchant.settlement_requested',
        'order.cancelled',
        'order.closed',
        'seat.completed',
        'seat.late_meter_settled',
        'seat.no_show',
        'subscription.prorated',
        'subscription.renewed',
        'subscription.started',
      ].sort(),
    );
  });

  /** The producer-side extras every `order.cash_collected` carries next to the money fact. */
  const cash = (o: ReturnType<typeof workedExample>) => ({ tripId: 't1', courierId: o.courierId ?? 'k1', amountIqd: 16500, expectedIqd: 16500, discrepancyIqd: 0 });
  const closed = { from: 'delivered', to: 'closed', reason: 'auto_2h', totalIqd: 16500 };

  it('food: order.cash_collected posts money at once, order.closed adds points on revenue, replays add nothing', async () => {
    const h = ledgerHarness();
    await h.bus.publish('order.cash_collected', wire({ kind: 'order', order: workedExample(), ...cash(workedExample()) }));
    expect((await h.ledger.balance('merchant_cash:m1')).amount).toBe(12750);
    expect((await h.ledger.balance('points:c1')).amount).toBe(0);

    await h.bus.publish('order.closed', wire({ kind: 'order', order: workedExample(), ...closed }));
    expect((await h.ledger.balance('points:c1')).amount).toBe(27); // 2,750 revenue → 27 points, not 165 on GMV
    expect((await h.ledger.balance('platform')).amount).toBe(2750);

    const before = (await h.repo.all()).length;
    await h.bus.publish('order.cash_collected', wire({ kind: 'order', order: workedExample(), ...cash(workedExample()) }));
    await h.bus.publish('order.closed', wire({ kind: 'order', order: workedExample(), ...closed }));
    expect((await h.repo.all()).length).toBe(before);
    const inv = await h.ledger.checkInvariant();
    expect(inv.ok).toBe(true);
    expect(inv.points.events).toBe(1);
  });

  it('points on revenue are capped at 50 however big the order', async () => {
    const h = ledgerHarness();
    await h.bus.publish('order.closed', wire({ kind: 'order', order: workedExample({ itemsSubtotalIqd: 300000, commissionTier: 'marketing' }), ...closed }));
    expect((await h.ledger.balance('points:c1')).amount).toBe(50);
  });

  it('redeemed points leave the customer in the same commit as the money they paid for', async () => {
    const h = ledgerHarness();
    await h.posting.orderClosed(workedExample({ pointsRedeemed: 50, payment: 'wallet' }));
    // Revenue for points is net of what the platform funded: 2,750 − 500 redeemed = 2,250 → 22 points.
    expect((await h.ledger.balance('points:c1')).amount).toBe(-50 + 22);
    expect((await h.ledger.balance('customer:c1')).amount).toBe(-16000);
  });

  it('referral pays nothing while the money-rule switch is off (THIN-18, M-5 not approved yet)', async () => {
    const h = ledgerHarness();
    expect(AZIZIYAH_MONEY_RULES.referral.enabled).toBe(false);
    for (const n of [1, 2, 3]) await h.posting.orderClosed(workedExample({ orderId: `off-${n}`, customerId: 'b', referredBy: 'a', itemsSubtotalIqd: 20000, occurredAt: day(3) }));
    expect((await h.ledger.eventsFor('points:a')).some((e) => e.type === 'referral_bonus')).toBe(false);
    expect((await h.ledger.eventsFor('points:b')).some((e) => e.type === 'referral_bonus')).toBe(false);
  });

  it('referral unlocks on the referee’s second completed cash order ≥ 10,000; wallet and small orders do not count', async () => {
    const h = ledgerHarness({ rules: referralOn });
    const order = (id: string, items: number, over = {}) => workedExample({ orderId: id, customerId: 'b', referredBy: 'a', itemsSubtotalIqd: items, occurredAt: day(3), ...over });
    await h.posting.orderClosed(order('b1', 12000));
    await h.posting.orderClosed(order('b2', 7000)); // 8,500 paid < 10,000
    await h.posting.orderClosed(order('b3', 20000, { payment: 'wallet' }));
    expect((await h.ledger.balance('points:a')).amount).toBe(0);
    await h.posting.orderClosed(order('b4', 9000)); // 10,500 paid
    expect((await h.ledger.balance('points:a')).amount).toBe(200);
    const bPoints = (await h.ledger.eventsFor('points:b')).filter((e) => e.type === 'referral_bonus');
    expect(bPoints.map((e) => e.amount)).toEqual([200]);
    await h.posting.orderClosed(order('b5', 30000));
    expect((await h.ledger.balance('points:a')).amount).toBe(200); // once only
  });

  it('referrer monthly cap: the 11th referee this month still gets 200, the referrer does not; next month resets', async () => {
    const h = ledgerHarness({ rules: referralOn });
    const unlock = async (referee: string, d: Date) => {
      for (const n of [1, 2]) await h.posting.orderClosed(workedExample({ orderId: `${referee}-${n}`, customerId: referee, referredBy: 'a', occurredAt: d }));
    };
    for (let i = 0; i < 11; i++) await unlock(`r${i}`, day(10));
    const referrerLines = async () => (await h.ledger.eventsFor('points:a')).filter((e) => e.type === 'referral_bonus').length;
    expect(await referrerLines()).toBe(10);
    expect((await h.ledger.eventsFor('points:r10')).some((e) => e.type === 'referral_bonus')).toBe(true);
    await unlock('nov1', new Date(Date.UTC(2026, 10, 2, 12)));
    expect(await referrerLines()).toBe(11);
  });

  it('rides: cash collected at the door posts money only, order.closed adds points on the take; replays add nothing', async () => {
    const h = ledgerHarness();
    const ride = { tripId: 't1', orderId: 'r1', occurredAt: at, customerId: 'c1', payment: 'cash', driverId: 'd1', takeClass: 'tuktuk', fareIqd: 3000 };
    await h.bus.publish('order.cash_collected', wire({ kind: 'ride', ride, tripId: 't1', courierId: 'd1', amountIqd: 3000, expectedIqd: 3000, discrepancyIqd: 0 }));
    expect((await h.ledger.balance('driver:d1')).amount).toBe(2700);
    expect((await h.ledger.balance('points:c1')).amount).toBe(0);
    await h.bus.publish('order.closed', wire({ kind: 'ride', ride, from: 'completed', to: 'closed', reason: 'auto_2h', totalIqd: 3000 }));
    expect((await h.ledger.balance('points:c1')).amount).toBe(1);
    await h.bus.publish('order.closed', wire({ kind: 'ride', ride, from: 'completed', to: 'closed', reason: 'auto_2h', totalIqd: 3000 }));
    expect((await h.repo.all()).filter((e) => e.kind === 'money')).toHaveLength(3);
  });

  it('seats: completed earns points, no-show forfeits (driver keeps the fare), late meter pays the wronged', async () => {
    const h = ledgerHarness();
    const seat = { departureId: 'dep1', occurredAt: at, payment: 'wallet', driverId: 'd2', fareIqd: 15000 };
    await h.bus.publish('seat.completed', wire({ ...seat, seatId: 's1', customerId: 'r1', frontPremiumIqd: 2000 }));
    await h.bus.publish('seat.no_show', wire({ ...seat, seatId: 's2', customerId: 'r2' }));
    await h.bus.publish('seat.late_meter_settled', wire({ departureId: 'dep1', occurredAt: at, minutesLate: 12, late: { kind: 'rider', id: 'r2' }, driverId: 'd2', waitingRiderIds: ['r1'] }));
    expect((await h.ledger.balance('points:r1')).amount).toBe(10); // 2,000 take / 200
    expect((await h.ledger.balance('points:r2')).amount).toBe(0);
    expect((await h.ledger.balance('driver:d2')).amount).toBe(15000 + 13500 + 1000);
    expect((await h.ledger.balance('customer:r1')).amount).toBe(-17000 + 500);
  });

  it('cancellations, departure cancels and khat subscriptions settle from their events', async () => {
    const h = ledgerHarness();
    await h.bus.publish(
      'order.cancelled',
      wire({ from: 'merchant_accepted', to: 'customer_cancelled', cancelledState: 'customer_cancelled', orderId: 'o9', occurredAt: at, customerId: 'c1', by: 'customer', reason: 'customer_request', free: false, feeIqd: 1000, beneficiaries: [{ kind: 'driver', id: 'k1', amountIqd: 1000 }] }),
    );
    await h.bus.publish('departure.cancelled', wire({ departureId: 'dep9', occurredAt: at, driverId: 'd2', cancelledBy: 'driver', feeIqd: 2000, riderIds: ['r1', 'r2'] }));
    await h.bus.publish('subscription.renewed', wire({ subscriptionId: 'sub1', routeId: 'kh1', cycle: '2026-11', occurredAt: at, customerId: 'g1', payment: 'cash', driverId: 'd3', amountIqd: 30000 }));
    await h.bus.publish('subscription.prorated', wire({ subscriptionId: 'sub2', routeId: 'kh1', cycle: '2026-10', occurredAt: at, customerId: 'g2', payment: 'wallet', driverId: 'd3', amountIqd: 12000 }));
    expect((await h.ledger.balance('driver:k1')).amount).toBe(1000);
    expect((await h.ledger.balance('customer:r1')).amount).toBe(1000);
    expect((await h.ledger.balance('driver:d2')).amount).toBe(-2000);
    // Khat: 8 % + 1,000 → 3,400 on the cash month, 1,960 on the prorated wallet one; the prepaid month covers what he owes.
    expect(await h.caps.status('d3')).toMatchObject({ earningsIqd: 26600 + 10040, cashIqd: -30000, owedIqd: 0, payoutDueIqd: 0 });
    expect((await h.ledger.eventsFor('customer:g2')).map((e) => e.type)).toEqual(['subscription_proration']);
    expect((await h.ledger.checkInvariant()).ok).toBe(true);
  });

  it('a malformed payload is rejected and writes nothing', async () => {
    const h = ledgerHarness();
    await expect(h.bus.publish('order.closed', { kind: 'order', order: { orderId: 'x' } })).rejects.toThrow();
    expect(await h.repo.all()).toHaveLength(0);
  });
});
