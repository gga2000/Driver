import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import type { RestaurantMenu } from '@driver/contracts';
import { CITY_ID, useDeliverTo } from '@/features/food/queries';
import { useApi } from '@/lib/api';
import type { CravingKind } from './cravings';

/**
 * «شنو بخاطرك؟» (`catalog.cravings`): for each kind of thing in a door, the open shops that have it and
 * their dish, priced for the deliver-to zone. Public like the rest of the catalog; one read per door.
 */
export function useCravings(kinds: readonly CravingKind[]) {
  const api = useApi();
  const { dropoff } = useDeliverTo();
  return useQuery({
    ...api.catalog.cravings.queryOptions({
      cityId: CITY_ID,
      kinds: kinds.map((k) => ({ key: k.key, words: [...k.words] })),
      ...(dropoff ? { dropoff } : {}),
    }),
    enabled: kinds.length > 0,
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/** The menus of a few shops at once (the tray tries the door's best shops in turn). */
export function useMenus(ids: readonly string[]): { menus: Array<RestaurantMenu | undefined>; pending: boolean; failed: boolean } {
  const api = useApi();
  const { dropoff } = useDeliverTo();
  const results = useQueries({
    queries: ids.map((merchantId) => ({
      ...api.catalog.menu.queryOptions({ merchantId, ...(dropoff ? { dropoff } : {}) }),
      staleTime: 60_000,
    })),
  });
  return {
    menus: results.map((r) => r.data),
    pending: results.some((r) => r.isPending),
    failed: results.length > 0 && results.every((r) => r.isError),
  };
}
