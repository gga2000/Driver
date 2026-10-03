import type { DeliveryPoint } from '@driver/contracts';
import type { StorefrontMerchants } from '../catalog/index.js';
import type { MerchantDirectory } from './merchants.port.js';
import { CITY_PAUSE_WINDOWS, DEFAULT_TIMEZONE } from './orders.config.js';

/**
 * The customer catalog's view of a merchant (`catalog.restaurants` / `catalog.menu`): the kitchen
 * point and the pause windows this module enforces at placement, so a card is "open" exactly when
 * `orders.place` would take the order. A merchant the directory doesn't hold gets the city defaults
 * and no location (no fee preview: it can't be ordered from either).
 */
export class OrdersStorefrontMerchants implements StorefrontMerchants {
  readonly timeZone = DEFAULT_TIMEZONE;

  constructor(private readonly directory: Pick<MerchantDirectory, 'profile'>) {}

  async profile(orgId: string, cityId: string): Promise<{ location: DeliveryPoint | null; pauseWindows: Array<{ dow: number; start: string; end: string }> }> {
    const p = await this.directory.profile(orgId);
    if (!p) return { location: null, pauseWindows: [...(CITY_PAUSE_WINDOWS[cityId] ?? [])] };
    return { location: p.location, pauseWindows: p.pauseWindows };
  }
}
