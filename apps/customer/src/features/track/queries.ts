import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CourierPosition, OrderTracking } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';
import { phaseOf } from './timeline';

/** The courier's position is polled every 2 s while he works the job (spec: "2-s polled positions"). */
export const POSITION_POLL_MS = 2000;
/** The order/trip view moves slower: every 4 s while live, every 20 s once settled. */
const TRACK_POLL_LIVE_MS = 4000;
const TRACK_POLL_IDLE_MS = 20_000;

const LIVE_PHASES = new Set(['waiting_merchant', 'preparing', 'searching', 'reassigning', 'to_pickup', 'at_pickup', 'on_the_way', 'unreachable']);

export function isLive(v: OrderTracking | undefined): boolean {
  return Boolean(v && LIVE_PHASES.has(phaseOf(v)));
}

/** `orders.track`: own order + trip summary + courier card. */
export function useTracking(orderId: string) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.orders.track.queryOptions({ orderId }),
    enabled: signedIn && Boolean(orderId),
    staleTime: 0,
    refetchInterval: (q) => (isLive(q.state.data as OrderTracking | undefined) ? TRACK_POLL_LIVE_MS : TRACK_POLL_IDLE_MS),
  });
}

/** `orders.courierPosition`: only between accept and complete (null otherwise). */
export function useCourierPosition(orderId: string, enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.orders.courierPosition.queryOptions({ orderId }),
    enabled: signedIn && enabled,
    staleTime: 0,
    refetchInterval: enabled ? POSITION_POLL_MS : false,
    // Keep the last fix while a poll is in flight or fails (signal lost shows its age instead).
    placeholderData: (prev: CourierPosition | null | undefined) => prev,
  });
}

export function useCancellationPreview(orderId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({ ...api.orders.cancellationPreview.queryOptions({ orderId }), enabled, staleTime: 5_000 });
}

/** Mutations that change the order refresh the tracking view and the orders list. */
function useInvalidateOrder(orderId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return () =>
    Promise.all([qc.invalidateQueries({ queryKey: api.orders.track.queryKey({ orderId }) }), qc.invalidateQueries({ queryKey: api.orders.mine.queryKey() })]);
}

export function useCancelOrder(orderId: string) {
  const api = useApi();
  const invalidate = useInvalidateOrder(orderId);
  return useMutation({ ...api.orders.cancel.mutationOptions(), onSuccess: () => void invalidate() });
}

export function useOpenDispute(orderId: string) {
  const api = useApi();
  const invalidate = useInvalidateOrder(orderId);
  return useMutation({ ...api.orders.openDispute.mutationOptions(), onSuccess: () => void invalidate() });
}

export function useRateOrder(orderId: string) {
  const api = useApi();
  const invalidate = useInvalidateOrder(orderId);
  return useMutation({ ...api.orders.rate.mutationOptions(), onSuccess: () => void invalidate() });
}
