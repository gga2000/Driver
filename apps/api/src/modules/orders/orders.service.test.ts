import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { ordersHarness } from './test-harness.js';

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

const MIN = 60_000;

describe('OrdersService — placing', () => {
  it('computes totals and the vehicle cap, and offers the order to the merchant at once', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    expect(o).toMatchObject({ state: 'placed', itemsTotalIqd: 15000, totalIqd: 16500, minVehicleClass: 'bike', cateringRequest: false });
    expect(o.merchantOfferedAt).toEqual(h.clock.now());
    expect(h.events.types(o.id)).toEqual(['order.placed', 'order.offered_to_merchant']);
  });

  it('tags lines to participants; phone-only participants keep only a hash', async () => {
    const h = ordersHarness();
    h.people.set('07701111111', 'p_a');
    const o = await h.orders.place(
      'c1',
      h.foodInput({
        participants: [
          { ref: 'a', role: 'diner', phone: '07701111111', label: 'الكبير' },
          { ref: 'b', role: 'diner', phone: '07702222222' },
        ],
        lines: [
          { catalogItemId: 'kebab', qty: 2, unitPriceIqd: 5000, participantRef: 'a' },
          { catalogItemId: 'tikka', qty: 1, unitPriceIqd: 5000, participantRef: 'b' },
          { freeText: 'خبز زيادة', qty: 1, unitPriceIqd: 0 },
        ],
      }),
    );
    const [a, b] = o.participants;
    expect(a).toMatchObject({ personId: 'p_a', phoneOnly: false, label: 'الكبير' });
    expect(b).toMatchObject({ personId: null, phoneOnly: true });
    expect(o.lines.map((l) => l.participantId)).toEqual([a!.id, b!.id, null]);
    expect(h.events.ofType('line.tagged')).toHaveLength(2);
    expect(JSON.stringify(h.repo.participants)).not.toContain('07702222222');
  });

  it('rejects unknown participant tags, mixed merchants, missing merchant and empty carts', async () => {
    const h = ordersHarness();
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'x', qty: 1, unitPriceIqd: 1000, participantRef: 'ghost' }] })))).toBe('participant_unknown');
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'x', qty: 1, unitPriceIqd: 1000, merchantOrgId: 'rest_2' }] })))).toBe('one_merchant_per_order');
    expect(await code(h.orders.place('c1', h.foodInput({ merchantOrgId: undefined })))).toBe('merchant_required');
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [] })))).toBe('order_empty');
    expect(await code(h.orders.place('c1', h.foodInput({ merchantOrgId: 'nope' })))).toBe('org_not_found');
  });

  it('caps by vehicle class: a 70,000 order needs a car; above 100,000 it is a catering request', async () => {
    const h = ordersHarness();
    const big = await h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'tray', qty: 7, unitPriceIqd: 10000 }] }));
    expect(big.minVehicleClass).toBe('car');
    const catering = await h.orders.place('c1', h.foodInput({ lines: [{ catalogItemId: 'tray', qty: 40, unitPriceIqd: 5000 }] }));
    expect(catering).toMatchObject({ minVehicleClass: 'car', cateringRequest: true });
    expect(h.events.ofType('order.catering_request')).toHaveLength(1);
  });
});

describe('OrdersService — merchant acceptance', () => {
  it('auto-rejects after 90 s with a dispatch alert, scored', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.advance(89_000);
    expect((await h.orders.get(o.id)).state).toBe('placed');
    await h.advance(1_000);
    expect((await h.orders.get(o.id)).state).toBe('merchant_rejected');
    expect(h.events.last('order.rejected')!.payload).toMatchObject({ auto: true, scored: true, dispatchAlert: true, reason: 'merchant_timeout' });
  });

  it('acceptance inside 90 s stops the timer', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.advance(30_000);
    const acc = await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    expect(acc.state).toBe('merchant_accepted');
    expect(acc.promisedReadyAt).toEqual(new Date(h.clock.now().getTime() + 15 * MIN));
    await h.advance(90_000);
    expect((await h.orders.get(o.id)).state).toBe('merchant_accepted');
    expect(h.events.ofType('order.rejected')).toHaveLength(0);
  });

  it('merchants with the auto-accept flag skip acceptance', async () => {
    const h = ordersHarness();
    h.merchants.add('rest_auto', { autoAccept: true, defaultPrepMin: 25 });
    const o = await h.orders.place('c1', h.foodInput({ merchantOrgId: 'rest_auto' }));
    expect(o.state).toBe('merchant_accepted');
    expect(o.promisedReadyAt).toEqual(new Date(h.clock.now().getTime() + 25 * MIN));
    expect(h.events.last('order.auto_accepted')!.payload).toMatchObject({ auto: true, prepMinutes: 25 });
    await h.advance(91_000);
    expect((await h.orders.get(o.id)).state).toBe('merchant_accepted');
  });

  it('pause windows: no orders during Friday prayer; an auto-reject that lands inside one is not scored', async () => {
    const closed = ordersHarness('2026-10-02T08:50:00Z'); // Friday 11:50 Baghdad
    expect(await code(closed.orders.place('c1', closed.foodInput()))).toBe('merchant_paused');

    const h = ordersHarness('2026-10-02T08:44:00Z'); // Friday 11:44, a minute before the pause
    const o = await h.orders.place('c1', h.foodInput());
    await h.advance(90_000); // 11:45:30 — inside the window
    expect((await h.orders.get(o.id)).state).toBe('merchant_rejected');
    expect(h.events.last('order.rejected')!.payload).toMatchObject({ auto: true, scored: false, pauseWindow: 'صلاة الجمعة' });
  });

  it('late rejection after accepting: scoring hit and 500 customer credit funded by the merchant', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    await h.orders.markPreparing('m1', { orderId: o.id });
    const r = await h.orders.merchantReject('m1', { orderId: o.id, reason: 'خلص الأكل' });
    expect(r.state).toBe('merchant_rejected');
    expect(h.events.last('order.rejected')!.payload).toMatchObject({ afterAccept: true, customerCreditIqd: 500, creditFundedBy: 'merchant', scored: true });
  });
});

describe('OrdersService — scheduled orders (review A.12)', () => {
  it('reaches the merchant at T − prep − 10 min and cancels free until then', async () => {
    const h = ordersHarness();
    const at = new Date(h.clock.now().getTime() + 3 * 60 * MIN);
    const o = await h.orders.place('c1', h.foodInput({ scheduledFor: at }));
    expect(o.merchantOfferedAt).toBeNull();
    expect(await code(h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 20 }))).toBe('order_state_conflict');
    expect((await h.orders.cancellationPreview(o.id)).free).toBe(true);
    await h.advance(150 * MIN - 1000); // offer at 3 h − (20 + 10) min = +2 h 30
    expect((await h.orders.get(o.id)).merchantOfferedAt).toBeNull();
    await h.advance(1000);
    expect((await h.orders.get(o.id)).merchantOfferedAt).toEqual(h.clock.now());
    expect((await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 20 })).state).toBe('merchant_accepted');
  });

  it('a scheduled order cancelled before it reached the merchant is never offered', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput({ scheduledFor: new Date(h.clock.now().getTime() + 3 * 60 * MIN) }));
    const c = await h.orders.cancel('c1', { orderId: o.id });
    expect(c).toMatchObject({ state: 'customer_cancelled', cancellationFeeIqd: 0 });
    await h.advance(4 * 60 * MIN);
    expect((await h.orders.get(o.id)).merchantOfferedAt).toBeNull();
  });
});

describe('OrdersService — partial accept (review A.4)', () => {
  async function proposed() {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    const tikka = o.lines[1]!;
    const p = await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15, unavailableLineIds: [tikka.id] });
    return { h, o: p, tikka };
  }

  it('marks lines unavailable and gives the customer 60 s with the reduced total', async () => {
    const { h, o, tikka } = await proposed();
    expect(o.state).toBe('placed');
    expect(o.partial).toMatchObject({ unavailableLineIds: [tikka.id], reducedItemsTotalIqd: 10000, reducedTotalIqd: 11500 });
    expect(o.partial!.deadline).toEqual(new Date(h.clock.now().getTime() + 60_000));
    expect(o.lines[1]!.availability).toBe('unavailable');
    expect(h.events.last('order.partial_proposed')!.payload).toMatchObject({ reducedTotalIqd: 11500 });
  });

  it('approval accepts the reduced order; the 90-s timer no longer applies', async () => {
    const { h, o } = await proposed();
    await h.advance(30_000);
    const a = await h.orders.respondPartial('c1', { orderId: o.id, approve: true });
    expect(a).toMatchObject({ state: 'merchant_accepted', itemsTotalIqd: 10000, totalIqd: 11500, partial: null });
    expect(a.lines[1]!.availability).toBe('removed');
    expect(h.events.last('order.accepted')!.payload).toMatchObject({ partial: true, prepMinutes: 15 });
    await h.advance(120_000);
    expect((await h.orders.get(o.id)).state).toBe('merchant_accepted');
  });

  it('declining cancels free; silence for 60 s cancels free too', async () => {
    const { h, o } = await proposed();
    expect(await code(h.orders.respondPartial('someone', { orderId: o.id, approve: false }))).toBe('forbidden');
    const d = await h.orders.respondPartial('c1', { orderId: o.id, approve: false });
    expect(d).toMatchObject({ state: 'customer_cancelled', cancellationFeeIqd: 0, cancellationReason: 'partial_declined' });

    const second = await proposed();
    await second.h.advance(60_000);
    expect(await second.h.orders.get(second.o.id)).toMatchObject({ state: 'platform_cancelled', cancellationReason: 'partial_timeout', cancellationFeeIqd: 0 });
    expect(await code(second.h.orders.respondPartial('c1', { orderId: second.o.id, approve: true }))).toBe('partial_accept_not_pending');
  });

  it('cannot mark every line or an unknown line unavailable (that is a rejection)', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    expect(await code(h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15, unavailableLineIds: o.lines.map((l) => l.id) }))).toBe('partial_accept_invalid');
    expect(await code(h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15, unavailableLineIds: ['line_x'] }))).toBe('partial_accept_invalid');
  });
});

describe('OrdersService — cancellation fees (spec §4)', () => {
  it('free before acceptance, 500 after, food cost + 500 to the courier once preparing', async () => {
    const h = ordersHarness();
    const free = await h.orders.place('c1', h.foodInput());
    expect((await h.orders.cancel('c1', { orderId: free.id })).cancellationFeeIqd).toBe(0);

    const accepted = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: accepted.id, prepMinutes: 15 });
    expect((await h.orders.cancellationPreview(accepted.id)).amountIqd).toBe(500);
    expect((await h.orders.cancel('c1', { orderId: accepted.id })).cancellationFeeIqd).toBe(500);

    const preparing = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: preparing.id, prepMinutes: 15 });
    const trip = await h.tripFor(preparing.id);
    await h.orders.markPreparing('m1', { orderId: preparing.id });
    const fee = await h.orders.cancellationPreview(preparing.id);
    expect(fee.amountIqd).toBe(15500);
    expect(fee.splits).toEqual([
      { to: 'merchant', amountIqd: 15000 },
      { to: 'courier', amountIqd: 500 },
    ]);
    const c = await h.orders.cancel('c1', { orderId: preparing.id, reason: 'غيرت رأيي' });
    expect(c.cancellationFeeIqd).toBe(15500);
    expect(h.events.last('order.cancelled')!.payload).toMatchObject({ by: 'customer', feeIqd: 15500, reason: 'غيرت رأيي' });
    expect((await h.trips.get(trip.id)).state).toBe('platform_cancelled');
  });

  it('no cancel after pickup — it becomes a dispute', async () => {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
    const t = await h.tripFor(o.id);
    await h.pickup(t.id);
    expect((await h.orders.get(o.id)).state).toBe('picked_up');
    expect(await code(h.orders.cancel('c1', { orderId: o.id }))).toBe('order_cancel_after_pickup');
    expect(await code(h.orders.cancel('c2', { orderId: o.id }))).toBe('forbidden');
  });
});

describe('OrdersService — merchant heartbeat and courier release (review A.2)', () => {
  async function waiting() {
    const h = ordersHarness();
    const o = await h.orders.place('c1', h.foodInput());
    await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 10 });
    const t = await h.tripFor(o.id);
    return { h, o, t };
  }

  it('silent merchant: dispatcher card at promised + 10, courier released at + 15 with 500 charged to the merchant', async () => {
    const { h, o, t } = await waiting();
    await h.advance(20 * MIN - 1000);
    expect(h.events.ofType('order.merchant_unresponsive')).toHaveLength(0);
    await h.advance(1000);
    expect(h.events.last('order.merchant_unresponsive')!.payload).toMatchObject({ dispatcherCard: true, call: true });
    await h.advance(5 * MIN);
    expect(h.events.last('order.courier_released')!.payload).toMatchObject({ courierId: 'd1', compensationIqd: 500, chargedTo: 'merchant', tripId: t.id });
    expect((await h.trips.get(t.id)).orders[0]!.reason).toBe('merchant_unresponsive');
    expect((await h.orders.get(o.id)).state).toBe('merchant_accepted');
  });

  it('a merchant whose app is alive is left alone', async () => {
    const { h } = await waiting();
    await h.advance(19 * MIN);
    await h.orders.merchantHeartbeat('rest_1');
    await h.advance(1 * MIN);
    await h.advance(4 * MIN);
    await h.orders.merchantHeartbeat('rest_1');
    await h.advance(1 * MIN);
    expect(h.events.ofType('order.merchant_unresponsive')).toHaveLength(0);
    expect(h.events.ofType('order.courier_released')).toHaveLength(0);
  });

  it('a ready order never triggers the checks', async () => {
    const { h, o } = await waiting();
    await h.orders.markReady('m1', { orderId: o.id });
    await h.advance(30 * MIN);
    expect(h.events.ofType('order.merchant_unresponsive')).toHaveLength(0);
  });
});
