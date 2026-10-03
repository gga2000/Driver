import { describe, expect, it } from 'vitest';
import { DriverError } from '@driver/contracts';
import { ordersHarness } from './test-harness.js';

const MIN = 60_000;

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

/** rest_1's customer storefront (catalog): Saturday 13:00–23:00 Baghdad, minimum 12,000 on the items. */
async function withStorefront(h: ReturnType<typeof ordersHarness>, patch: { minOrderIqd?: number; hours?: Array<{ dow: number; start: string; end: string }> } = {}) {
  await h.catalog.saveStorefront({ orgId: 'rest_1', cityId: 'aziziyah', nameAr: 'مطعم خالد', cuisineAr: 'مشويات', minOrderIqd: patch.minOrderIqd ?? 0, hours: patch.hours ?? [{ dow: 6, start: '13:00', end: '23:00' }] });
}

describe('orders.place — opening hours (apps review 2026-10-04 #10)', () => {
  it('refuses an order while the restaurant is closed by its opening hours, with a friendly Arabic message', async () => {
    const h = ordersHarness(); // Saturday 12:00 Baghdad, an hour before opening
    await withStorefront(h);
    const err = await h.orders.place('c1', h.foodInput()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DriverError);
    expect((err as DriverError).code).toBe('merchant_closed');
    expect((err as DriverError).envelope.message_ar).toMatch(/مسكّر/);
    // The checkout summary still prices it (the app shows the closed state itself).
    expect(await code(h.orders.quote('c1', h.foodInput()))).toBe('ok');
  });

  it('takes orders inside the hours; a cart carried past closing is refused', async () => {
    const h = ordersHarness('2026-10-03T10:30:00Z'); // Saturday 13:30
    await withStorefront(h);
    expect(await code(h.orders.place('c1', h.foodInput()))).toBe('ok');
    h.clock.set('2026-10-03T20:00:01Z'); // 23:00:01
    expect(await code(h.orders.place('c1', h.foodInput()))).toBe('merchant_closed');
  });

  it('a scheduled order for opening time is allowed; one for a closed hour is not', async () => {
    const h = ordersHarness(); // 12:00, closed
    await withStorefront(h);
    expect(await code(h.orders.place('c1', h.foodInput({ scheduledFor: new Date('2026-10-03T10:00:00Z') })))).toBe('ok'); // 13:00 sharp
    expect(await code(h.orders.place('c1', h.foodInput({ scheduledFor: new Date('2026-10-03T09:45:00Z') })))).toBe('merchant_closed'); // 12:45
  });

  it('pause windows, early close and busy mode are still respected inside the hours', async () => {
    const h = ordersHarness('2026-10-03T10:30:00Z');
    await withStorefront(h, { hours: [{ dow: 6, start: '00:00', end: '23:59' }] });
    h.merchants.merchants.get('rest_1')!.pauseWindows = [{ dow: 6, start: '13:15', end: '14:00', reason: 'صلاة' }];
    expect(await code(h.orders.place('c1', h.foodInput()))).toBe('merchant_paused');
    // A scheduled order may not land inside a pause window either.
    expect(await code(h.orders.place('c1', h.foodInput({ scheduledFor: new Date(h.clock.now().getTime() + 15 * MIN) })))).toBe('merchant_paused');
    expect(await code(h.orders.place('c1', h.foodInput({ scheduledFor: new Date(h.clock.now().getTime() + 60 * MIN) })))).toBe('ok');
    h.merchants.merchants.get('rest_1')!.pauseWindows = [];
    h.merchants.merchants.get('rest_1')!.closed = true;
    expect(await code(h.orders.place('c1', h.foodInput()))).toBe('merchant_paused');
    h.merchants.merchants.get('rest_1')!.closed = false;
    // Busy mode only lengthens prep: the order goes through.
    h.merchants.merchants.get('rest_1')!.busyUntil = new Date(h.clock.now().getTime() + 30 * MIN);
    expect(await code(h.orders.place('c1', h.foodInput()))).toBe('ok');
  });

  it('a merchant without a storefront (or without hours) is open whenever it is not paused', async () => {
    const h = ordersHarness();
    expect(await code(h.orders.place('c1', h.foodInput()))).toBe('ok');
    await withStorefront(h, { hours: [] });
    expect(await code(h.orders.place('c1', h.foodInput()))).toBe('ok');
  });
});

describe('orders.place — merchant minimum order (apps review 2026-10-04 #11)', () => {
  it('refuses a basket under the restaurant minimum (menu prices, before any deal)', async () => {
    const h = ordersHarness('2026-10-03T10:30:00Z');
    await withStorefront(h, { minOrderIqd: 12_000 });
    // 2 × kebab = 10,000 < 12,000
    const small = h.foodInput({ lines: [{ catalogItemId: 'kebab', qty: 2, unitPriceIqd: 5000 }] });
    const err = await h.orders.place('c1', small).catch((e: unknown) => e);
    expect((err as DriverError).code).toBe('order_below_minimum');
    expect((err as DriverError).envelope.message_ar.length).toBeGreaterThan(10);
    // Free-text requests are priced 0 and do not count toward the minimum.
    expect(await code(h.orders.place('c1', h.foodInput({ lines: [...small.lines!, { freeText: 'خبز زيادة', qty: 5 }] })))).toBe('order_below_minimum');
    // 15,000 meets it.
    expect(await code(h.orders.place('c1', h.foodInput()))).toBe('ok');
  });

  it('the merchant minimum is on the items before a deal; the deal keeps its own minimum', async () => {
    const h = ordersHarness('2026-10-03T10:30:00Z');
    await withStorefront(h, { minOrderIqd: 12_000 });
    // 20 % off everything above 14,000: a 15,000 basket meets both minimums, its total drops below 12,000 + fees and still goes.
    await h.promotions.addDeal({ type: 'percent', value: 20, minOrderIqd: 14_000 });
    const q = await h.orders.quote('c1', h.foodInput());
    expect(q.discountIqd).toBeGreaterThan(0);
    expect(await code(h.orders.place('c1', h.foodInput({ discountIqd: q.discountIqd })))).toBe('ok');
    // A 12,000 basket meets the merchant minimum but not the deal's: it goes, without the deal.
    const mid = h.foodInput({ lines: [{ catalogItemId: 'tray_9k', qty: 1, unitPriceIqd: 9000 }, { catalogItemId: 'x', qty: 3, unitPriceIqd: 1000 }] });
    const q2 = await h.orders.quote('c1', mid);
    expect(q2.discountIqd).toBe(0);
    expect(q2.nextDeal).not.toBeNull();
    expect(await code(h.orders.place('c1', mid))).toBe('ok');
  });

  it('a scheduled order is held to the minimum too', async () => {
    const h = ordersHarness();
    await withStorefront(h, { minOrderIqd: 12_000 });
    const small = h.foodInput({ lines: [{ catalogItemId: 'kebab', qty: 1, unitPriceIqd: 5000 }], scheduledFor: new Date('2026-10-03T11:00:00Z') });
    expect(await code(h.orders.place('c1', small))).toBe('order_below_minimum');
  });
});
