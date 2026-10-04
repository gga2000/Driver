import type { RestaurantSummary } from '@/features/home/restaurant-summary';

/**
 * The full restaurant list ("شوف الكل", audit C-02): sort and filter, pure so it is tested. Closed
 * kitchens are never filtered away by the sort; they go to their own section at the bottom with when
 * they open (unless "مفتوح هسة" is on).
 */

export type ListSort = 'nearest' | 'fastest' | 'rating';

export interface ListFilters {
  openNow?: boolean;
  freeDelivery?: boolean;
  deals?: boolean;
  /** A cuisine tag (`grill`, `shawarma`…). */
  cuisine?: string | null;
}

/** Cuisine tags with an Arabic chip label (`cuisine.<tag>` keys); others are not offered as chips. */
export const CUISINE_TAGS = ['grill', 'kebab', 'shawarma', 'chicken', 'rice', 'falafel', 'sandwiches', 'pastry', 'breakfast', 'pacha', 'tikka', 'liver'] as const;
export type CuisineTag = (typeof CUISINE_TAGS)[number];

/** Door time for "الأقرب": prep + ride when a place is set, prep alone otherwise. */
function doorMinutes(r: RestaurantSummary): number {
  return r.etaMinMinutes ?? r.prepMinMinutes;
}

const SORTS: Record<ListSort, (a: RestaurantSummary, b: RestaurantSummary) => number> = {
  // Nearest: the ride is what differs between kitchens at one address; ETA minus prep is the ride.
  nearest: (a, b) => (a.etaMinMinutes !== null && b.etaMinMinutes !== null ? a.etaMinMinutes - a.prepMinMinutes - (b.etaMinMinutes - b.prepMinMinutes) : 0) || doorMinutes(a) - doorMinutes(b),
  fastest: (a, b) => doorMinutes(a) - doorMinutes(b) || a.prepMaxMinutes - b.prepMaxMinutes,
  // New kitchens (no rating yet) after rated ones; more ratings break a tie.
  rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.ratingCount - a.ratingCount,
};

export function applyList(list: readonly RestaurantSummary[], sort: ListSort, f: ListFilters): { open: RestaurantSummary[]; closed: RestaurantSummary[] } {
  const kept = list.filter(
    (r) =>
      (!f.openNow || r.open) &&
      (!f.freeDelivery || (r.deliveryFeeIqd !== null && r.deliveryFeeIqd <= 0)) &&
      (!f.deals || r.dealCount > 0) &&
      (!f.cuisine || r.tags.includes(f.cuisine)),
  );
  const cmp = (a: RestaurantSummary, b: RestaurantSummary) => SORTS[sort](a, b) || a.name.localeCompare(b.name, 'ar');
  return { open: kept.filter((r) => r.open).sort(cmp), closed: kept.filter((r) => !r.open).sort(cmp) };
}

/** Cuisine chips worth showing: tags that at least one kitchen has, most common first. */
export function cuisineOptions(list: readonly RestaurantSummary[]): CuisineTag[] {
  const counts = new Map<CuisineTag, number>();
  for (const r of list) for (const tag of r.tags) if ((CUISINE_TAGS as readonly string[]).includes(tag)) counts.set(tag as CuisineTag, (counts.get(tag as CuisineTag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || CUISINE_TAGS.indexOf(a[0]) - CUISINE_TAGS.indexOf(b[0])).map(([tag]) => tag);
}

/** "الأعلى تقييماً" only makes sense once some kitchen has a rating. */
export function hasRatings(list: readonly RestaurantSummary[]): boolean {
  return list.some((r) => r.rating !== null);
}

/** "توصيل مجاني" only when a fee is known (a place is picked) and some kitchen delivers free. */
export function hasFreeDelivery(list: readonly RestaurantSummary[]): boolean {
  return list.some((r) => r.deliveryFeeIqd !== null && r.deliveryFeeIqd <= 0);
}

export function activeFilterCount(f: ListFilters): number {
  return [f.openNow, f.freeDelivery, f.deals, Boolean(f.cuisine)].filter(Boolean).length;
}
