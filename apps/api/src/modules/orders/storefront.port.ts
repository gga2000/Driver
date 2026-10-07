import type { DealBadge, DeliveryPoint } from '@driver/contracts';
import type { StorefrontMerchants } from '../catalog/index.js';
import type { MerchantDirectory } from './merchants.port.js';
import { busyExtraMinutes } from './busy.js';
import { CITY_PAUSE_WINDOWS, DEFAULT_TIMEZONE } from './orders.config.js';
import type { OrdersRepository } from './orders.repository.js';
import type { PromotionsPort } from './promotions.port.js';

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
    private readonly directory: Pick<MerchantDirectory, 'profile'>,
    private readonly promotions?: Pick<PromotionsPort, 'badges'>,
    private readonly orders?: Pick<OrdersRepository, 'merchantOrdersBetween'>,
  ) {}

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
    // Busy mode and an early close from the Merchant app show on the customer's card too.
    return { location: p.location, pauseWindows: p.pauseWindows, busy: busyExtraMinutes(p, at) > 0, closed: Boolean(p.closed), ...(p.reopensAt ? { reopensAt: p.reopensAt } : {}), ...(p.holiday ? { holiday: true } : {}) };
  }
}
