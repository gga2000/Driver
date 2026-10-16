import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OrderRoute } from '@driver/contracts';
import { ROUTE_STALE_MS } from '@/features/track/motion';
import { useApi, useApiClient } from '@/lib/api';
import { publicPageFailure, shouldRetryQuery } from '@/lib/errors';
import { useLiveChannel, useLivePollMs } from '@/lib/live';

export const liveShareKey = (token: string) => `share:${token}`;

/**
 * The shared trip on the public page (maps program SP5c). `live.share` pushes the whole trip as it
 * changes (≤ every 2 s while the car moves); the query keeps a slow safety refetch while the stream
 * is live and polls every 30 s when SSE does not get through. Only the page's first read counts as a
 * view (`again` on the rest), so the rider's count is people, not refreshes.
 */
export function useSharedTrip(token: string) {
  const api = useApi();
  const client = useApiClient();
  const counted = useRef(false);
  const mode = useLiveChannel({
    enabled: Boolean(token),
    key: liveShareKey(token),
    subscribe: (c, h) => c.live.share.subscribe({ token, again: true }, h),
    resyncKeys: [],
    onEvent: (e, qc) => {
      if (e.type === 'share') qc.setQueryData(api.tracking.shared.queryKey({ token }), e.trip);
    },
  });
  const pollMs = useLivePollMs(liveShareKey(token));
  const q = useQuery({
    queryKey: api.tracking.shared.queryKey({ token }),
    queryFn: () => {
      const again = counted.current;
      counted.current = true;
      return client.tracking.shared.query({ token, again });
    },
    enabled: Boolean(token),
    retry: shouldRetryQuery,
    staleTime: 0,
    // Keeps polling through a network or server failure (FLOW-07); stops when the trip ended or the link is over.
    refetchInterval: (s) =>
      (s.state.data && s.state.data.status !== 'ended') || (s.state.status === 'error' && publicPageFailure(s.state.error) === 'transient') ? pollMs : false,
  });
  return { ...q, live: mode === 'live' };
}

/**
 * The road from the car to where it is heading: refreshed every two minutes, when the leg changes
 * (`stage`) and when the map sees the car stray from it (`refetch`). Keeps the last road meanwhile.
 */
export function useSharedRoute(token: string, enabled: boolean, stage: string) {
  const api = useApi();
  const q = useQuery({
    ...api.tracking.sharedRoute.queryOptions({ token }),
    enabled,
    retry: false,
    staleTime: ROUTE_STALE_MS,
    refetchInterval: enabled ? ROUTE_STALE_MS : false,
    placeholderData: (prev: OrderRoute | undefined) => prev,
  });
  const { refetch } = q;
  useEffect(() => {
    if (enabled) void refetch();
  }, [stage, enabled, refetch]);
  return q;
}
