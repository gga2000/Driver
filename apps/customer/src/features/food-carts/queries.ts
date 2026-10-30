import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LatLng } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** A minute: carts open and close through the evening, the list re-reads that often while shown. */
const LIST_STALE_MS = 60_000;

/** «عربانات العزيزية»: open now (nearest first) and the closed ones; public like the food catalog. */
export function useCarts(near: LatLng | null) {
  const api = useApi();
  return useQuery({ ...api.foodCarts.list.queryOptions(near ? { near } : {}), staleTime: LIST_STALE_MS, refetchInterval: LIST_STALE_MS });
}

/** One cart with its whole menu. */
export function useFoodCart(cartId: string, near: LatLng | null) {
  const api = useApi();
  return useQuery({ ...api.foodCarts.get.queryOptions({ cartId, ...(near ? { near } : {}) }), staleTime: LIST_STALE_MS, enabled: cartId.length > 0 });
}

/** «تابع»: follow or stop following; the list and the cart re-read so every bell agrees. */
export function useFollowCart() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.foodCarts.follow.mutationOptions(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: api.foodCarts.list.queryKey() });
      void qc.invalidateQueries({ queryKey: api.foodCarts.get.queryKey() });
    },
  });
}

/** The person's walk-over tickets of the last day (signed in only). */
export function useMyWalkups() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.foodCarts.walkups.mine.queryOptions(), enabled: signedIn, staleTime: 15_000, refetchInterval: 15_000 });
}

export function usePlaceWalkup() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.foodCarts.walkups.place.mutationOptions(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: api.foodCarts.walkups.mine.queryKey() }),
  });
}

export function useCancelWalkup() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.foodCarts.walkups.cancel.mutationOptions(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: api.foodCarts.walkups.mine.queryKey() }),
  });
}
