import type { DealBadge, DeliveryPoint } from '@driver/contracts';
import type { StorefrontMerchants } from '../catalog/index.js';
import type { MerchantDirectory } from './merchants.port.js';
import { busyExtraMinutes } from './busy.js';
import { CITY_PAUSE_WINDOWS, DEFAULT_TIMEZONE } from './orders.config.js';
import type { OrdersRepository } from './orders.repository.js';
import type { PromotionsPort } from './promotions.port.js';
import { ShopLoad, tabletOffline } from './shop-load.js';

/** Orders that did not happen don't make a dish popular. */
const NOT_COUNTED = new Set(['merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'refunded', 'failed']);

/**
 * The customer catalog's view of a merchant (`catalog.restaurants` / `catalog.menu`): the kitchen
 * point and the pause windows this module enforces at placement, so a card is "open" exactly when
 * `orders.place` would take the order. A merchant the directory doesn't hold gets the city defaults
 * and no location (no fee preview: it can't be ordered from either).
 */
export class OrdersStorefrontMerchants implements StorefrontMerchants {
  readonly timeZone = DEFAULT_TIMEZONE;

  constructor(
    private readonly directory: Pick<MerchantDirectory, 'profile' | 'changeStamp'>,
    private readonly promotions?: Pick<PromotionsPort, 'badges'>,
    private readonly orders?: Pick<OrdersRepository, 'merchantOrdersBetween' | 'findMany'>,
  ) {
    this.load = orders ? new ShopLoad(orders) : null;
  }

  private readonly load: ShopLoad | null;

  /** Joy o8: per dish, how many of the kitchen's orders in the window had it (once per order). */
  async dishOrderCounts(orgId: string, since: Date, until: Date): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (!this.orders) return counts;
    for (const agg of await this.orders.merchantOrdersBetween(orgId, since, until)) {
      if (NOT_COUNTED.has(agg.order.state)) continue;
      const dishes = new Set(agg.lines.filter((l) => l.catalogItemId && l.substitution?.state !== 'removed').map((l) => l.catalogItemId!));
      for (const id of dishes) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  /** x1: when a merchant's settings last changed on this instance (the lists' snapshot rebuilds). */
  changeStamp(): number {
    return this.directory.changeStamp?.() ?? 0;
  }

  /** Live merchant deals for the card badge (the same deals `orders.quote` / `place` apply). */
  async deals(orgId: string, at: Date = new Date()): Promise<DealBadge[]> {
    return this.promotions ? this.promotions.badges(orgId, at) : [];
  }

  async profile(
    orgId: string,
    cityId: string,
    at: Date = new Date(),
  ): Promise<{ location: DeliveryPoint | null; pauseWindows: Array<{ dow: number; start: string; end: string }>; busy?: boolean; closed?: boolean; reopensAt?: Date; holiday?: boolean }> {
    const p = await this.directory.profile(orgId);
    if (!p) return { location: null, pauseWindows: [...(CITY_PAUSE_WINDOWS[cityId] ?? [])] };
    // Busy mode and an early close from the Merchant app show on the customer's card too; so do a
    // tablet offline for 5 minutes (h5: paused, as `orders.place` refuses) and 15 orders waiting (l4: busy).
    // A quick pause's return time shows only while the tablet is online: offline, the shop stays closed
    // past that time until the tablet is back, so the card shows paused with no time.
    const busy = busyExtraMinutes(p, at) > 0 || (this.load !== null && (await this.load.crowded(orgId, at)));
    const offline = tabletOffline(p, at);
    return { location: p.location, pauseWindows: p.pauseWindows, busy, closed: Boolean(p.closed) || offline, ...(p.reopensAt && !offline ? { reopensAt: p.reopensAt } : {}), ...(p.holiday ? { holiday: true } : {}) };
  }
}
