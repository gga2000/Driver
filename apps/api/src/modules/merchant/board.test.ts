import { describe, expect, it } from 'vitest';
import type { Order, Trip } from '@driver/contracts';
import { boardColumn, courierView, groupLines, MISSED_LIST_MAX, missedReason, missedSummary, modifierNames, sortBoard, ticketNumber, toBoardOrder } from './board.js';
import { busyUntilFor, toStoreStatus } from './status.js';

const T0 = new Date('2026-10-03T17:00:00Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);

function order(patch: Partial<Order> = {}): Order {
  return {
    id: 'ord_1',
    cityId: 'aziziyah',
    type: 'food',
    state: 'placed',
    ordererId: 'c1',
    merchantOrgId: 'rest_1',
    householdOrgId: null,
    quoteId: null,
    paymentMethod: 'cash',
    itemsTotalIqd: 14000,
    deliveryFeeIqd: 1000,
    serviceFeeIqd: 500,
    discountIqd: 0,
    tipIqd: 0,
    totalIqd: 15500,
    minVehicleClass: 'bike',
    cateringRequest: false,
    lines: [
      { id: 'l1', catalogItemId: 'tikka', freeText: null, qty: 2, unitPriceIqd: 2500, modifiers: [{ groupId: 'g', modifierId: 'm', nameAr: 'صمون', priceIqd: 0 }], participantId: null, note: 'بدون بصل', pointsEligible: true, availability: 'available' },
      { id: 'l2', catalogItemId: 'kebab', freeText: null, qty: 1, unitPriceIqd: 7000, modifiers: [{ nameAr: 'نفر إضافي', priceIqd: 2000 }], participantId: 'p_a', note: null, pointsEligible: true, availability: 'available' },
      { id: 'l3', catalogItemId: null, freeText: 'خبز زيادة', qty: 1, unitPriceIqd: 0, modifiers: [], participantId: 'p_b', note: '  ', pointsEligible: true, availability: 'removed' },
    ],
    participants: [
      { id: 'p_a', role: 'diner', personId: null, phoneOnly: true, label: 'أبو حسين', note: 'حار هواي' },
      { id: 'p_b', role: 'diner', personId: null, phoneOnly: true, label: 'الصغير', note: null },
    ],
    partial: null,
    scheduledFor: null,
    merchantOfferedAt: T0,
    promisedReadyAt: null,
    placedAt: T0,
    acceptedAt: null,
    preparingAt: null,
    readyAt: null,
    pickedUpAt: null,
    deliveredAt: null,
    closedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    cancellationFeeIqd: 0,
    refundState: 'none',
    note: 'دگ الجرس مرتين',
    ...patch,
  };
}

const NAMES = new Map([
  ['tikka', 'لفة تكة'],
  ['kebab', 'وجبة كباب'],
]);
const NOBODY = { courier: { state: 'none' as const, firstName: null, vehicleClass: null, etaMinutes: null, arrivedAt: null } };

describe('merchant board — columns and numbers', () => {
  it('maps order states to the three columns and drops everything past the counter', () => {
    expect(boardColumn('placed')).toBe('new');
    expect(boardColumn('merchant_accepted')).toBe('preparing');
    expect(boardColumn('preparing')).toBe('preparing');
    expect(boardColumn('ready')).toBe('ready');
    for (const s of ['picked_up', 'delivered', 'merchant_rejected', 'customer_cancelled'] as const) expect(boardColumn(s)).toBeNull();
  });

  it('gives each order a stable four-digit ticket number', () => {
    expect(ticketNumber('ord_abc')).toMatch(/^\d{4}$/);
    expect(ticketNumber('ord_abc')).toBe(ticketNumber('ord_abc'));
    const seen = new Set(Array.from({ length: 50 }, (_, i) => ticketNumber(`ord_${i}`)));
    expect(seen.size).toBeGreaterThan(45);
  });
});

describe('merchant board — grouping by person', () => {
  it('puts the orderer first, then each tagged person; names, modifiers, notes and totals', () => {
    const groups = groupLines(order(), NAMES);
    expect(groups.map((g) => [g.kind, g.label, g.itemCount])).toEqual([
      ['orderer', null, 2],
      ['participant', 'أبو حسين', 1],
    ]);
    const [mine, abu] = groups;
    expect(mine!.lines[0]).toMatchObject({ name: 'لفة تكة', qty: 2, modifiers: ['صمون'], note: 'بدون بصل', unitPriceIqd: 2500, totalIqd: 5000 });
    expect(abu).toMatchObject({ note: 'حار هواي' });
    expect(abu!.lines[0]).toMatchObject({ name: 'وجبة كباب', unitPriceIqd: 9000, totalIqd: 9000, modifiers: ['نفر إضافي'] });
  });

  it('keeps a person whose lines are only partly removed, drops one with nothing left', () => {
    const o = order();
    o.lines[2]!.availability = 'unavailable';
    const groups = groupLines(o, NAMES);
    expect(groups.map((g) => g.label)).toEqual([null, 'أبو حسين', 'الصغير']);
    expect(groups[2]!.lines[0]).toMatchObject({ name: 'خبز زيادة', note: null, availability: 'unavailable' });
  });

  it('reads modifier names defensively', () => {
    expect(modifierNames([{ nameAr: ' حار ' }, { nameAr: '' }, null, 'x', { priceIqd: 500 }])).toEqual(['حار']);
  });
});

describe('merchant board — cards', () => {
  it('a new order carries the 90-s deadline, cash to collect and the item count', () => {
    const card = toBoardOrder({ order: order(), itemNames: NAMES, ...NOBODY, acceptWindowSec: 90, now: min(0.5) })!;
    expect(card).toMatchObject({ column: 'new', collectCashIqd: 15500, itemCount: 3, note: 'دگ الجرس مرتين', late: false, prepMinutes: null });
    expect(card.acceptBy).toEqual(new Date(T0.getTime() + 90_000));
  });

  it('a preparing order knows its committed prep time and turns late after the promise', () => {
    const o = order({ state: 'preparing', paymentMethod: 'prepaid', acceptedAt: min(1), promisedReadyAt: min(26) });
    const onTime = toBoardOrder({ order: o, itemNames: NAMES, ...NOBODY, acceptWindowSec: 90, now: min(20) })!;
    expect(onTime).toMatchObject({ column: 'preparing', prepMinutes: 25, collectCashIqd: 0, acceptBy: null, late: false });
    expect(toBoardOrder({ order: o, itemNames: NAMES, ...NOBODY, acceptWindowSec: 90, now: min(27) })!.late).toBe(true);
  });

  it('sorts new by deadline, preparing by promise, ready by ready time', () => {
    const mk = (id: string, patch: Partial<Order>) => toBoardOrder({ order: order({ id, ...patch }), itemNames: NAMES, ...NOBODY, acceptWindowSec: 90, now: T0 })!;
    const sorted = sortBoard([
      mk('r', { state: 'ready', readyAt: min(3) }),
      mk('p2', { state: 'preparing', acceptedAt: min(0), promisedReadyAt: min(30) }),
      mk('n2', { merchantOfferedAt: min(2) }),
      mk('p1', { state: 'merchant_accepted', acceptedAt: min(0), promisedReadyAt: min(10) }),
      mk('n1', { merchantOfferedAt: min(1) }),
    ]);
    expect(sorted.map((o) => o.id)).toEqual(['n1', 'n2', 'p1', 'p2', 'r']);
  });
});

describe('merchant board — courier state', () => {
  const stops = (pickupState: 'pending' | 'arrived' | 'completed') =>
    [{ id: 's1', orderId: 'ord_1', type: 'pickup', state: pickupState, arrivedAt: pickupState === 'pending' ? null : min(4) }] as unknown as Trip['stops'];

  it('searching → on the way (minutes from the ETA service) → arrived → picked up', () => {
    expect(courierView('ord_1', { trip: null, firstName: null, vehicleClass: null, etaMinutes: null }).state).toBe('none');
    expect(courierView('ord_1', { trip: { state: 'offered', courierId: null, stops: [] }, firstName: null, vehicleClass: null, etaMinutes: null }).state).toBe('searching');
    const coming = courierView('ord_1', { trip: { state: 'en_route_to_pickup', courierId: 'd1', stops: stops('pending') }, firstName: 'حيدر', vehicleClass: 'bike', etaMinutes: 4 });
    expect(coming).toMatchObject({ state: 'on_the_way', firstName: 'حيدر', vehicleClass: 'bike', etaMinutes: 4 });
    const here = courierView('ord_1', { trip: { state: 'arrived_pickup', courierId: 'd1', stops: stops('arrived') }, firstName: 'حيدر', vehicleClass: 'bike', etaMinutes: null });
    expect(here).toMatchObject({ state: 'arrived', arrivedAt: min(4), etaMinutes: null });
    expect(courierView('ord_1', { trip: { state: 'in_transit', courierId: 'd1', stops: stops('completed') }, firstName: 'حيدر', vehicleClass: 'bike', etaMinutes: null }).state).toBe('picked_up');
  });

  it('S-M4: carries his plate once he has the trip, so the counter knows whom to hand it to', () => {
    const here = courierView('ord_1', { trip: { state: 'arrived_pickup', courierId: 'd1', stops: stops('arrived') }, firstName: 'حيدر', vehicleClass: 'bike', etaMinutes: null, plate: 'واسط 45671' });
    expect(here).toMatchObject({ state: 'arrived', firstName: 'حيدر', plate: 'واسط 45671' });
    expect(courierView('ord_1', { trip: { state: 'offered', courierId: null, stops: [] }, firstName: null, vehicleClass: null, etaMinutes: null, plate: 'x' }).plate).toBeNull();
  });

  it('S-M4: a ready card says when the kitchen handed it over ("سلّمته")', () => {
    const ready = order({ state: 'ready', acceptedAt: min(1), promisedReadyAt: min(11), readyAt: min(10) });
    const nobody = { state: 'none' as const, firstName: null, vehicleClass: null, etaMinutes: null, arrivedAt: null };
    expect(toBoardOrder({ order: ready, itemNames: NAMES, courier: nobody, acceptWindowSec: 90, now: min(12) })!.handedOverAt).toBeNull();
    expect(toBoardOrder({ order: { ...ready, handedOverAt: min(13) }, itemNames: NAMES, courier: nobody, acceptWindowSec: 90, now: min(14) })!.handedOverAt).toEqual(min(13));
  });
});

describe('merchant store status', () => {
  const base = { merchantOrgId: 'rest_1', name: 'مطعم خالد', now: T0, busyUntil: null, closed: null, printer: null, pause: null, lastHeartbeatAt: null, defaultPrepMinutes: 20 };

  it('busy mode lasts an hour and reads as off once it has passed', () => {
    const until = busyUntilFor(true, T0)!;
    expect(until).toEqual(min(60));
    expect(busyUntilFor(false, T0)).toBeNull();
    expect(toStoreStatus({ ...base, busyUntil: until }).busy).toEqual({ on: true, until, extraPrepMinutes: 10 });
    expect(toStoreStatus({ ...base, now: min(61), busyUntil: until }).busy).toEqual({ on: false, until: null, extraPrepMinutes: 0 });
  });

  it('closed by hand or inside a pause window is not open; printer defaults to not set up', () => {
    expect(toStoreStatus(base)).toMatchObject({ open: true, closed: null, pause: null, printer: { state: 'not_set_up' } });
    expect(toStoreStatus({ ...base, closed: { reason: 'power_cut', note: null, at: T0 } })).toMatchObject({ open: false, closed: { reason: 'power_cut' } });
    expect(toStoreStatus({ ...base, closed: { reason: 'weird', note: 'x', at: T0 } }).closed?.reason).toBe('other');
    expect(toStoreStatus({ ...base, pause: { reason: 'صلاة الجمعة', end: '13:15' } })).toMatchObject({ open: false, pause: { reason: 'صلاة الجمعة', until: '13:15' } });
    expect(toStoreStatus({ ...base, printer: { state: 'disconnected', name: 'XP-80', at: T0 } }).printer).toEqual({ state: 'disconnected', name: 'XP-80', updatedAt: T0 });
  });
});

describe('merchant board — "+5 د" and missed orders (UI/UX audit M-12, M-01)', () => {
  const NOBODY = { courier: { state: 'none' as const, firstName: null, vehicleClass: null, etaMinutes: null, arrivedAt: null } };

  it('a preparing card says whether the one "+5 د" was used', () => {
    const accepted = order({ state: 'merchant_accepted', acceptedAt: min(1), promisedReadyAt: min(16) });
    expect(toBoardOrder({ order: accepted, itemNames: NAMES, ...NOBODY, acceptWindowSec: 90, now: min(2) })!.prepExtended).toBe(false);
    const extended = { ...accepted, promisedReadyAt: min(21), prepExtendedAt: min(5) };
    const card = toBoardOrder({ order: extended, itemNames: NAMES, ...NOBODY, acceptWindowSec: 90, now: min(6) })!;
    expect(card.prepExtended).toBe(true);
    expect(card.prepMinutes).toBe(20);
  });

  it('only orders that left without the kitchen answering are misses', () => {
    expect(missedReason({ state: 'merchant_rejected', cancellationReason: 'merchant_timeout' })).toBe('merchant_timeout');
    expect(missedReason({ state: 'platform_cancelled', cancellationReason: 'partial_timeout' })).toBe('partial_timeout');
    expect(missedReason({ state: 'merchant_rejected', cancellationReason: 'sold_out' })).toBeNull();
    expect(missedReason({ state: 'customer_cancelled', cancellationReason: null })).toBeNull();
    expect(missedReason({ state: 'merchant_accepted', cancellationReason: null })).toBeNull();
  });

  it("today's misses: newest first, what happened, whether it counts; the count is the kitchen's own", () => {
    const timeout = (id: string, at: number, extra: Partial<Order> = {}) => order({ id, state: 'merchant_rejected', cancellationReason: 'merchant_timeout', placedAt: min(at - 1.5), cancelledAt: min(at), ...extra });
    const orders = [
      timeout('ord_a', 10),
      order({ id: 'ord_b', state: 'platform_cancelled', cancellationReason: 'partial_timeout', placedAt: min(18), cancelledAt: min(20) }),
      timeout('ord_c', 30),
      order({ id: 'ord_d', state: 'merchant_rejected', cancellationReason: 'too_busy', cancelledAt: min(31) }),
      order({ id: 'ord_e', state: 'delivered' }),
    ];
    const inPause = (at: Date) => at.getTime() === min(30).getTime();
    const s = missedSummary(orders, inPause);
    expect(s.today).toBe(2);
    expect(s.orders.map((m) => [m.orderId, m.reason, m.scored])).toEqual([
      ['ord_c', 'merchant_timeout', false],
      ['ord_b', 'partial_timeout', false],
      ['ord_a', 'merchant_timeout', true],
    ]);
    // Removed lines don't count as items (l3 was removed): 2 + 1.
    expect(s.orders[2]).toMatchObject({ number: ticketNumber('ord_a'), missedAt: min(10), placedAt: min(8.5), itemCount: 3, totalIqd: 15500 });
  });

  it('lists at most a few, but counts the whole day', () => {
    const many = Array.from({ length: MISSED_LIST_MAX + 3 }, (_, i) => order({ id: `ord_${i}`, state: 'merchant_rejected', cancellationReason: 'merchant_timeout', cancelledAt: min(i) }));
    const s = missedSummary(many, () => false);
    expect(s.today).toBe(MISSED_LIST_MAX + 3);
    expect(s.orders).toHaveLength(MISSED_LIST_MAX);
    expect(s.orders[0]!.orderId).toBe(`ord_${MISSED_LIST_MAX + 2}`);
  });
});
