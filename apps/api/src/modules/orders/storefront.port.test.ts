import { describe, expect, it } from 'vitest';
import type { OrderAggregate } from './orders.repository.js';
import { OrdersStorefrontMerchants } from './storefront.port.js';

const agg = (state: string, items: Array<string | null>, removed: string[] = []): OrderAggregate =>
  ({
    order: { state },
    lines: items.map((id) => ({ catalogItemId: id, substitution: id && removed.includes(id) ? { state: 'removed' } : null })),
    participants: [],
  }) as unknown as OrderAggregate;

describe('dishOrderCounts (joy o8)', () => {
  it('counts each dish once per order, leaving out refused and cancelled orders and removed lines', async () => {
    const orders = [agg('closed', ['kebab', 'kebab', 'pepsi']), agg('delivered', ['kebab', null]), agg('merchant_rejected', ['kebab']), agg('preparing', ['pepsi', 'soup'], ['soup'])];
    const m = new OrdersStorefrontMerchants({ profile: async () => null }, undefined, { merchantOrdersBetween: async () => orders });
    const counts = await m.dishOrderCounts('org_1', new Date(0), new Date());
    expect(Object.fromEntries(counts)).toEqual({ kebab: 2, pepsi: 2 });
  });
});
