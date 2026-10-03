import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, OrderState } from '@driver/contracts';
import { orderPointRecipients, postPoints } from '../ledger/postings.js';
import {
  COURIER_ORDER_TRANSITIONS,
  MERCHANT_ORDER_TRANSITIONS,
  RIDE_ORDER_TRANSITIONS,
  canOrderTransition,
  orderEventType,
  vehicleRequirement,
} from './order.machine.js';
import { activePauseWindow, localDowMinutes } from './pause.js';
import { allocatePoints, orderPoints } from './participants.js';

const ALL = OrderState.options;
const TERMINAL = { refunded: [], merchant_rejected: [], customer_cancelled: [], platform_cancelled: [], failed: [] };

function expectTable(table: Record<string, readonly string[]>, expected: Record<string, string[]>) {
  expect(Object.keys(table).sort()).toEqual([...ALL].sort());
  for (const from of ALL) for (const to of ALL) expect(table[from]!.includes(to), `${from} → ${to}`).toBe((expected[from] ?? []).includes(to));
}

describe('order machine — full transition tables (domain §2)', () => {
  it('merchant orders (food, grocery)', () => {
    expectTable(MERCHANT_ORDER_TRANSITIONS, {
      placed: ['merchant_accepted', 'merchant_rejected', 'customer_cancelled', 'platform_cancelled'],
      merchant_accepted: ['preparing', 'ready', 'merchant_rejected', 'customer_cancelled', 'platform_cancelled'],
      preparing: ['ready', 'merchant_rejected', 'customer_cancelled', 'platform_cancelled'],
      ready: ['picked_up', 'customer_cancelled', 'platform_cancelled'],
      picked_up: ['delivered', 'disputed', 'failed'],
      delivered: ['closed', 'disputed'],
      closed: ['disputed', 'refunded'],
      disputed: ['closed', 'refunded'],
      ...TERMINAL,
    });
  });

  it('courier orders (errand, parcel) skip the merchant', () => {
    expectTable(COURIER_ORDER_TRANSITIONS, {
      placed: ['picked_up', 'customer_cancelled', 'platform_cancelled'],
      picked_up: ['delivered', 'disputed', 'failed'],
      delivered: ['closed', 'disputed'],
      closed: ['disputed', 'refunded'],
      disputed: ['closed', 'refunded'],
      ...TERMINAL,
    });
  });

  it('rides: placed → matched → completed → closed, back to placed when the driver drops out', () => {
    expectTable(RIDE_ORDER_TRANSITIONS, {
      placed: ['matched', 'customer_cancelled', 'platform_cancelled'],
      matched: ['placed', 'completed', 'customer_cancelled', 'platform_cancelled', 'disputed', 'failed'],
      completed: ['closed', 'disputed'],
      closed: ['disputed', 'refunded'],
      disputed: ['closed', 'refunded'],
      ...TERMINAL,
    });
  });

  it('no cancel after pickup; per-type tables are used', () => {
    expect(canOrderTransition('food', 'picked_up', 'customer_cancelled')).toBe(false);
    expect(canOrderTransition('grocery_catalog', 'placed', 'merchant_accepted')).toBe(true);
    expect(canOrderTransition('parcel', 'placed', 'merchant_accepted')).toBe(false);
    expect(canOrderTransition('ride', 'placed', 'matched')).toBe(true);
  });

  it('domain §6 event names', () => {
    expect(orderEventType('merchant_accepted')).toBe('order.accepted');
    expect(orderEventType('merchant_rejected')).toBe('order.rejected');
    expect(orderEventType('customer_cancelled')).toBe('order.cancelled');
    expect(orderEventType('picked_up')).toBe('order.picked_up');
  });
});

describe('order caps per vehicle class (review A.16)', () => {
  it('bike ≤ 25,000 and ≤ 6 items; tuktuk ≤ 60,000; car above; catering above 100,000', () => {
    expect(vehicleRequirement(25_000, 6)).toEqual({ minVehicleClass: 'bike', catering: false });
    expect(vehicleRequirement(20_000, 7)).toEqual({ minVehicleClass: 'tuktuk', catering: false });
    expect(vehicleRequirement(25_250, 2)).toEqual({ minVehicleClass: 'tuktuk', catering: false });
    expect(vehicleRequirement(60_000, 40)).toEqual({ minVehicleClass: 'tuktuk', catering: false });
    expect(vehicleRequirement(60_250, 3)).toEqual({ minVehicleClass: 'car', catering: false });
    expect(vehicleRequirement(100_250, 40)).toEqual({ minVehicleClass: 'car', catering: true });
  });
});

describe('pause windows (review A.1)', () => {
  const friday = [{ dow: 5, start: '11:45', end: '13:15' }];

  it('reads local Baghdad time', () => {
    expect(localDowMinutes(new Date('2026-10-02T08:45:00Z'), 'Asia/Baghdad')).toEqual({ dow: 5, minutes: 11 * 60 + 45 });
  });

  it('Friday prayer 11:45–13:15 local, start inclusive, end exclusive', () => {
    expect(activePauseWindow(new Date('2026-10-02T08:44:59Z'), friday, 'Asia/Baghdad')).toBeNull();
    expect(activePauseWindow(new Date('2026-10-02T08:45:00Z'), friday, 'Asia/Baghdad')).not.toBeNull();
    expect(activePauseWindow(new Date('2026-10-02T10:14:00Z'), friday, 'Asia/Baghdad')).not.toBeNull();
    expect(activePauseWindow(new Date('2026-10-02T10:15:00Z'), friday, 'Asia/Baghdad')).toBeNull();
    expect(activePauseWindow(new Date('2026-10-03T09:00:00Z'), friday, 'Asia/Baghdad')).toBeNull(); // Saturday
  });

  it('windows may wrap midnight', () => {
    const late = [{ dow: 4, start: '23:00', end: '01:00' }];
    expect(activePauseWindow(new Date('2026-10-01T20:30:00Z'), late, 'Asia/Baghdad')).not.toBeNull(); // Thu 23:30
    expect(activePauseWindow(new Date('2026-10-01T21:30:00Z'), late, 'Asia/Baghdad')).not.toBeNull(); // Fri 00:30
    expect(activePauseWindow(new Date('2026-10-01T22:30:00Z'), late, 'Asia/Baghdad')).toBeNull(); // Fri 01:30
  });
});

describe('points (domain §3, edge-case §2)', () => {
  it('earn on platform revenue, 1 per 100 (rides 1 per 200), capped at 50', () => {
    expect(orderPoints({ type: 'food', platformRevenueIqd: 2750 })).toBe(27);
    expect(orderPoints({ type: 'food', platformRevenueIqd: 9000 })).toBe(50);
    expect(orderPoints({ type: 'ride', platformRevenueIqd: 600 })).toBe(3);
  });

  it('per-line points go to the tagged participant, untagged and remainder to the orderer, +10 % organiser', () => {
    const alloc = allocatePoints({
      type: 'food',
      ordererId: 'p_org',
      basePoints: 30,
      lines: [
        { participantId: 'par_a', valueIqd: 10_000, pointsEligible: true },
        { participantId: 'par_b', valueIqd: 5_000, pointsEligible: true },
        { participantId: null, valueIqd: 5_000, pointsEligible: true },
        { participantId: 'par_a', valueIqd: 9_999, pointsEligible: false },
      ],
      participants: [
        { id: 'par_a', role: 'diner', personId: 'p_a', phoneHash: 'h_a' },
        { id: 'par_b', role: 'diner', personId: null, phoneHash: 'h_b' },
      ],
    });
    expect(alloc).toEqual([
      { personId: 'p_a', phoneHash: null, participantId: 'par_a', points: 15, organizerBonus: false, pending: false },
      { personId: null, phoneHash: 'h_b', participantId: 'par_b', points: 7, organizerBonus: false, pending: true },
      { personId: 'p_org', phoneHash: null, participantId: null, points: 8, organizerBonus: false, pending: false },
      { personId: 'p_org', phoneHash: null, participantId: null, points: 3, organizerBonus: true, pending: false },
    ]);
    expect(alloc.filter((a) => !a.organizerBonus).reduce((s, a) => s + a.points, 0)).toBe(30);
  });

  it('review M: the per-order cap of 50 includes the organiser bonus', () => {
    const alloc = allocatePoints({
      type: 'food',
      ordererId: 'p_org',
      basePoints: 50,
      lines: [{ participantId: 'par_a', valueIqd: 10_000, pointsEligible: true }],
      participants: [{ id: 'par_a', role: 'diner', personId: 'p_a', phoneHash: 'h_a' }],
    });
    expect(alloc.reduce((s, a) => s + a.points, 0)).toBe(50);
    expect(alloc.find((a) => a.organizerBonus)?.points).toBe(5);
  });

  it('M2 follow-up: a solo order earns no organiser bonus, like the ledger (group orders only, shared cap 50)', () => {
    const solo = allocatePoints({ type: 'food', ordererId: 'p_org', basePoints: 30, lines: [{ participantId: null, valueIqd: 10_000, pointsEligible: true }], participants: [] });
    expect(solo).toEqual([{ personId: 'p_org', phoneHash: null, participantId: null, points: 30, organizerBonus: false, pending: false }]);
    // Tagging a line to the orderer himself is still a solo order.
    const self = allocatePoints({
      type: 'food',
      ordererId: 'p_org',
      basePoints: 50,
      lines: [{ participantId: 'par_me', valueIqd: 10_000, pointsEligible: true }],
      participants: [{ id: 'par_me', role: 'diner', personId: 'p_org', phoneHash: 'h_me' }],
    });
    expect(self.some((a) => a.organizerBonus)).toBe(false);
    expect(self.reduce((s, a) => s + a.points, 0)).toBe(50);
    // Rides never carry the bonus on the ledger either.
    const ride = allocatePoints({ type: 'ride', ordererId: 'p_org', basePoints: 20, lines: [], participants: [{ id: 'par_r', role: 'rider', personId: 'p_r', phoneHash: null }] });
    expect(ride.some((a) => a.organizerBonus)).toBe(false);
    expect(ride.reduce((s, a) => s + a.points, 0)).toBe(20);
  });

  it('M2 follow-up: orders and the ledger agree on the organiser bonus for solo and group orders', () => {
    const cases = [
      { participants: [] as Array<{ personId?: string; phoneHash?: string; itemsIqd: number }>, tagged: [] as Array<{ id: string; personId: string | null; phoneHash: string | null; valueIqd: number }> },
      { participants: [{ personId: 'p_a', itemsIqd: 10_000 }], tagged: [{ id: 'par_a', personId: 'p_a', phoneHash: null, valueIqd: 10_000 }] },
      { participants: [{ phoneHash: 'h_b', itemsIqd: 5_000 }], tagged: [{ id: 'par_b', personId: null, phoneHash: 'h_b', valueIqd: 5_000 }] },
    ];
    for (const c of cases) {
      const base = 50;
      const ledger = postPoints({
        groupId: 'g',
        occurredAt: new Date(0),
        refs: {},
        points: base,
        ordererId: 'p_org',
        recipients: orderPointRecipients({ customerId: 'p_org', itemsSubtotalIqd: 20_000, participants: c.participants }),
        rules: AZIZIYAH_MONEY_RULES,
      });
      const ledgerBonus = ledger?.lines.filter((l) => l.type === 'organizer_bonus').reduce((s, l) => s + l.amount, 0) ?? 0;
      const orders = allocatePoints({
        type: 'food',
        ordererId: 'p_org',
        basePoints: base,
        lines: [...c.tagged.map((t) => ({ participantId: t.id, valueIqd: t.valueIqd, pointsEligible: true })), { participantId: null, valueIqd: 20_000 - c.tagged.reduce((s, t) => s + t.valueIqd, 0), pointsEligible: true }],
        participants: c.tagged.map((t) => ({ id: t.id, role: 'diner', personId: t.personId, phoneHash: t.phoneHash })),
      });
      const ordersBonus = orders.filter((a) => a.organizerBonus).reduce((s, a) => s + a.points, 0);
      expect(ordersBonus, JSON.stringify(c.participants)).toBe(ledgerBonus);
      expect(orders.reduce((s, a) => s + a.points, 0)).toBeLessThanOrEqual(50);
    }
  });

  it('rides: the rider earns, not the person who booked (ride for someone else)', () => {
    const alloc = allocatePoints({ type: 'ride', ordererId: 'p_org', basePoints: 4, lines: [], participants: [{ id: 'par_r', role: 'rider', personId: null, phoneHash: 'h_r' }] });
    expect(alloc[0]).toMatchObject({ phoneHash: 'h_r', points: 4, pending: true });
  });
});
