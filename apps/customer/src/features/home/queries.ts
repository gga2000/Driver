import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { TERMINAL_ORDER_STATES, type Order, type OrderState, type RestaurantCard } from '@driver/contracts';
import { CITY_ID, useDeliverTo } from '@/features/food/queries';
import { FIXTURE_RAJAA } from '@/fixtures/rajaa';
import { useQuery } from '@tanstack/react-query';
import { TERMINAL_ORDER_STATES, type Order, type OrderState } from '@driver/contracts';
import { fetchFixtureRestaurants, type RestaurantSummary } from '@/fixtures/restaurants';
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

/** Most recent order still in progress, for the pinned pill. Polls while one is active. */
export function useActiveOrder() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.orders.mine.queryOptions(),
    enabled: signedIn,
    select: (orders: Order[]) => orders.filter(isActiveOrder).sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())[0] ?? null,
    refetchInterval: (q) => (q.state.data?.some(isActiveOrder) ? 15_000 : false),
  });
}

/**
 * Restaurants for the home rails: `catalog.restaurants` for the deliver-to zone (fee preview and
 * ETA), favourites from the person's own orders (a curated default for new people).
 */
export function useRestaurants() {
  const api = useApi();
  const signedIn = useSignedIn();
  const { dropoff } = useDeliverTo();
  const mine = useMyOrders();
  const ordered = useMemo(() => [...new Set((mine.data ?? []).map((o) => o.merchantOrgId).filter((id): id is string => Boolean(id)))], [mine.data]);
  return useQuery({
    ...api.catalog.restaurants.queryOptions({ cityId: CITY_ID, ...(dropoff ? { dropoff } : {}), filters: {} }),
    enabled: signedIn,
    placeholderData: keepPreviousData,
    select: (cards: RestaurantCard[]): RestaurantSummary[] => {
      const fav = favouriteIds(cards, ordered);
      return cards.map((c) => toSummary(c, fav.has(c.id)));
    },
  });
}
