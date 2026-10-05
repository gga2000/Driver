import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEMAND_MAP_RULES, isPartner, type OrderRoute } from '@driver/contracts';
import { useApi } from '@/lib/api';
import type { PartnerGate } from '@/lib/guard';
import { LIVE_PARTNER_KEY, useLiveChannel, useLivePollMs } from '@/lib/live';
import { useSignedIn } from '@/lib/session';

/**
 * Partner query hooks over `partner.*`, `dispatch.*` and `trips.*`. The driver's own channel
 * (`live.partner`, SSE) pushes what changed — a new offer (it rings for 15–20 s, so it must show at
 * once), the job, presence/gate, cash and earnings — and the queries re-read on the event. They keep
 * a slow safety refetch while the stream is live, and poll every 30 s when SSE does not get through.
 */

/**
 * Keeps `live.partner` open app-wide for a driving partner (fleet owners and field ops have no
 * driver channel). Mounted once, by the root layout's offer watcher.
 */
export function useLivePartner(enabled: boolean) {
  const signedIn = useSignedIn();
  return useLiveChannel({
    enabled: signedIn && enabled,
    key: LIVE_PARTNER_KEY,
    subscribe: (client, h) => client.live.partner.subscribe(undefined, h),
    resyncKeys: ['partner.status', 'partner.currentOffer', 'partner.activeJob', 'chat.threads'],
  });
}

export function useMe() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.identity.me.queryOptions(), enabled: signedIn, staleTime: 60_000 });
}

/** The role gate: `allowed` for drivers, fleet owners and field ops; `denied` for customers only. */
export function usePartnerGate(): PartnerGate {
  const me = useMe();
  if (!me.data) return 'unknown';
  return isPartner(me.data.roles.map((r) => r.kind)) ? 'allowed' : 'denied';
}

export function useStatus() {
  const api = useApi();
  const signedIn = useSignedIn();
  const gate = usePartnerGate();
  const pollMs = useLivePollMs(LIVE_PARTNER_KEY);
  return useQuery({ ...api.partner.status.queryOptions(), enabled: signedIn && gate === 'allowed', refetchInterval: pollMs });
}

export function useCurrentOffer(enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  const pollMs = useLivePollMs(LIVE_PARTNER_KEY);
  return useQuery({ ...api.partner.currentOffer.queryOptions(), enabled: signedIn && enabled, refetchInterval: pollMs, staleTime: 0 });
}

export function useActiveJob(enabled = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  const pollMs = useLivePollMs(LIVE_PARTNER_KEY);
  return useQuery({ ...api.partner.activeJob.queryOptions(), enabled: signedIn && enabled, refetchInterval: pollMs, staleTime: 0 });
}

/** Busy zones for the home map (maps program d5), every minute while he is online. */
export function useDemandMap(online: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.partner.demandMap.queryOptions(), enabled: signedIn && online, refetchInterval: online ? DEMAND_MAP_RULES.refreshMs : false, staleTime: DEMAND_MAP_RULES.refreshMs / 2 });
}

/** A road keeps for two minutes; the job's road is also re-read when the stop changes. */
const ROUTE_STALE_MS = 120_000;

/** The road to an offer's kitchen (maps program d2): read once per offer. */
export function useOfferRoute(offerId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.partner.offerRoute.queryOptions({ offerId: offerId ?? '' }), enabled: signedIn && Boolean(offerId), staleTime: Infinity, retry: false });
}

/**
 * The road through the job's remaining stops (maps program d2): every two minutes and whenever the
 * current stop changes (`stage`). Keeps the last road while a refresh is in flight.
 */
export function useJobRoute(enabled: boolean, stage: string) {
  const api = useApi();
  const signedIn = useSignedIn();
  const q = useQuery({
    ...api.partner.jobRoute.queryOptions(),
    enabled: signedIn && enabled,
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

/** Invalidates everything the home and job screens read after a state change. */
export function useRefreshWork() {
  const api = useApi();
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: api.partner.status.queryKey() }),
      qc.invalidateQueries({ queryKey: api.partner.currentOffer.queryKey() }),
      qc.invalidateQueries({ queryKey: api.partner.activeJob.queryKey() }),
    ]);
}

export function useGoOnline() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.partner.goOnline.mutationOptions(),
    onSuccess: (status) => qc.setQueryData(api.partner.status.queryKey(), status),
  });
}

export function useGoOffline() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.partner.goOffline.mutationOptions(),
    onSuccess: (status) => qc.setQueryData(api.partner.status.queryKey(), status),
  });
}

export function useRespond() {
  const api = useApi();
  return useMutation(api.dispatch.respond.mutationOptions());
}

export function useOfferSeen() {
  const api = useApi();
  return useMutation(api.dispatch.offerSeen.mutationOptions());
}

export function useTripActions() {
  const api = useApi();
  return {
    arrive: useMutation(api.trips.arrive.mutationOptions()),
    complete: useMutation(api.trips.completeStop.mutationOptions()),
    unreachable: useMutation(api.trips.startUnreachable.mutationOptions()),
    fail: useMutation(api.trips.fail.mutationOptions()),
  };
}
