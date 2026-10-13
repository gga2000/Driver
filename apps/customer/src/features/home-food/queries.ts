import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { CITY_ID, useDeliverTo } from '@/features/food/queries';

/** أكل بيت: the city's home kitchens, priced for the deliver-to place (public, guests browse too). */
export function useHomeKitchens() {
  const api = useApi();
  const { dropoff } = useDeliverTo();
  return useQuery({
    ...api.catalog.homeKitchens.queryOptions({ cityId: CITY_ID, ...(dropoff ? { dropoff } : {}) }),
    placeholderData: keepPreviousData,
  });
}

/**
 * A reserve dish's bookable week (`catalog.homeSlots`). Fresh each time the sheet opens: plates at a
 * time go fast, so a stale «باقي 2» is never trusted.
 */
export function useHomeSlots(merchantId: string, itemId: string | null) {
  const api = useApi();
  return useQuery({
    ...api.catalog.homeSlots.queryOptions({ merchantId, itemId: itemId ?? '' }),
    enabled: itemId !== null,
    staleTime: 0,
  });
}
