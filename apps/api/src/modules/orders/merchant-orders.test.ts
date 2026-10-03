import { describe, expect, it } from 'vitest';
import type { Order } from '@driver/contracts';
import { ordersHarness } from './test-harness.js';

const DAY = 86_400_000;

/** Five weeks of rest_1 orders (one every 13 h, some rejected or cancelled) plus a second merchant's. */
async function history() {
  const h = ordersHarness('2026-09-01T09:00:00Z');
  h.merchants.add('rest_2', { location: { zoneKey: 'centre' } });
  const ids: string[] = [];
  for (let i = 0; i < 64; i++) {
    h.clock.set(new Date(Date.parse('2026-09-01T09:00:00Z') + i * 13 * 3_600_000));
    // Fees vary by hour (night rates): let the server price them; skip the Friday-prayer pause.
    const o = await h.orders.place('c1', { ...h.foodInput(i % 5 === 0 ? { merchantOrgId: 'rest_2' } : {}), deliveryFeeIqd: undefined, serviceFeeIqd: undefined }).catch(() => null);
    if (!o) continue;
    ids.push(o.id);
    if (i % 7 === 1) await h.orders.merchantReject('m1', { orderId: o.id, reason: 'خلص' });
    else if (i % 7 === 2) await h.orders.cancel('c1', { orderId: o.id });
    else if (i % 5 !== 0) await h.orders.merchantAccept('m1', { orderId: o.id, prepMinutes: 15 });
  }
  return { h, ids };
}

const compact = (orders: readonly Order[]) => orders.map((o) => [o.id, o.state, o.placedAt.toISOString(), o.itemsTotalIqd, o.lines.length, o.lines.map((l) => l.catalogItemId).join('+')]);

describe('OrdersService.merchantOrders — bounded by the date range (backend review 2026-10-04 #11)', () => {
  it('returns exactly what reading every order one by one returns (snapshot)', async () => {
    const { h, ids } = await history();
    const range = { from: new Date('2026-09-10T00:00:00Z'), to: new Date('2026-09-24T00:00:00Z') };
    const got = await h.orders.merchantOrders('rest_1', range);
    const expected = (await Promise.all(ids.map((id) => h.orders.get(id))))
      .filter((o) => o.merchantOrgId === 'rest_1' && o.placedAt >= range.from && o.placedAt < range.to)
      .sort((a, b) => a.placedAt.getTime() - b.placedAt.getTime() || a.id.localeCompare(b.id));
    expect(got).toEqual(expected);
    expect(got.length).toBeGreaterThan(10);
    expect(compact(got)).toMatchSnapshot();
    // The range is half-open: an order placed exactly at `to` belongs to the next range.
    const at = got[3]!.placedAt;
    expect((await h.orders.merchantOrders('rest_1', { from: range.from, to: at })).map((o) => o.id)).toEqual(got.slice(0, 3).map((o) => o.id));
  });

  it('never loads the merchant’s whole history: the range goes to the repository in one read', async () => {
    const { h } = await history();
    const scans: unknown[] = [];
    const findMany = h.repo.findMany.bind(h.repo);
    h.repo.findMany = async (filter: Parameters<typeof findMany>[0]) => {
      if (filter.merchantOrgId) scans.push(filter);
      return findMany(filter);
    };
    const finds: string[] = [];
    const find = h.repo.find.bind(h.repo);
    h.repo.find = async (id: string) => {
      finds.push(id);
      return find(id);
    };
    const now = new Date('2026-10-03T00:00:00Z');
    const got = await h.orders.merchantOrders('rest_1', { from: new Date(now.getTime() - 7 * DAY), to: now });
    expect(got.length).toBeGreaterThan(5);
    expect(scans).toEqual([]);
    // No per-order re-read (N+1): lines and participants come with the range read.
    expect(finds).toEqual([]);
  });
});
