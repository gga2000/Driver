import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LIVE_RULES, type CourierPosition, type OrderRoute, type OrderTracking } from '@driver/contracts';
import { liteInterval, useLiteMode } from '@driver/ui';
import { useApi } from '@/lib/api';
import { useLiveChannel, useLivePollMs } from '@/lib/live';
import { useSignedIn } from '@/lib/session';
import { ROUTE_STALE_MS } from './motion';
import { phaseOf } from './timeline';

/**
 * The live order screen is pushed (`live.order` over SSE): state changes, the courier's position
 * (≤ every 2 s, only inside the sharing window) and chat badges arrive as events. The queries keep a
 * slow safety refetch while the stream is live and poll every 30 s when SSE does not get through.
 */
export const liveOrderKey = (orderId: string) => `order:${orderId}`;

/** Fixes arrive at most this often (server throttle); the map marker glides over one interval. */
export const POSITION_POLL_MS = LIVE_RULES.positionThrottleMs;

const LIVE_PHASES = new Set(['waiting_merchant', 'preparing', 'searching', 'reassigning', 'to_pickup', 'at_pickup', 'on_the_way', 'unreachable']);

export function isLive(v: OrderTracking | undefined): boolean {
  return Boolean(v && LIVE_PHASES.has(phaseOf(v)));
}

/**
 * Keeps `live.order` open while the order screen is up: patches the courier position and the order
 * state into the cache as they arrive, invalidates the rest, and re-reads everything on reconnect.
 */
export function useLiveOrder(orderId: string, enabled = true) {
  const signedIn = useSignedIn();
  return useLiveChannel({
    enabled: signedIn && enabled && Boolean(orderId),
    key: liveOrderKey(orderId),
    subscribe: (client, h) => client.live.order.subscribe({ orderId }, h),
    resyncKeys: ['orders.track', 'orders.courierPosition', 'chat.threads'],
    onEvent: (e, qc, api) => {
      if (e.type === 'position' && e.orderId === orderId) {
        const fix: CourierPosition = {
          tripId: e.tripId,
          pin: e.pin,
          bearing: e.bearing,
          speedKmh: e.speedKmh,
          at: e.at,
          ageSec: Math.max(0, Math.round((Date.now() - new Date(e.at).getTime()) / 1000)),
          // The server's one ETA (maps program SP4b); older servers send none and the screen estimates.
          etaAt: e.etaAt ?? null,
          etaBasis: e.etaBasis ?? null,
        };
        qc.setQueryData(api.orders.courierPosition.queryKey({ orderId }), fix);
      } else if (e.type === 'order_state' && e.orderId === orderId) {
        // The new state shows at once; the invalidation that follows re-reads the full view.
        qc.setQueryData(api.orders.track.queryKey({ orderId }), (v: OrderTracking | undefined) => (v ? { ...v, order: { ...v.order, state: e.state } } : v));
      }
    },
  });
}

/** `orders.track`: own order + trip summary + courier card. */
export function useTracking(orderId: string) {
  const api = useApi();
  const signedIn = useSignedIn();
  const pollMs = useLivePollMs(liveOrderKey(orderId));
  return useQuery({
    ...api.orders.track.queryOptions({ orderId }),
    enabled: signedIn && Boolean(orderId),
    staleTime: 0,
    refetchInterval: pollMs,
  });
}

/** `orders.courierPosition`: only between accept and complete (null otherwise); pushed by `live.order`. */
export function useCourierPosition(orderId: string, enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  const pollMs = useLivePollMs(liveOrderKey(orderId));
  return useQuery({
    ...api.orders.courierPosition.queryOptions({ orderId }),
    enabled: signedIn && enabled,
    staleTime: 0,
    refetchInterval: enabled ? pollMs : false,
    // Keep the last fix while a poll is in flight or fails (signal lost shows its age instead).
    placeholderData: (prev: CourierPosition | null | undefined) => prev,
  });
}

/**
 * `orders.route`: the road still ahead for this order (maps program SP5a). Refreshed every two
 * minutes, whenever `stage` changes (picked up, at the door…) and when the map sees the courier stray
 * from it (`refetch`). Keeps the last road while a refresh is in flight.
 */
export function useOrderRoute(orderId: string, enabled: boolean, stage: string) {
  const api = useApi();
  const lite = useLiteMode();
  const signedIn = useSignedIn();
  const q = useQuery({
    ...api.orders.route.queryOptions({ orderId }),
    enabled: signedIn && enabled,
    staleTime: ROUTE_STALE_MS,
    // Low-data mode (maps program q2): the road is re-read three times less often.
    refetchInterval: enabled ? liteInterval(ROUTE_STALE_MS, lite) : false,
    placeholderData: (prev: OrderRoute | undefined) => prev,
  });
  const { refetch } = q;
  useEffect(() => {
    if (enabled) void refetch();
  }, [stage, enabled, refetch]);
  return q;
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
    Promise.all([
      qc.invalidateQueries({ queryKey: api.orders.track.queryKey({ orderId }) }),
      qc.invalidateQueries({ queryKey: api.orders.mine.queryKey() }),
      qc.invalidateQueries({ queryKey: api.orders.history.queryKey() }),
    ]);
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

/** «تحب تكرم عباس؟» after a 4–5 rating: whether to ask and the wallet chips (the server decides). */
export function useTipOptions(orderId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({ ...api.orders.tipOptions.queryOptions({ orderId }), enabled: enabled && orderId.length > 0 });
}

/** The tip after the rating, from the wallet: refreshes the offer and the wallet. */
export function useTipOrder(orderId: string) {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.orders.tip.mutationOptions(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: api.orders.tipOptions.queryKey({ orderId }) });
      void qc.invalidateQueries({ queryKey: api.wallet.balance.queryKey() });
      void qc.invalidateQueries({ queryKey: api.wallet.transactions.queryKey() });
    },
  });
}
