import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { CITY_ID, useDeliverTo } from '@/features/food/queries';

/** The front door «السوق» (`shopping.front`): stalls with today's prices and bakeries with their state. Public. */
export function useShoppingFront() {
  const api = useApi();
  const { dropoff } = useDeliverTo();
  return useQuery({
    ...api.shopping.front.queryOptions({ cityId: CITY_ID, ...(dropoff ? { near: dropoff } : {}) }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

/** One stall with its posted prices (`shopping.stall`). */
export function useStall(id: string | undefined) {
  const api = useApi();
  const { dropoff } = useDeliverTo();
  return useQuery({
    ...api.shopping.stall.queryOptions({
      cityId: CITY_ID,
      id: id ?? '',
      ...(dropoff ? { near: dropoff } : {}),
    }),
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

/** One bakery, open, paused or closed (`shopping.bakery`). */
export function useBakery(id: string | undefined) {
  const api = useApi();
  const { dropoff } = useDeliverTo();
  return useQuery({
    ...api.shopping.bakery.queryOptions({
      cityId: CITY_ID,
      id: id ?? '',
      ...(dropoff ? { near: dropoff } : {}),
    }),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/** The shops in the app a دوّرلي item can be bought from, filtered by what he types. */
export function useAppShops(search: string) {
  const api = useApi();
  return useQuery({
    ...api.shopping.appShops.queryOptions({ cityId: CITY_ID, search: search.trim() }),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}
