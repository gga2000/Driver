import type { RestaurantCard } from '@driver/contracts';

/** What a home-rail card shows, mapped from `catalog.restaurants` (plus the person's favourites). */
export interface RestaurantSummary {
  id: string;
  name: string;
  /** Short cuisine line under the name. */
  cuisine: string;
  zoneId: string | null;
  /** Null = new kitchen (no ratings yet). */
  rating: number | null;
  ratingCount: number;
  prepMinMinutes: number;
  prepMaxMinutes: number;
  /** Prep + ride to the deliver-to place; null before a place is picked. */
  etaMinMinutes: number | null;
  etaMaxMinutes: number | null;
  /** Null before a place is picked (the fee depends on the zone pair). */
  deliveryFeeIqd: number | null;
  minOrderIqd: number;
  open: boolean;
  /** 12-hour clock when closed ("5:00"). */
  opensAt?: string;
  /** f12: minutes until it opens, when closed (the night home's first to open). */
  opensInMin?: number;
  favourite: boolean;
  /** Deal line for the "عروض اليوم" rail (none until promotions have a customer read). */
  deal?: string;
  /** Cuisine tags (`grill`, `shawarma`…): the list's cuisine chips. */
  tags: string[];
  /** Live merchant deals (badges); the list's "عروض" filter. */
  dealCount: number;
  /** Opening hours and pause windows (joy s3: the «غدا الجمعة» slot). */
  hours?: Array<{ dow: number; start: string; end: string }>;
  pauses?: Array<{ dow: number; start: string; end: string }>;
}

export function toSummary(card: RestaurantCard, favourite: boolean): RestaurantSummary {
  return {
    id: card.id,
    name: card.name,
    cuisine: card.cuisine,
    zoneId: card.pickup?.zoneKey ?? null,
    rating: card.rating?.avg ?? null,
    ratingCount: card.rating?.count ?? 0,
    prepMinMinutes: card.prepMinMinutes,
    prepMaxMinutes: card.prepMaxMinutes,
    etaMinMinutes: card.etaMinMinutes,
    etaMaxMinutes: card.etaMaxMinutes,
    deliveryFeeIqd: card.deliveryFeeIqd,
    minOrderIqd: card.minOrderIqd,
    open: card.open,
    ...(card.opensAt ? { opensAt: card.opensAt } : {}),
    ...(card.opensInMin != null ? { opensInMin: card.opensInMin } : {}),
    favourite,
    tags: [...card.tags],
    dealCount: card.deals?.length ?? 0,
    hours: [...(card.hours ?? [])],
    pauses: [...(card.pauses ?? [])],
  };
}

/**
 * Favourites (spec §1): kitchens the person has really ordered from. A new account (or a guest) has
 * none, and gets no favourites rail: a curated "favourite" would be fake personalisation (audit C-16).
 */
export function favouriteIds(cards: readonly RestaurantCard[], orderedMerchantIds: readonly string[]): Set<string> {
  const known = new Set(cards.map((c) => c.id));
  return new Set(orderedMerchantIds.filter((id) => known.has(id)));
}
