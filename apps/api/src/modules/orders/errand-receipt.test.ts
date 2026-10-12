import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { cashDueIqd, orderPriceIqd, payable } from './orders.service.js';
import { HOME, ordersHarness } from './test-harness.js';

const SHOPS = { zoneKey: 'street_30', pin: { lat: 32.905, lng: 45.07 } };
const UPLOADS: Record<string, { ownerId: string; state: 'pending' | 'stored' }> = {
  up_receipt_d1: { ownerId: 'd1', state: 'stored' },
  up_receipt_d1b: { ownerId: 'd1', state: 'stored' },
  up_receipt_c1: { ownerId: 'c1', state: 'stored' },
};

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
  const h = ordersHarness(undefined, { uploads: { get: async (id) => UPLOADS[id] ?? null, getVoice: async () => null } });
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
