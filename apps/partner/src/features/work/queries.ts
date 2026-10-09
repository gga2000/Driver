import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEMAND_MAP_RULES, isPartner, type OrderRoute } from '@driver/contracts';
import { liteInterval, useLiteMode } from '@driver/ui';
import { useApi } from '@/lib/api';
import type { PartnerGate } from '@/lib/guard';
import { LIVE_PARTNER_KEY, useLiveChannel, useLiveMode } from '@/lib/live';
import { offerPollMs, workPollMs } from './offer-poll';
import { useSignedIn } from '@/lib/session';
import { heartbeatStep, versionToSend, type HeldVersion } from './heartbeat-version';

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

/** l2: the status/job refetch, three times slower in low-data mode while the stream is live. */
function useWorkPollMs(): number {
  const mode = useLiveMode(LIVE_PARTNER_KEY);
  const lite = useLiteMode();
  return workPollMs(mode, (ms) => liteInterval(ms, lite));
}

export function useStatus() {
  const api = useApi();
  const signedIn = useSignedIn();
  const gate = usePartnerGate();
  const pollMs = useWorkPollMs();
  return useQuery({ ...api.partner.status.queryOptions(), enabled: signedIn && gate === 'allowed', refetchInterval: pollMs });
}

export function useCurrentOffer(enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  const mode = useLiveMode(LIVE_PARTNER_KEY);
  const lite = useLiteMode();
  const q = useQuery({ ...api.partner.currentOffer.queryOptions(), enabled: signedIn && enabled, refetchInterval: offerPollMs(mode, (ms) => liteInterval(ms, lite)), staleTime: 0 });
  // The stream just dropped: look for an offer now rather than at the next tick.
  const was = useRef(mode);
  const { refetch } = q;
  useEffect(() => {
    if (was.current === 'live' && mode !== 'live' && signedIn && enabled) void refetch();
    was.current = mode;
  }, [mode, signedIn, enabled, refetch]);
  return q;
}

export function useActiveJob(enabled = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  const pollMs = useWorkPollMs();
  return useQuery({ ...api.partner.activeJob.queryOptions(), enabled: signedIn && enabled, refetchInterval: pollMs, staleTime: 0 });
}

/** Busy zones for the home map (maps program d5), every minute while he is online. */
export function useDemandMap(online: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  // Low-data mode (maps program q2): every 3 minutes instead of every minute.
  const lite = useLiteMode();
  return useQuery({ ...api.partner.demandMap.queryOptions(), enabled: signedIn && online, refetchInterval: online ? liteInterval(DEMAND_MAP_RULES.refreshMs, lite) : false, staleTime: DEMAND_MAP_RULES.refreshMs / 2 });
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
  const lite = useLiteMode();
  const signedIn = useSignedIn();
  const q = useQuery({
    ...api.partner.jobRoute.queryOptions(),
    enabled: signedIn && enabled,
    staleTime: ROUTE_STALE_MS,
    refetchInterval: enabled ? liteInterval(ROUTE_STALE_MS, lite) : false,
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

/** Perf o4: the version the last heartbeat answered with (`heartbeat-version.ts`). */
let heldVersion: HeldVersion | null = null;

export function useGoOnline() {
  const api = useApi();
  const qc = useQueryClient();
  const key = api.partner.status.queryKey();
  const base = api.partner.goOnline.mutationOptions();
  type BaseFn = NonNullable<typeof base.mutationFn>;
  const updatedAt = () => qc.getQueryState(key)?.dataUpdatedAt ?? -1;
  return useMutation({
    ...base,
    mutationFn: (input: Omit<Parameters<BaseFn>[0], 'knownVersion'>, context: Parameters<BaseFn>[1]) =>
      base.mutationFn!({ ...input, knownVersion: versionToSend(heldVersion, updatedAt()) }, context),
    onSuccess: (res, input) => {
      const step = heartbeatStep(res, input.at, heldVersion, updatedAt());
      if (step.kind === 'forget') {
        heldVersion = null;
        return;
      }
      if (step.kind === 'replace') qc.setQueryData(key, step.status);
      else qc.setQueryData(key, (prev) => (prev ? { ...prev, position: step.position } : prev));
      heldVersion = step.version === null ? null : { version: step.version, updatedAt: updatedAt() };
    },
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

/** «المكيّفة شغالة اليوم؟» (ride idea x1): the answer comes back on the status the home reads. */
export function useAnswerClimateCheck() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.partner.answerClimateCheck.mutationOptions(),
    onSuccess: (status) => qc.setQueryData(api.partner.status.queryKey(), status),
  });
}

/** «مشاوير باچر» (review #28): his booked rides and the open ones; re-read every minute (lighter in low-data mode). */
export function useBookedJobs(enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  const lite = useLiteMode();
  return useQuery({ ...api.partner.bookedJobs.queryOptions(), enabled: signedIn && enabled, staleTime: 30_000, refetchInterval: enabled ? liteInterval(BOOKED_REFRESH_MS, lite) : false });
}

const BOOKED_REFRESH_MS = 60_000;

/** Confirm / pass / release / start: the answer comes back with the fresh list; a start opens the job. */
export function useAnswerBookedJob() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = useRefreshWork();
  return useMutation({
    ...api.partner.answerBookedJob.mutationOptions(),
    onSuccess: (jobs, input) => {
      qc.setQueryData(api.partner.bookedJobs.queryKey(), jobs);
      if (input.answer === 'start') void refresh();
    },
    // Taken by someone else, closed, or changed since the list was read: show what is true now.
    onError: () => void qc.invalidateQueries({ queryKey: api.partner.bookedJobs.queryKey() }),
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

/**
 * «انت بمنطقة X؟» (maps program SP3): read when a job ends. The server creates the question from the
 * finished drop-off, so a read that started after the job is the one that can see it.
 */
export function useZoneCheck(enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.partner.zoneCheck.queryOptions(), enabled: signedIn && enabled, staleTime: 0, retry: false });
}

/** His answer. The card hides on the tap; once sent (or refused) the question leaves the cache too. */
export function useAnswerZoneCheck() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    ...api.partner.answerZoneCheck.mutationOptions(),
    onSettled: () => qc.setQueryData(api.partner.zoneCheck.queryKey(), null),
  });
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
