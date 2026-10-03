import { useQuery } from '@tanstack/react-query';
import { TERMINAL_ORDER_STATES, type Order, type OrderState } from '@driver/contracts';
import { FIXTURE_RAJAA } from '@/fixtures/rajaa';
import { fetchFixtureRestaurants, type RestaurantSummary } from '@/fixtures/restaurants';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

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
 * Restaurants for the home rails. FIXTURE: no customer catalog read exists yet
 * (see src/fixtures/restaurants.ts); swap the queryFn for `api.catalog.*` when it lands.
 */
export function useRestaurants() {
  return useQuery<RestaurantSummary[]>({ queryKey: ['fixtures', 'restaurants'], queryFn: () => fetchFixtureRestaurants() });
}

/** TODO(api): intercity departures board. Static sample until then. */
export function useRajaaSummary() {
  return FIXTURE_RAJAA;
}
