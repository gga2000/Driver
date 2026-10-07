import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { TERMINAL_ORDER_STATES, type Order, type OrderState, type RestaurantCard } from '@driver/contracts';
import { CITY_ID, useDeliverTo } from '@/features/food/queries';
import { isBookedRide } from '@/features/ride-habits/logic';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';
import { favouriteIds, toSummary, type RestaurantSummary } from './restaurant-summary';

/** States after which an order no longer needs the pinned pill on home. */
const DONE: ReadonlySet<OrderState> = new Set<OrderState>([...TERMINAL_ORDER_STATES, 'delivered', 'completed', 'disputed']);

export function isActiveOrder(o: Pick<Order, 'state'>): boolean {
  return !DONE.has(o.state);
}

/** The person's own orders (`orders.mine`), newest first. */
export function useMyOrders() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.orders.mine.queryOptions(),
    enabled: signedIn,
    select: (orders: Order[]) => [...orders].sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime()),
  });
}

/**
 * Most recent order still in progress, for the pinned pill. Polls while one is active. A ride booked
 * for later (joy J7d) is not "in progress" until its search starts: it has its own card.
 */
export function useActiveOrder() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.orders.mine.queryOptions(),
    enabled: signedIn,
    select: (orders: Order[]) => orders.filter((o) => isActiveOrder(o) && !isBookedRide(o, new Date())).sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())[0] ?? null,
    refetchInterval: (q) => (q.state.data?.some(isActiveOrder) ? 15_000 : false),
  });
}

/**
 * Real dishes for the hour (joy h1): `catalog.picks` with the daypart's words, from kitchens open now
 * (public, like the rest of the catalog). The band hides itself below `BAND_MIN_DISHES`.
 */
export function usePicks(words: readonly string[], limit = 3) {
  const api = useApi();
  const { dropoff } = useDeliverTo();
  return useQuery({
    ...api.catalog.picks.queryOptions({ cityId: CITY_ID, words: [...words], limit, ...(dropoff ? { dropoff } : {}) }),
    enabled: words.length > 0,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/**
 * Restaurants for the home rails and the full list: `catalog.restaurants` for the deliver-to zone
 * (fee preview and ETA). Public (guests browse too); favourites only from the person's own orders.
 */
export function useRestaurants() {
  const api = useApi();
  const { dropoff } = useDeliverTo();
  const mine = useMyOrders();
  const ordered = useMemo(() => [...new Set((mine.data ?? []).map((o) => o.merchantOrgId).filter((id): id is string => Boolean(id)))], [mine.data]);
  return useQuery({
    ...api.catalog.restaurants.queryOptions({ cityId: CITY_ID, ...(dropoff ? { dropoff } : {}), filters: {} }),
    placeholderData: keepPreviousData,
    select: (cards: RestaurantCard[]): RestaurantSummary[] => {
      const fav = favouriteIds(cards, ordered);
      return cards.map((c) => toSummary(c, fav.has(c.id)));
    },
  });
}

/** Joy J7d: the soonest ride booked for later whose search hasn't started yet, for its home card. */
export function useBookedRide() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.orders.mine.queryOptions(),
    enabled: signedIn,
    select: (orders: Order[]) => orders.filter((o) => isBookedRide(o, new Date())).sort((a, b) => (a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0))[0] ?? null,
  });
}
