import { describe, expect, it } from 'vitest';
import type { OrderAggregate } from './orders.repository.js';
import type { MerchantProfile } from './merchants.port.js';
import { SHOP_LOAD_RULES, ShopLoad, tabletOffline } from './shop-load.js';
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
    const m = new OrdersStorefrontMerchants({ profile: async () => null }, undefined, { merchantOrdersBetween: async () => orders, findMany: async () => [] });
    const counts = await m.dishOrderCounts('org_1', new Date(0), new Date());
    expect(Object.fromEntries(counts)).toEqual({ kebab: 2, pepsi: 2 });
  });
});

describe('shop load (Ali 2026-10-08: h5 tablet offline, l4 15 waiting orders)', () => {
  const at = new Date('2026-10-08T12:00:00Z');
  const ago = (min: number) => new Date(at.getTime() - min * 60_000);
  const profile = (hb: Date | null) => ({ location: null, pauseWindows: [], lastHeartbeatAt: hb }) as unknown as MerchantProfile;
  const waiting = (n: number, scheduledFor: Date | null = null) => Array.from({ length: n }, () => ({ scheduledFor }));

  it('h5: pauses a shop whose tablet has been silent for more than 5 minutes, never one that never connected', () => {
    expect(SHOP_LOAD_RULES.offlinePauseAfterMin).toBe(5);
    expect(tabletOffline(profile(ago(4.9)), at)).toBe(false);
    expect(tabletOffline(profile(ago(5)), at)).toBe(false);
    expect(tabletOffline(profile(ago(5.1)), at)).toBe(true);
    expect(tabletOffline(profile(null), at)).toBe(false);
  });

  it('h5: the card shows the shop closed while its tablet is offline', async () => {
    const m = new OrdersStorefrontMerchants({ profile: async () => profile(ago(6)) });
    expect((await m.profile('org_1', 'aziziyah', at)).closed).toBe(true);
    const fresh = new OrdersStorefrontMerchants({ profile: async () => profile(ago(1)) });
    expect((await fresh.profile('org_1', 'aziziyah', at)).closed).toBe(false);
  });

  it('l4: the card shows busy from 15 waiting orders, not counting scheduled ones not yet due', async () => {
    let rows: Array<{ scheduledFor: Date | null }> = waiting(14);
    const repo = { merchantOrdersBetween: async () => [], findMany: async () => rows as never };
    expect((await new OrdersStorefrontMerchants({ profile: async () => profile(null) }, undefined, repo).profile('org_1', 'aziziyah', at)).busy).toBe(false);
    rows = [...waiting(14), ...waiting(3, new Date(at.getTime() + 3_600_000))];
    expect((await new OrdersStorefrontMerchants({ profile: async () => profile(null) }, undefined, repo).profile('org_1', 'aziziyah', at)).busy).toBe(false);
    rows = waiting(15);
    expect((await new OrdersStorefrontMerchants({ profile: async () => profile(null) }, undefined, repo).profile('org_1', 'aziziyah', at)).busy).toBe(true);
  });

  it('l4: reads each shop at most once per 20 seconds', async () => {
    let reads = 0;
    const load = new ShopLoad({ findMany: async () => { reads += 1; return waiting(15) as never; } });
    await load.crowded('org_1', at);
    await load.crowded('org_1', new Date(at.getTime() + 19_000));
    expect(reads).toBe(1);
    await load.crowded('org_1', new Date(at.getTime() + 20_000));
    await load.crowded('org_2', at);
    expect(reads).toBe(3);
  });
});
