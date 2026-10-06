import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CITY_ID, useDeliverTo } from '@/features/food/queries';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** «العزيزية اليوم» (joy h2): today's pots in town (`catalog.pots`, public); `followed` when signed in. */
export function usePots() {
  const api = useApi();
  const { dropoff } = useDeliverTo();
  return useQuery({
    ...api.catalog.pots.queryOptions({ cityId: CITY_ID, ...(dropoff ? { dropoff } : {}) }),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/** «طلبك المعتاد؟» (joy s3): the person's usuals from their own orders (`orders.usuals`). */
export function useUsuals() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.orders.usuals.queryOptions(), enabled: signedIn, staleTime: 10 * 60_000 });
}

/** The dishes this person follows (the item sheet's bell). */
export function useDishFollows() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.catalog.dishFollows.queryOptions(), enabled: signedIn, staleTime: 5 * 60_000 });
}

/**
 * «خبرني لمن يطبخوه»: follow or stop following a dish. The answer replaces the follows list; the pots
 * strip and the menu re-read so every bell agrees.
 */
export function useFollowDish() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.catalog.followDish.mutationOptions(),
    onSuccess: (follows) => {
      qc.setQueryData(api.catalog.dishFollows.queryKey(), follows);
      void qc.invalidateQueries({ queryKey: api.catalog.pots.queryKey() });
    },
  });
}
