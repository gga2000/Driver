import { describe, expect, it } from 'vitest';
import { DriverError, EMPTY_HOME_TALLY, slotKey, type HomeSale, type ReserveRule } from '@driver/contracts';
import { ledgerHarness } from '../ledger/test-harness.js';
import { homeOrderProblem, type HomeOrderLine } from './home-kitchen.js';
import { staffHarness } from './staff-harness.js';
import { HOME, ordersHarness } from './test-harness.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

const MIN = 60_000;
/** The harness's start: Saturday 2026-10-03 12:00 Baghdad. */
const NOW = new Date('2026-10-03T09:00:00Z');
/** 18:00 Baghdad tonight, one of the reserve dish's times (6 h ahead). */
const TONIGHT = new Date('2026-10-03T15:00:00Z');

const RULE: ReserveRule = { aheadMin: 240, days: [0, 1, 2, 3, 4, 5, 6], times: ['13:00', '18:00'], maxPerSlot: 4 };
const READY: HomeSale = { mode: 'ready', cooked: 10, cookedOn: '2026-10-03', setAt: null };
const RESERVE: HomeSale = { mode: 'reserve', rule: RULE };

const ready = (qty: number, stock = 5, itemId = 'dolma'): HomeOrderLine => ({ itemId, qty, sale: READY, stock });
const reserve = (qty: number, itemId = 'biryani'): HomeOrderLine => ({ itemId, qty, sale: RESERVE, stock: null });

describe('homeOrderProblem (أكل بيت cart rules)', () => {
  it('a valid ready order now and a valid reservation at her time go in', () => {
    expect(homeOrderProblem([ready(2), ready(1, 5, 'kubba')], null, NOW, EMPTY_HOME_TALLY)).toBeNull();
    expect(homeOrderProblem([reserve(4)], TONIGHT, NOW, EMPTY_HOME_TALLY)).toBeNull();
    expect(homeOrderProblem([], null, NOW, EMPTY_HOME_TALLY)).toBeNull();
  });

  it('ready and reserved dishes never share an order; a dish with no home sale is refused too', () => {
    expect(homeOrderProblem([ready(1), reserve(1)], TONIGHT, NOW, EMPTY_HOME_TALLY)).toBe('order_schedule_invalid');
    expect(homeOrderProblem([ready(1), reserve(1)], null, NOW, EMPTY_HOME_TALLY)).toBe('order_schedule_invalid');
    expect(homeOrderProblem([{ itemId: 'x', qty: 1, sale: null, stock: null }], null, NOW, EMPTY_HOME_TALLY)).toBe('order_schedule_invalid');
  });

  it('a ready dish comes now: a time on it is refused', () => {
    expect(homeOrderProblem([ready(1)], TONIGHT, NOW, EMPTY_HOME_TALLY)).toBe('order_schedule_invalid');
  });

  it('a ready dish is refused past the plates left, counting lines of the same dish and plates sold today', () => {
    expect(homeOrderProblem([ready(6)], null, NOW, EMPTY_HOME_TALLY)).toBe('catalog_item_unavailable');
    expect(homeOrderProblem([ready(3), ready(3)], null, NOW, EMPTY_HOME_TALLY)).toBe('catalog_item_unavailable');
    const sold = { slots: new Map(), sold: new Map([['dolma', [{ at: new Date('2026-10-03T08:00:00Z'), qty: 3 }]]]) };
    expect(homeOrderProblem([ready(2)], null, NOW, sold)).toBeNull();
    expect(homeOrderProblem([ready(3)], null, NOW, sold)).toBe('catalog_item_unavailable');
    // Cooked yesterday: nothing left today.
    expect(homeOrderProblem([{ ...ready(1), sale: { ...READY, cookedOn: '2026-10-02' } }], null, NOW, EMPTY_HOME_TALLY)).toBe('catalog_item_unavailable');
  });

  it('a reservation needs one of the dish own times, inside the booking lead and the week', () => {
    expect(homeOrderProblem([reserve(1)], null, NOW, EMPTY_HOME_TALLY)).toBe('order_schedule_invalid');
    expect(homeOrderProblem([reserve(1)], new Date('2026-10-03T15:30:00Z'), NOW, EMPTY_HOME_TALLY)).toBe('order_schedule_invalid'); // 18:30: not her time
    expect(homeOrderProblem([reserve(1)], new Date('2026-10-03T10:00:00Z'), NOW, EMPTY_HOME_TALLY)).toBe('order_schedule_invalid'); // 13:00 today: inside 4 h
    expect(homeOrderProblem([reserve(1)], new Date('2026-10-12T15:00:00Z'), NOW, EMPTY_HOME_TALLY)).toBe('order_schedule_invalid'); // past the week
  });

  it('a reservation over the plates she takes at that time is refused (booked plates counted)', () => {
    expect(homeOrderProblem([reserve(5)], TONIGHT, NOW, EMPTY_HOME_TALLY)).toBe('order_schedule_invalid');
    const booked = { slots: new Map([['biryani', new Map([[slotKey(TONIGHT), 3]])]]), sold: new Map() };
    expect(homeOrderProblem([reserve(1)], TONIGHT, NOW, booked)).toBeNull();
    expect(homeOrderProblem([reserve(2)], TONIGHT, NOW, booked)).toBe('order_schedule_invalid');
    // Another time of the same dish is still free.
    expect(homeOrderProblem([reserve(4)], new Date('2026-10-04T15:00:00Z'), NOW, booked)).toBeNull();
  });
});

type Harness = ReturnType<typeof ordersHarness>;

/** Makes the harness's rest_1 a home kitchen (always open) with one ready and one reserve dish. */
async function homeKitchen(h: Harness): Promise<void> {
  await h.catalog.saveStorefront({ orgId: 'rest_1', cityId: 'aziziyah', nameAr: 'مطبخ أم حسين', cuisineAr: 'أكل بيت', minOrderIqd: 0, home: { monogram: null } });
  await h.catalog.addItem({ id: 'dolma', orgId: 'rest_1', nameAr: 'دولمة', priceIqd: 6000, stock: 5, homeSale: READY });
  await h.catalog.addItem({ id: 'biryani', orgId: 'rest_1', nameAr: 'برياني', priceIqd: 8000, homeSale: RESERVE });
}

const readyInput = (h: Harness, qty = 2) => h.foodInput({ lines: [{ catalogItemId: 'dolma', qty, unitPriceIqd: 6000 }] });
const reserveInput = (h: Harness, qty = 2, at = TONIGHT) => h.foodInput({ lines: [{ catalogItemId: 'biryani', qty, unitPriceIqd: 8000 }], scheduledFor: at });

/**
 * The orders harness binds no `STOREFRONT_HOME` (absent = open); the module binds the city switch. A
 * test stands one in on the service's optional dependency.
 */
function setCitySwitch(h: Harness, open: (cityId: string) => boolean): void {
  Object.assign(h.orders, { homeOpen: { open } });
}

describe('orders.place at a home kitchen', () => {
  it('ready now and a reservation at her time both go in; the cart rules run on the server', async () => {
    const h = ordersHarness();
    await homeKitchen(h);
    expect((await h.orders.place('c1', readyInput(h))).state).toBe('placed');
    const r = await h.orders.place('c1', reserveInput(h));
    expect(r.scheduledFor).toEqual(TONIGHT);
    expect(await code(h.orders.place('c1', reserveInput(h, 1, new Date('2026-10-03T15:30:00Z'))))).toBe('order_schedule_invalid');
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'dolma', qty: 1, unitPriceIqd: 6000 }], scheduledFor: TONIGHT })))).toBe('order_schedule_invalid');
  });

  it('plates already ordered count: ready plates left today and plates per pickup time', async () => {
    const h = ordersHarness();
    await homeKitchen(h);
    // Same clock throughout: an order placed in the same millisecond counts too.
    await h.orders.place('c1', readyInput(h, 3));
    // Stock still says 5, but 3 of them went at 12:00: 2 left.
    expect(await code(h.orders.place('c2', readyInput(h, 3)))).toBe('catalog_item_unavailable');
    expect((await h.orders.place('c2', readyInput(h, 2))).state).toBe('placed');
    await h.orders.place('c1', reserveInput(h, 3));
    expect(await code(h.orders.place('c2', reserveInput(h, 2)))).toBe('order_schedule_invalid');
    expect((await h.orders.place('c2', reserveInput(h, 1))).state).toBe('placed');
  });

  it('two orders at once for the last ready plate: exactly one is placed, the other is refused', async () => {
    const h = ordersHarness();
    await homeKitchen(h);
    await h.orders.place('c1', readyInput(h, 4));
    const results = await Promise.all([code(h.orders.place('c2', readyInput(h, 1))), code(h.orders.place('c3', readyInput(h, 1)))]);
    expect(results.sort()).toEqual(['catalog_item_unavailable', 'ok']);
    const placed = (await h.repo.merchantOrdersBetween('rest_1', new Date(0), new Date(h.clock.now().getTime() + 1))).filter((a) => a.order.ordererId !== 'c1');
    expect(placed).toHaveLength(1);
  });

  it('two orders at once for the last place at a reservation time: exactly one is placed, the other is refused', async () => {
    const h = ordersHarness();
    await homeKitchen(h);
    await h.orders.place('c1', reserveInput(h, 3));
    const results = await Promise.all([code(h.orders.place('c2', reserveInput(h, 1))), code(h.orders.place('c3', reserveInput(h, 1)))]);
    expect(results.sort()).toEqual(['ok', 'order_schedule_invalid']);
    const placed = (await h.repo.merchantOrdersBetween('rest_1', new Date(0), new Date(h.clock.now().getTime() + 1))).filter((a) => a.order.ordererId !== 'c1');
    expect(placed).toHaveLength(1);
  });

  it('a reservation is refused with home_reservation_owed while his own wallet is below 0; a ready order is not', async () => {
    const h = ordersHarness();
    await homeKitchen(h);
    h.wallets.set('customer:c1', -16_000);
    expect(await code(h.orders.place('c1', reserveInput(h)))).toBe('home_reservation_owed');
    expect(await code(h.orders.place('c1', readyInput(h)))).not.toBe('home_reservation_owed');
    // Paid back to 0: he can book again.
    h.wallets.set('customer:c1', 0);
    expect((await h.orders.place('c1', reserveInput(h))).state).toBe('placed');
  });

  it('a no-show owed by a household stops a reservation paid from that household', async () => {
    const h = ordersHarness();
    await homeKitchen(h);
    h.wallets.set('household:hh1', -20_000);
    expect(await code(h.orders.place('c1', { ...reserveInput(h), householdOrgId: 'hh1' }))).toBe('home_reservation_owed');
    // His own wallet is clear: a reservation he pays himself goes in.
    expect((await h.orders.place('c1', reserveInput(h, 1))).state).toBe('placed');
  });

  it('a negative wallet does not stop a pre-order at an ordinary restaurant', async () => {
    const h = ordersHarness();
    h.wallets.set('customer:c1', -16_000);
    const o = await h.orders.place('c1', h.foodInput({ scheduledFor: new Date(h.clock.now().getTime() + 3 * 60 * MIN) }));
    expect(o.state).toBe('placed');
  });

  it('city switch off (homeKitchens.launched): every home order is service_paused, restaurants unaffected', async () => {
    const h = ordersHarness();
    await homeKitchen(h);
    await h.merchants.add('rest_2', { location: { zoneKey: 'centre', pin: { lat: 32.9105, lng: 45.0665 } } });
    const asked: string[] = [];
    setCitySwitch(h, (cityId) => (asked.push(cityId), false));
    expect(await code(h.orders.place('c1', readyInput(h)))).toBe('service_paused');
    expect(await code(h.orders.place('c1', reserveInput(h)))).toBe('service_paused');
    expect(asked).toEqual(['aziziyah', 'aziziyah']);
    // The switch is checked before the debt rule (a closed city says closed, not owed).
    h.wallets.set('customer:c1', -1000);
    expect(await code(h.orders.place('c1', reserveInput(h)))).toBe('service_paused');
    h.wallets.set('customer:c1', 0);
    expect((await h.orders.place('c1', h.foodInput({ merchantOrgId: 'rest_2' }))).state).toBe('placed');
    setCitySwitch(h, () => true);
    expect((await h.orders.place('c1', readyInput(h))).state).toBe('placed');
  });
});

describe('home reservation no-show (unreachable at the door)', () => {
  const make = () => staffHarness({}, { ledger: ledgerHarness() });

  /** Accepts, carries and fails an order at the door after the unreachable protocol. */
  async function unreachable(h: ReturnType<typeof make>, orderId: string) {
    await h.orders.merchantAccept('m1', { orderId, prepMinutes: 15 });
    const t = await h.tripFor(orderId);
    await h.pickup(t.id);
    const drop = (await h.trips.get(t.id)).stops.find((s) => s.type === 'dropoff')!;
    await h.trips.arrive(t.id, drop.id, 'd1', { pin: HOME });
    await h.trips.startUnreachable(t.id, drop.id, 'd1');
    await h.advance(5 * MIN);
    await h.trips.fail(t.id, { personId: 'd1', role: 'driver' } as never);
    await h.deliver();
    return t;
  }

  it('the order fails, the cook is paid in full and the courier gets the delivery fee; he owes both; a replay posts nothing', async () => {
    const h = make();
    await homeKitchen(h);
    const o = await h.orders.place('c1', reserveInput(h));
    expect(o.itemsTotalIqd).toBe(16_000);
    await h.advance(TONIGHT.getTime() - h.clock.now().getTime() - 5 * MIN);
    await unreachable(h, o.id);
    await h.settle();

    const after = await h.orders.get(o.id);
    expect(after.state).toBe('failed');
    expect(h.events.last('order.disputed')).toBeUndefined();
    const lines = (await h.ledger.eventsForOrder(o.id)).filter((e) => e.postingGroupId === `order:${o.id}:home_no_show`);
    const fee = o.deliveryFeeIqd;
    expect(fee).toBeGreaterThan(0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ type: 'cancellation_fee', amount: 16_000, fromAccount: 'customer:c1', toAccount: 'merchant_cash:rest_1', memo: 'home_no_show' });
    // The courier on the trip that gave up: his earnings, never his cash account.
    expect(lines[1]).toMatchObject({ type: 'delivery_fee', amount: fee, fromAccount: 'customer:c1', toAccount: 'driver:d1', memo: 'home_no_show' });
    expect(h.events.last('order.failed')?.payload).toMatchObject({ kind: 'home_no_show', owedIqd: 16_000 + fee });
    expect(await h.balance('customer:c1')).toBe(-(16_000 + fee));
    expect(await h.balance('cash:d1')).toBe(0);
    const total = (await h.ledger.eventsForOrder(o.id)).length;

    // A replayed failure event: the order is already failed, nothing moves.
    const failedEvents = h.tripEvents.events.filter((e) => e.type === 'trip.failed' || e.type === 'trip.order_failed');
    expect(failedEvents.length).toBeGreaterThan(0);
    for (const e of failedEvents) await h.orders.onTripEvent({ type: e.type, tripId: e.tripId!, actorId: e.actorId, occurredAt: e.occurredAt, ...(e.orderId ? { orderId: e.orderId } : {}), payload: e.payload });
    // And the posting itself run twice for the same order (an outbox retry): the group is already there.
    expect(await h.uow.run((tx) => h.staff.homeNoShow(after as never, tx))).toBe(0);
    await h.settle();
    expect(await h.ledger.eventsForOrder(o.id)).toHaveLength(total);
    expect(await h.balance('customer:c1')).toBe(-(16_000 + fee));
    expect((await h.orders.get(o.id)).state).toBe('failed');
  });

  /** A failed home reservation as homeNoShow sees it: 16,000 of dishes, a 2,000 delivery fee. */
  const noShowOrder = (id: string, extra: Record<string, unknown> = {}) =>
    ({ id, type: 'food', merchantOrgId: 'rest_1', ordererId: 'c1', householdOrgId: null, itemsTotalIqd: 16_000, deliveryFeeIqd: 2000, discountIqd: 0, promotionId: null, discountMeta: null, ...extra }) as never;
  const noShowLines = async (h: ReturnType<typeof make>, id: string) => (await h.ledger.eventsForOrder(id)).filter((e) => e.postingGroupId === `order:${id}:home_no_show`);

  it('a batched second trip: the courier gets 70 % of the fee and the platform its 30 % margin; he owes the whole fee', async () => {
    const h = make();
    expect(await h.uow.run((tx) => h.staff.homeNoShow(noShowOrder('ord_b'), tx, { courierId: 'd7', batchedSecond: true }))).toBe(18_000);
    await h.settle();
    const lines = await noShowLines(h, 'ord_b');
    expect(lines.map((l) => [l.type, l.amount, l.fromAccount, l.toAccount, l.memo])).toEqual([
      ['cancellation_fee', 16_000, 'customer:c1', 'merchant_cash:rest_1', 'home_no_show'],
      ['delivery_fee', 1400, 'customer:c1', 'driver:d7', 'home_no_show'],
      ['delivery_fee', 600, 'customer:c1', 'platform', 'batched_margin'],
    ]);
    expect(await h.balance('customer:c1')).toBe(-18_000);
    expect(await h.balance('driver:d7')).toBe(1400);
  });

  it('free delivery from the kitchen: he owes only what checkout showed; the courier still gets his fee, the gap from the platform', async () => {
    const h = make();
    const order = noShowOrder('ord_f', { discountIqd: 2000, promotionId: 'promo_free', discountMeta: { funder: 'merchant', target: 'delivery' } });
    expect(await h.uow.run((tx) => h.staff.homeNoShow(order, tx, { courierId: 'd7' }))).toBe(16_000);
    await h.settle();
    const lines = await noShowLines(h, 'ord_f');
    expect(lines.map((l) => [l.type, l.amount, l.fromAccount, l.toAccount, l.memo])).toEqual([
      ['cancellation_fee', 16_000, 'customer:c1', 'merchant_cash:rest_1', 'home_no_show'],
      ['delivery_fee', 2000, 'platform', 'driver:d7', 'home_no_show:delivery_deal'],
    ]);
    expect(await h.balance('customer:c1')).toBe(-16_000);
    expect(await h.balance('driver:d7')).toBe(2000);
  });

  it('a household order: the household owes it; with no courier on the trip, only the dishes are owed', async () => {
    const h = make();
    expect(await h.uow.run((tx) => h.staff.homeNoShow(noShowOrder('ord_h', { householdOrgId: 'hh1' }), tx, null))).toBe(16_000);
    await h.settle();
    const lines = await noShowLines(h, 'ord_h');
    expect(lines.map((l) => [l.type, l.amount, l.fromAccount, l.toAccount])).toEqual([['cancellation_fee', 16_000, 'household:hh1', 'merchant_cash:rest_1']]);
    expect(await h.balance('household:hh1')).toBe(-16_000);
    expect(await h.balance('customer:c1')).toBe(0);
  });

  it('a non-home pre-order at the door: unchanged — disputed, customer owes the cost, no home_no_show posting', async () => {
    const h = make();
    const at = new Date(h.clock.now().getTime() + 3 * 60 * MIN);
    const o = await h.orders.place('c1', h.foodInput({ scheduledFor: at }));
    await h.advance(at.getTime() - h.clock.now().getTime() - 5 * MIN);
    await unreachable(h, o.id);
    await h.settle();
    expect((await h.orders.get(o.id)).state).toBe('disputed');
    expect(h.events.last('order.disputed')!.payload).toMatchObject({ kind: 'unreachable', defaultOutcome: 'customer_owes_cost' });
    expect(await h.ledger.hasGroup(`order:${o.id}:home_no_show`)).toBe(false);
  });

  it('a ready (now) order at a home kitchen is not a reservation: it is disputed as before', async () => {
    const h = make();
    await homeKitchen(h);
    const o = await h.orders.place('c1', readyInput(h));
    await unreachable(h, o.id);
    await h.settle();
    expect((await h.orders.get(o.id)).state).toBe('disputed');
    expect(await h.ledger.hasGroup(`order:${o.id}:home_no_show`)).toBe(false);
  });
});
