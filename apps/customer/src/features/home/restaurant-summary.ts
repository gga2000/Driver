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
  favourite: boolean;
  /** Deal line for the "عروض اليوم" rail (none until promotions have a customer read). */
  deal?: string;
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
    favourite,
  };
}

/**
 * Favourites (spec §1): kitchens the person has ordered from, most recent first. New people get a
 * curated default — the two best-rated open kitchens.
 */
export function favouriteIds(cards: readonly RestaurantCard[], orderedMerchantIds: readonly string[]): Set<string> {
  const known = new Set(cards.map((c) => c.id));
  const mine = orderedMerchantIds.filter((id) => known.has(id));
  if (mine.length > 0) return new Set(mine);
  return new Set(
    [...cards]
      .filter((c) => c.open)
      .sort((a, b) => (b.rating?.avg ?? 0) - (a.rating?.avg ?? 0))
      .slice(0, 2)
      .map((c) => c.id),
  );
}
