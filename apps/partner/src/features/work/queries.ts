import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isPartner } from '@driver/contracts';
import { useApi } from '@/lib/api';
import type { PartnerGate } from '@/lib/guard';
import { useSignedIn } from '@/lib/session';

/**
 * Partner query hooks over `partner.*`, `dispatch.*` and `trips.*`. Polling stands in for push
 * until the realtime channel ships: the offer every 2 s while online (an offer rings for 15–20 s),
 * the job every 4 s, the status every 10 s.
 */

export const OFFER_POLL_MS = 2_000;
export const JOB_POLL_MS = 4_000;
export const STATUS_POLL_MS = 10_000;

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
  return useQuery({ ...api.partner.status.queryOptions(), enabled: signedIn && gate === 'allowed', refetchInterval: STATUS_POLL_MS });
}

export function useCurrentOffer(enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.partner.currentOffer.queryOptions(), enabled: signedIn && enabled, refetchInterval: OFFER_POLL_MS, staleTime: 0 });
}

export function useActiveJob(enabled = true) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.partner.activeJob.queryOptions(), enabled: signedIn && enabled, refetchInterval: JOB_POLL_MS, staleTime: 0 });
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
