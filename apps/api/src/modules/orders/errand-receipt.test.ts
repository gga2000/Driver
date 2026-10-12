import { describe, expect, it } from 'vitest';
import { DriverError, type Actor } from '@driver/contracts';
import { ledgerHarness } from '../ledger/test-harness.js';
import type { OrdersUploadsPort } from './catalog.port.js';
import { cashDueIqd, orderPriceIqd, payable } from './orders.service.js';
import { staffHarness } from './staff-harness.js';
import { HOME, ordersHarness } from './test-harness.js';

const SHOPS = { zoneKey: 'street_30', pin: { lat: 32.905, lng: 45.07 } };
const UPLOADS: Record<string, { ownerId: string; state: 'pending' | 'stored' }> = {
  up_receipt_d1: { ownerId: 'd1', state: 'stored' },
  up_receipt_d1b: { ownerId: 'd1', state: 'stored' },
  up_receipt_c1: { ownerId: 'c1', state: 'stored' },
  up_receipt_ops: { ownerId: 'ops_1', state: 'stored' },
  up_receipt_pending: { ownerId: 'd1', state: 'pending' },
};
const uploads: OrdersUploadsPort = { get: async (id) => UPLOADS[id] ?? null, getVoice: async () => null };

async function code(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DriverError);
  return (err as DriverError).code;
}

/** A cash «دوّرلي» with a 30,000 list ceiling, taken by d1 and (unless `arrive` is false) at the shops. */
async function errandAtShops(opts: { arrive?: boolean } = {}) {
  return errandOn(ordersHarness(undefined, { uploads }), opts);
}

async function errandOn<H extends ReturnType<typeof ordersHarness>>(h: H, opts: { arrive?: boolean } = {}) {
  const errandItem = (listMaxIqd: number) => ({ unit: 'piece' as const, where: { kind: 'near' as const }, ifMissing: 'call' as const, maxIqd: null, photoUploadId: null, voiceUploadId: null, voiceSec: null, listMaxIqd });
  const o = await h.orders.place('c1', {
    cityId: 'aziziyah',
    type: 'errand',
    pickup: SHOPS,
    dropoff: { zoneKey: 'zakur', pin: HOME },
    lines: [
      { freeText: 'بنادول', qty: 2, errandItem: errandItem(30_000) },
      { freeText: 'صمون', qty: 10, errandItem: errandItem(30_000) },
    ],
  });
  const t = await h.trips.createForOrders({
    cityId: 'aziziyah',
    vertical: 'errand',
    orders: [{ orderId: o.id, minVehicleClass: null }],
    stops: [
      { orderId: o.id, type: 'pickup', zoneKey: SHOPS.zoneKey, target: SHOPS.pin },
      { orderId: o.id, type: 'dropoff', zoneKey: 'zakur', target: HOME },
    ],
  });
  await h.trips.offer(t.id);
  await h.trips.accept(t.id, 'd1', { vehicleClass: 'bike' });
  await h.deliver();
  const pickup = (await h.trips.get(t.id)).stops.find((s) => s.type === 'pickup')!;
  if (opts.arrive !== false) await h.trips.arrive(t.id, pickup.id, 'd1', { pin: SHOPS.pin });
  return { h, o, t, pickup };
}

describe('«دوّرلي» receipt (lane A spec)', () => {
  it('the receipt becomes the goods: cash due = receipt + errand fees, and the ledger cost reads it', async () => {
    const { h, o } = await errandAtShops();
    const placed = await h.orders.get(o.id);
    const r = await h.orders.recordErrandReceipt('d1', { orderId: o.id, totalIqd: 18_750, photoUploadId: 'up_receipt_d1' });
    const after = (await h.repo.find(o.id))!.order;
    expect(after.receiptTotalIqd).toBe(18_750);
    const price = 18_750 + placed.deliveryFeeIqd + placed.serviceFeeIqd + placed.tipIqd;
    expect(orderPriceIqd(after)).toBe(price);
    expect(after.totalIqd).toBe(payable('errand', 'cash', price).totalIqd);
    expect(r).toEqual({ receiptIqd: 18_750, totalIqd: after.totalIqd, cashDueIqd: cashDueIqd(after), overCeiling: false });
    expect(h.events.last('order.errand_receipt')!.payload).toMatchObject({ orderId: o.id, courierId: 'd1', receiptIqd: 18_750, previousIqd: null, overCeiling: false });
  });

  it('a second entry before leaving the shops replaces the first (both on the history); after the pickup it is locked', async () => {
    const { h, o, t, pickup } = await errandAtShops();
    await h.orders.recordErrandReceipt('d1', { orderId: o.id, totalIqd: 12_000, photoUploadId: 'up_receipt_d1' });
    await h.orders.recordErrandReceipt('d1', { orderId: o.id, totalIqd: 14_500, photoUploadId: 'up_receipt_d1b' });
    expect((await h.repo.find(o.id))!.order.receiptTotalIqd).toBe(14_500);
    expect(h.events.ofType('order.errand_receipt').map((e) => [e.payload['receiptIqd'], e.payload['previousIqd']])).toEqual([
      [12_000, null],
      [14_500, 12_000],
    ]);
    await h.trips.completeStop(t.id, pickup.id, 'd1');
    await h.deliver();
    expect(await code(h.orders.recordErrandReceipt('d1', { orderId: o.id, totalIqd: 9_000, photoUploadId: 'up_receipt_d1' }))).toBe('order_state_conflict');
    expect((await h.repo.find(o.id))!.order.receiptTotalIqd).toBe(14_500);
  });

  it('refused: another courier, before he reaches the shops, someone else’s photo, a food order, a bad amount', async () => {
    const { h, o } = await errandAtShops();
    expect(await code(h.orders.recordErrandReceipt('d2', { orderId: o.id, totalIqd: 10_000, photoUploadId: 'up_receipt_d1' }))).toBe('forbidden');
    expect(await code(h.orders.recordErrandReceipt('d1', { orderId: o.id, totalIqd: 10_000, photoUploadId: 'up_receipt_c1' }))).toBe('upload_invalid');
    expect(await code(h.orders.recordErrandReceipt('d1', { orderId: o.id, totalIqd: 10_000, photoUploadId: 'up_nobody' }))).toBe('upload_invalid');
    expect(await code(h.orders.recordErrandReceipt('d1', { orderId: o.id, totalIqd: 0, photoUploadId: 'up_receipt_d1' }))).toBe('invalid_input');
    expect(await code(h.orders.recordErrandReceipt('d1', { orderId: o.id, totalIqd: 10_000.5, photoUploadId: 'up_receipt_d1' }))).toBe('invalid_input');

    const early = await errandAtShops({ arrive: false });
    expect(await code(early.h.orders.recordErrandReceipt('d1', { orderId: early.o.id, totalIqd: 10_000, photoUploadId: 'up_receipt_d1' }))).toBe('order_state_conflict');

    const food = await h.orders.place('c1', h.foodInput());
    expect(await code(h.orders.recordErrandReceipt('d1', { orderId: food.id, totalIqd: 10_000, photoUploadId: 'up_receipt_d1' }))).toBe('order_state_conflict');
    expect(h.events.ofType('order.errand_receipt')).toEqual([]);
  });

  it('over the list ceiling it still records, flagged for the desk', async () => {
    const { h, o } = await errandAtShops();
    const r = await h.orders.recordErrandReceipt('d1', { orderId: o.id, totalIqd: 31_000, photoUploadId: 'up_receipt_d1' });
    expect(r.overCeiling).toBe(true);
    expect((await h.repo.find(o.id))!.order.receiptTotalIqd).toBe(31_000);
    expect(h.events.last('order.errand_receipt')!.payload).toMatchObject({ overCeiling: true, ceilingIqd: 30_000, dispatcherCard: true });
  });
});

describe('«دوّرلي» pickup guard (the shops stop waits for the receipt)', () => {
  it('without a receipt the pickup is refused and nothing is written; with one it completes; a replay is fine', async () => {
    const { h, o, t, pickup } = await errandAtShops();
    expect(await code(h.trips.completeStop(t.id, pickup.id, 'd1'))).toBe('errand_receipt_missing');
    expect((await h.trips.get(t.id)).stops.find((s) => s.id === pickup.id)!.state).toBe('arrived');
    expect((await h.orders.get(o.id)).state).not.toBe('picked_up');
    await h.orders.recordErrandReceipt('d1', { orderId: o.id, totalIqd: 8_000, photoUploadId: 'up_receipt_d1' });
    await h.trips.completeStop(t.id, pickup.id, 'd1');
    await h.deliver();
    expect((await h.trips.get(t.id)).stops.find((s) => s.id === pickup.id)!.state).toBe('completed');
    // The same tap sent again (a retry from the phone) returns the trip as it is.
    await expect(h.trips.completeStop(t.id, pickup.id, 'd1')).resolves.toBeTruthy();
  });

  it('a courier or ops can still drop an errand at the shops with no receipt (the shop had nothing)', async () => {
    const byCourier = await errandAtShops();
    await byCourier.h.trips.cancel(byCourier.t.id, 'driver', 'd1', 'المحل مسكّر');
    await byCourier.h.deliver();
    expect((await byCourier.h.trips.get(byCourier.t.id)).state).toMatch(/cancelled$/);
    const byOps = await errandAtShops();
    await byOps.h.trips.cancel(byOps.t.id, 'platform', 'ops_1', 'ماكو أغراض');
    await byOps.h.deliver();
    expect((await byOps.h.trips.get(byOps.t.id)).state).toMatch(/cancelled$/);
  });

  it('food and parcel pickups pass; الرجعة and خطوط pickups never ask the guard', async () => {
    const h = ordersHarness();
    expect(await h.orders.errandPickupProblem((await h.orders.place('c1', h.foodInput())).id)).toBeNull();
    expect(await h.orders.errandPickupProblem((await h.orders.place('c1', { cityId: 'aziziyah', type: 'parcel', pickup: SHOPS, dropoff: { zoneKey: 'zakur', pin: HOME }, lines: [] })).id)).toBeNull();
    expect(await h.orders.errandPickupProblem('no_such_order')).toBeNull();

    const asked: string[] = [];
    h.trips.bindPickupGuard({ problem: async (orderId) => (asked.push(orderId), null) });
    for (const [vertical, driver] of [['intercity', 'd8'], ['khat', 'd9']] as const) {
      const o = await h.orders.place('c1', h.foodInput());
      const t = await h.trips.createForOrders({
        cityId: 'aziziyah',
        vertical,
        orders: [{ orderId: o.id, minVehicleClass: null }],
        stops: [
          { orderId: o.id, type: 'pickup', zoneKey: SHOPS.zoneKey, target: SHOPS.pin },
          { orderId: o.id, type: 'dropoff', zoneKey: 'zakur', target: HOME },
        ],
      });
      await h.trips.offer(t.id);
      await h.trips.accept(t.id, driver, { vehicleClass: 'car' });
      const s = (await h.trips.get(t.id)).stops.find((x) => x.type === 'pickup')!;
      await h.trips.arrive(t.id, s.id, driver, { pin: SHOPS.pin });
      await h.trips.completeStop(t.id, s.id, driver).catch(() => undefined);
    }
    expect(asked).toEqual([]);
  });
});

describe('«دوّرلي» is cash only for now', () => {
  it('a wallet errand is refused at placement and nothing is written', async () => {
    const h = ordersHarness();
    const errandItem = { unit: 'piece' as const, where: { kind: 'near' as const }, ifMissing: 'call' as const, maxIqd: null, photoUploadId: null, voiceUploadId: null, voiceSec: null, listMaxIqd: 10_000 };
    const input = { cityId: 'aziziyah', type: 'errand' as const, paymentMethod: 'wallet' as const, pickup: SHOPS, dropoff: { zoneKey: 'zakur', pin: HOME }, lines: [{ freeText: 'صمون', qty: 4, errandItem }] };
    expect(await code(h.orders.place('c1', input))).toBe('errand_cash_only');
    expect(h.events.ofType('order.placed')).toEqual([]);
  });
});

describe('«دوّرلي» receipt by staff (orders.ops.recordErrandReceipt)', () => {
  const ops: Actor = { personId: 'ops_1', roles: ['dispatcher'] } as unknown as Actor;
  const staffAtShops = async (opts: { arrive?: boolean } = {}) => {
    const h = staffHarness({}, { ledger: ledgerHarness(), uploads });
    return { ...(await errandOn(h, opts)), h };
  };

  it('sets the receipt and the server total like the shopper\'s own entry, audited with the amount and the reason', async () => {
    const { h, o } = await staffAtShops();
    const placed = await h.orders.get(o.id);
    const r = await h.staff.errandReceipt(ops, { orderId: o.id, totalIqd: 18_750, reason: 'الصورة ما دتنرسل من السوق' });
    const after = (await h.repo.find(o.id))!.order;
    expect(after.receiptTotalIqd).toBe(18_750);
    expect(after.totalIqd).toBe(payable('errand', 'cash', 18_750 + placed.deliveryFeeIqd + placed.serviceFeeIqd + placed.tipIqd).totalIqd);
    expect(r).toMatchObject({ orderId: o.id, state: after.state, changed: true, postedIqd: 0, auditId: 'au_1' });
    expect(h.events.last('order.errand_receipt')).toMatchObject({ actorId: 'ops_1', payload: { courierId: 'd1', receiptIqd: 18_750, previousIqd: null, photoUploadId: null, byStaff: true, staffId: 'ops_1' } });
    expect(h.audits).toEqual([expect.objectContaining({ id: 'au_1', action: 'order.errand_receipt_by_staff', actorId: 'ops_1', subjectId: o.id })]);
    expect(h.audits[0]!.detail).toMatchObject({ receiptIqd: 18_750, totalIqd: after.totalIqd, cashDueIqd: cashDueIqd(after), reason: 'الصورة ما دتنرسل من السوق' });
    expect(h.audits[0]!.summaryAr).toContain('18,750 دينار');
    expect(h.audits[0]!.summaryAr).toContain('الصورة ما دتنرسل من السوق');
  });

  it('the pickup then completes; after it the receipt is locked for staff too', async () => {
    const { h, o, t, pickup } = await staffAtShops();
    await h.staff.errandReceipt(ops, { orderId: o.id, totalIqd: 9_000, reason: 'تلفونه خربان', photoUploadId: 'up_receipt_ops' });
    await h.trips.completeStop(t.id, pickup.id, 'd1');
    await h.deliver();
    expect(await code(h.staff.errandReceipt(ops, { orderId: o.id, totalIqd: 9_500, reason: 'تصحيح' }))).toBe('order_state_conflict');
    expect((await h.repo.find(o.id))!.order.receiptTotalIqd).toBe(9_000);
    expect(h.audits).toHaveLength(1);
  });

  it('works before «وصلت» reached us; refused for a food order, a bad photo, or before anyone took the errand', async () => {
    const early = await staffAtShops({ arrive: false });
    expect(await early.h.staff.errandReceipt(ops, { orderId: early.o.id, totalIqd: 7_000, reason: 'ماكو نت عنده' })).toMatchObject({ changed: true });

    const { h, o } = await staffAtShops();
    expect(await code(h.staff.errandReceipt(ops, { orderId: o.id, totalIqd: 7_000, reason: 'صورة غلط', photoUploadId: 'up_receipt_c1' }))).toBe('upload_invalid');
    expect(await code(h.staff.errandReceipt(ops, { orderId: o.id, totalIqd: 7_000, reason: 'صورة ناقصة', photoUploadId: 'up_receipt_pending' }))).toBe('upload_invalid');
    const food = await h.orders.place('c1', h.foodInput());
    expect(await code(h.staff.errandReceipt(ops, { orderId: food.id, totalIqd: 7_000, reason: 'مو دوّرلي' }))).toBe('order_state_conflict');
    const untaken = await h.orders.place('c1', { cityId: 'aziziyah', type: 'errand', pickup: SHOPS, dropoff: { zoneKey: 'zakur', pin: HOME }, lines: [{ freeText: 'خبز', qty: 1 }] });
    expect(await code(h.staff.errandReceipt(ops, { orderId: untaken.id, totalIqd: 7_000, reason: 'ماكو متسوّق' }))).toBe('order_state_conflict');
    expect(h.audits).toEqual([]);
    expect(h.events.ofType('order.errand_receipt')).toEqual([]);
  });
});
