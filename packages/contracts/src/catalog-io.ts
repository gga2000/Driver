import { z } from 'zod';
import { CityId, DeliveryPoint, Iqd } from './common.js';
import { DealBadge } from './deals.js';
import type { Actor } from './identity-io.js';
import type { Quote } from './pricing.js';

/**
 * Customer catalog read (M3 food ordering): restaurant cards for the home rails and search, and a
 * restaurant's menu for the restaurant page and item sheet. Prices are the server's menu prices
 * (the same ones `orders.place` charges); the delivery fee preview is the server's own quote for
 * the customer's zone, split the way orders splits it (`deliveryFeesOf`).
 */

export const RestaurantFilters = z.object({
  /** Only kitchens taking orders right now. */
  openNow: z.boolean().optional(),
  /** Only kitchens whose delivery fee preview to `dropoff` is 0. */
  freeDelivery: z.boolean().optional(),
  /** Matches the name, the cuisine line or a dish name. */
  query: z.string().trim().max(60).optional(),
  /** A cuisine tag slug (`grill`, `shawarma`…). */
  tag: z.string().max(40).optional(),
});
export type RestaurantFilters = z.infer<typeof RestaurantFilters>;

export const RestaurantsInput = z.object({
  cityId: CityId,
  /** The customer's deliver-to point; fee preview and ETA are for it. Without it both are null. */
  dropoff: DeliveryPoint.optional(),
  filters: RestaurantFilters.default({}),
});
export type RestaurantsInput = z.input<typeof RestaurantsInput>;

export const RestaurantRating = z.object({ avg: z.number().min(0).max(5), count: z.number().int().min(0) });
export type RestaurantRating = z.infer<typeof RestaurantRating>;

export const RestaurantCard = z.object({
  id: z.string(),
  cityId: CityId,
  name: z.string(),
  /** Short cuisine line ("كباب · تكة · كبد"). */
  cuisine: z.string(),
  tags: z.array(z.string()),
  photoUrl: z.string().nullable(),
  /** Placeholder until ratings are aggregated from orders; null = new kitchen. */
  rating: RestaurantRating.nullable(),
  /** Where couriers pick up (zone + pin): the cart quotes delivery from here. Null = cannot deliver yet. */
  pickup: DeliveryPoint.nullable(),
  /** Kitchen prep range in minutes (busy mode adds its buffer). */
  prepMinMinutes: z.number().int().min(0),
  prepMaxMinutes: z.number().int().min(0),
  /** Prep + ride to `dropoff`; null without a dropoff. */
  etaMinMinutes: z.number().int().min(0).nullable(),
  etaMaxMinutes: z.number().int().min(0).nullable(),
  /** The server's quote to `dropoff` (door hand-over, now); null without a dropoff or pickup. */
  deliveryFeeIqd: Iqd.nullable(),
  serviceFeeIqd: Iqd.nullable(),
  minOrderIqd: Iqd.min(0),
  /**
   * J-D6: the fee an order below `minOrderIqd` carries (the city's small-order fee, 500); 0 when the
   * kitchen has no minimum. The facts line «طلب أقل من 5,000 دينار عليه رسوم 500 دينار».
   */
  smallOrderFeeIqd: Iqd.min(0).optional(),
  open: z.boolean(),
  /** Why it is closed: outside opening hours, or a scheduled pause (Friday prayer). */
  closedReason: z.enum(['hours', 'paused']).nullable(),
  /** Next local opening time, 12-hour "7:00", when closed. */
  opensAt: z.string().nullable(),
  /** f12: minutes until it opens (closed by hours or a pause window); null when open or unknown. */
  opensInMin: z.number().int().min(0).nullable().optional(),
  /** Busy mode: prep takes longer. */
  busy: z.boolean(),
  /** Live merchant deals (badges); the server applies at most one at checkout (`orders.quote`). Always sent by the API. */
  deals: z.array(DealBadge).optional(),
});
export type RestaurantCard = z.infer<typeof RestaurantCard>;

export const MenuInput = z.object({
  merchantId: z.string().min(1),
  dropoff: DeliveryPoint.optional(),
});
export type MenuInput = z.input<typeof MenuInput>;

export const MenuModifier = z.object({
  id: z.string(),
  name: z.string(),
  /** Added to the item's unit price when chosen. */
  priceIqd: Iqd.min(0),
  available: z.boolean(),
});
export type MenuModifier = z.infer<typeof MenuModifier>;

export const MenuModifierGroup = z.object({
  id: z.string(),
  name: z.string(),
  required: z.boolean(),
  /** Effective minimum (≥ 1 when required). */
  min: z.number().int().min(0),
  max: z.number().int().min(1),
  /**
   * A variant picks the version of the dish (size, weight): required, exactly one, and at least one
   * option changes the price. The sheet shows variants first with their full price.
   */
  variant: z.boolean(),
  modifiers: z.array(MenuModifier),
});
export type MenuModifierGroup = z.infer<typeof MenuModifierGroup>;

export const MenuItem = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceIqd: Iqd.min(0),
  photoUrl: z.string().nullable(),
  /** Orderable now: flag, stock, schedule and branch override all allow it. */
  available: z.boolean(),
  unavailableReason: z.enum(['sold_out', 'schedule']).nullable(),
  prepTimeMin: z.number().int().min(0),
  pointsEligible: z.boolean(),
  modifierGroups: z.array(MenuModifierGroup),
  /**
   * f10 (UI/UX audit F-02): the restaurant's live percent deal with no minimum that covers this dish
   * — the price one plain unit costs under it (`menuDealOf`, the rule `orders.quote` applies). Null
   * when no such deal; deals with a minimum show in the cart instead.
   */
  deal: z.object({ dealId: z.string(), percent: z.number().int().min(1).max(100), priceIqd: Iqd.min(0) }).nullable().optional(),
});
export type MenuItem = z.infer<typeof MenuItem>;

export const MenuCategory = z.object({
  id: z.string(),
  name: z.string(),
  items: z.array(MenuItem),
});
export type MenuCategory = z.infer<typeof MenuCategory>;

export const RestaurantMenu = z.object({
  restaurant: RestaurantCard,
  categories: z.array(MenuCategory),
});
export type RestaurantMenu = z.infer<typeof RestaurantMenu>;

/**
 * Customer search (`catalog.search`): restaurants and dishes for one typed query, Arabic-folded
 * (`foldArabic`: ة/ه, أ/ا/إ, ى/ي, گ/ك, leading "ال", Eastern digits). Public like the rest of the
 * catalog read; closed kitchens are included and marked, so they stay reachable.
 */
export const CatalogSearchInput = z.object({
  cityId: CityId,
  query: z.string().trim().min(1).max(60),
  dropoff: DeliveryPoint.optional(),
});
export type CatalogSearchInput = z.input<typeof CatalogSearchInput>;

export const CatalogSearchDish = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceIqd: Iqd.min(0),
  photoUrl: z.string().nullable(),
  /** Orderable now (sold out or outside its schedule = false). */
  available: z.boolean(),
  restaurantId: z.string(),
  restaurantName: z.string(),
  restaurantOpen: z.boolean(),
  /** The kitchen's next opening (12-hour "7:00") when it is closed. */
  restaurantOpensAt: z.string().nullable(),
});
export type CatalogSearchDish = z.infer<typeof CatalogSearchDish>;

export const CatalogSearchResult = z.object({
  /** The query as the server folded it (what was matched). */
  folded: z.string(),
  /** Kitchens whose name or cuisine matches, best match first, open before closed. */
  restaurants: z.array(RestaurantCard),
  /** Dishes whose name matches, best match first, from open kitchens first (at most `CATALOG_SEARCH_LIMITS.dishes`). */
  dishes: z.array(CatalogSearchDish),
});
export type CatalogSearchResult = z.infer<typeof CatalogSearchResult>;

export const CATALOG_SEARCH_LIMITS = { restaurants: 20, dishes: 30 } as const;

/**
 * Public catalog reads (guest browsing, Ali 2026-10-04): no account needed, limited per client IP.
 * Nothing in a card or a menu is personal.
 */
export const CATALOG_PUBLIC_RATE = { windowMs: 60_000, perIp: 120 } as const;

/** Who is reading: a signed-in person, or a guest seen only by the client IP (rate limits). */
export type CatalogReader = { actor: Actor | null; ip?: string | null };

export const CatalogTodayInput = z.object({ cityId: CityId });
export type CatalogTodayInput = z.input<typeof CatalogTodayInput>;

/**
 * `catalog.today` (audit d-6): the welcome screen's live proof and its captions, public and
 * guest-safe (counts and city facts only, nothing personal). Every number is the server's.
 */
export const CatalogToday = z.object({
  /** Kitchens taking orders right now (the same "open" as the restaurant list). */
  openRestaurants: z.number().int().min(0),
  /** الرجعة cars still to leave today (Baghdad day), both directions, not cancelled or past their latest time. */
  rajaaCarsToday: z.number().int().min(0),
  /** A tuktuk ride inside the town centre right now, from the city's fares; null when it can't be priced. */
  tuktukFromIqd: Iqd.nullable(),
  /** The Aziziyah garage of the next car to Baghdad (or the first garage when none is announced). */
  baghdadGarage: z.object({ id: z.string(), name_ar: z.string(), name_en: z.string() }).nullable(),
  /** The honest-delay promise: more than this many minutes late and the delivery fee comes back as credit. */
  latePromiseMin: z.number().int().positive(),
});
export type CatalogToday = z.infer<typeof CatalogToday>;

/** What the API supplies to the `catalog` router (implemented by `modules/catalog`). */
export interface CustomerCatalogPort {
  restaurants(reader: Actor | CatalogReader, input: z.infer<typeof RestaurantsInput>): Promise<RestaurantCard[]>;
  menu(reader: Actor | CatalogReader, input: z.infer<typeof MenuInput>): Promise<RestaurantMenu>;
  search(reader: Actor | CatalogReader, input: z.infer<typeof CatalogSearchInput>): Promise<CatalogSearchResult>;
  today(reader: Actor | CatalogReader, input: z.infer<typeof CatalogTodayInput>): Promise<CatalogToday>;
}

/**
 * Splits a delivery quote the way `orders.place` charges it: the service fee is its own line, the
 * delivery fee is every other shown component (base by zone pair, door/street, night…), promo
 * excluded (discounts only come from a server-resolved promotion). Shared by the API's fee preview
 * and the customer cart so the total never changes at checkout.
 */
export function deliveryFeesOf(quote: Pick<Quote, 'components'>): { deliveryFeeIqd: number; serviceFeeIqd: number } {
  let delivery = 0;
  let service = 0;
  for (const c of quote.components) {
    if (c.key === 'service_fee') service += c.amount;
    else if (c.key !== 'promo') delivery += c.amount;
  }
  return { deliveryFeeIqd: Math.max(0, delivery), serviceFeeIqd: Math.max(0, service) };
}
