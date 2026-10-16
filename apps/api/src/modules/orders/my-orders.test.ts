import { describe, expect, it } from 'vitest';
import { toOrderView } from './orders.service.js';
import { ordersHarness } from './test-harness.js';

/**
 * FOOD-04: a person's orders come from one batched read, newest first, and a limit keeps only the
 * newest, so «طلباتي» and the live pill stop growing with every order a customer ever placed.
 */
describe('a person’s orders', () => {
  async function three() {
    const h = ordersHarness();
    const placed = [];
    for (let i = 0; i < 3; i++) {
      placed.push(await h.orders.place('c1', h.foodInput()));
      h.clock.advance(60_000);
    }
    return { h, placed };
  }

  it('lists every order newest first, the same as reading each one', async () => {
    const { h, placed } = await three();
    const listed = await h.orders.listForPerson('c1');
    expect(listed.map((o) => o.id)).toEqual(placed.map((o) => o.id).reverse());
    for (const o of listed) expect(o).toEqual(await h.orders.get(o.id));
  });

  it('keeps only the newest when given a limit', async () => {
    const { h, placed } = await three();
    expect((await h.orders.listForPerson('c1', { limit: 2 })).map((o) => o.id)).toEqual([placed[2]!.id, placed[1]!.id]);
    expect(await h.orders.listForPerson('nobody', { limit: 2 })).toEqual([]);
  });

  it('the batched read builds the same view as a single order read', async () => {
    const { h, placed } = await three();
    const [agg] = await h.repo.aggregatesForPerson('c1', { limit: 1 });
    expect(toOrderView(agg!)).toEqual(await h.orders.get(placed[2]!.id));
  });
});
