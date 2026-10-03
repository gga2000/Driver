import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DriverError,
  PriceRequest,
  deliveryFeesOf,
  type Actor,
  type CustomerCatalogPort,
  type DeliveryPoint,
  type MenuInput,
  type Quote,
  type RestaurantCard,
  type RestaurantMenu,
  type RestaurantsInput,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, SystemClock, type Clock } from '../../shared/clock.js';
import { PricingService } from '../pricing/index.js';
import type { CatalogItemRecord, StorefrontRecord } from './catalog.repository.js';
import { CatalogService } from './catalog.service.js';
import { basePrepMin, etaRange, foldArabic, menuSections, openState, prepRange, rideMinutes } from './storefront.js';

/** The quote engine the fee preview uses: the same one `orders.place` locks fees with. */
export interface StorefrontPricing {
  quote(req: PriceRequest): Quote;
}

/**
 * Merchant facts the card needs from the merchant directory orders reads: where couriers pick up and
 * the effective pause windows (the merchant's own or the city's defaults, e.g. Friday prayer) — the
 * same ones `orders.place` refuses inside. Bound by the orders module (`OrdersStorefrontMerchants`),
 * which also wires `CatalogRpc`, so catalog never imports orders.
 */
export interface StorefrontMerchants {
  /** Local time zone opening hours and pause windows are in. */
  readonly timeZone: string;
  profile(
    orgId: string,
    cityId: string,
    at?: Date,
  ): Promise<{
    location: DeliveryPoint | null;
    pauseWindows: Array<{ dow: number; start: string; end: string }>;
    /** Busy mode switched on from the Merchant app (auto-expiring). */
    busy?: boolean;
    /** Closed by hand from the Merchant app (early close). */
    closed?: boolean;
  }>;
}

export const STOREFRONT_MERCHANTS = Symbol('STOREFRONT_MERCHANTS');

/**
 * The customer catalog read (`catalog.restaurants`, `catalog.menu`, M3). Composes the catalog's
 * storefronts and menus with the merchant's settings from orgs (location, pause windows), busy mode,
 * and a fee preview from the pricing engine split exactly as `orders.place` charges it, so the
 * delivery fee on a card is the one the customer pays at checkout (door hand-over, now).
 */
@Injectable()
export class CatalogRpc implements CustomerCatalogPort {
  private readonly clock: Clock;

  constructor(
    private readonly catalog: CatalogService,
    @Inject(STOREFRONT_MERCHANTS) private readonly merchants: StorefrontMerchants,
    @Inject(PricingService) private readonly pricing: StorefrontPricing,
    @Optional() @Inject(CLOCK) clock?: Clock,
  ) {
    this.clock = clock ?? new SystemClock();
  }

  async restaurants(_actor: Actor, input: z.infer<typeof RestaurantsInput>): Promise<RestaurantCard[]> {
    const now = this.clock.now();
    const fronts = await this.catalog.storefronts(input.cityId);
    const f = input.filters;
    const q = f.query ? foldArabic(f.query) : '';
    const cards: RestaurantCard[] = [];
    for (const s of fronts) {
      const items = await this.catalog.menu(s.orgId);
      if (q && !this.matches(s, items, q)) continue;
      if (f.tag && !s.tags.includes(f.tag)) continue;
      const card = await this.card(s, items, input.dropoff ?? null, now);
      if (f.openNow && !card.open) continue;
      if (f.freeDelivery && card.deliveryFeeIqd !== 0) continue;
      cards.push(card);
    }
    // Open kitchens first, then the quickest to the door, then by name.
    return cards.sort(
      (a, b) =>
        Number(b.open) - Number(a.open) ||
        (a.etaMinMinutes ?? a.prepMinMinutes) - (b.etaMinMinutes ?? b.prepMinMinutes) ||
        a.name.localeCompare(b.name, 'ar'),
    );
  }

  async menu(_actor: Actor, input: z.infer<typeof MenuInput>): Promise<RestaurantMenu> {
    const s = await this.catalog.storefront(input.merchantId);
    if (!s) throw new DriverError('org_not_found');
    const now = this.clock.now();
    const items = await this.catalog.menu(s.orgId);
    return { restaurant: await this.card(s, items, input.dropoff ?? null, now), categories: menuSections(items, now, this.merchants.timeZone) };
  }

  private matches(s: StorefrontRecord, items: readonly CatalogItemRecord[], q: string): boolean {
    return [s.nameAr, s.cuisineAr, ...items.map((i) => i.nameAr)].some((text) => foldArabic(text).includes(q));
  }

  private async card(s: StorefrontRecord, items: readonly CatalogItemRecord[], dropoff: DeliveryPoint | null, now: Date): Promise<RestaurantCard> {
    const { location, pauseWindows: pauses, busy: merchantBusy, closed } = await this.merchants.profile(s.orgId, s.cityId, now);
    const busy = this.catalog.isBusy(s.orgId) || merchantBusy === true;
    const prep = prepRange(basePrepMin(s.prepMin, items), busy);
    const eta = location && dropoff ? etaRange(prep, rideMinutes(location, dropoff)) : null;
    const fees = location && dropoff ? this.feePreview(s.cityId, location, dropoff, now) : null;
    const state = closed ? { open: false, closedReason: 'paused' as const, opensAt: null } : openState(now, s.hours, pauses, this.merchants.timeZone);
    return {
      id: s.orgId,
      cityId: s.cityId,
      name: s.nameAr,
      cuisine: s.cuisineAr,
      tags: [...s.tags],
      photoUrl: s.photoUrl,
      rating: s.ratingPlaceholder,
      pickup: location,
      prepMinMinutes: prep.min,
      prepMaxMinutes: prep.max,
      etaMinMinutes: eta?.min ?? null,
      etaMaxMinutes: eta?.max ?? null,
      deliveryFeeIqd: fees?.deliveryFeeIqd ?? null,
      serviceFeeIqd: fees?.serviceFeeIqd ?? null,
      minOrderIqd: s.minOrderIqd,
      open: state.open,
      closedReason: state.closedReason,
      opensAt: state.opensAt,
      busy,
    };
  }

  /** The food quote from the kitchen's zone to the customer's, at the door; null when it cannot be priced. */
  private feePreview(cityId: string, pickup: DeliveryPoint, dropoff: DeliveryPoint, at: Date): { deliveryFeeIqd: number; serviceFeeIqd: number } | null {
    try {
      const quote = this.pricing.quote(
        PriceRequest.parse({
          cityId,
          vertical: 'food',
          stops: [
            { zoneId: pickup.zoneKey, type: 'pickup', ...(pickup.pin ? { pin: pickup.pin } : {}) },
            { zoneId: dropoff.zoneKey, type: 'dropoff', ...(dropoff.pin ? { pin: dropoff.pin } : {}) },
          ],
          options: { doorPickup: false, streetHandover: false },
          at,
        }),
      );
      return deliveryFeesOf(quote);
    } catch {
      return null;
    }
  }
}
