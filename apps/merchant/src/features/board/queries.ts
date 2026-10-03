import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApi, useApiClient } from '@/lib/api';
import { useSignedIn } from '@/lib/session';
import { clockOffset } from '@/lib/time';

/** How often the board polls (new orders must show within seconds; a push channel replaces this later). */
export const BOARD_POLL_MS = 5_000;
/** Merchant presence ping (edge-case review A.2): silent for 2 min counts as "no presence". */
export const HEARTBEAT_MS = 30_000;

/** The live board, and the server-clock offset for timers (rings, "من 4 د"). */
export function useBoard(merchantOrgId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  const q = useQuery({
    ...api.merchant.board.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: signedIn && !!merchantOrgId,
    refetchInterval: BOARD_POLL_MS,
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
  const offset = q.data ? clockOffset(q.data.now, q.dataUpdatedAt) : 0;
  return { ...q, offset };
}

/** Ticks every `ms` with server time (board `now` + elapsed). */
export function useServerNow(offset: number, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const id = setInterval(() => setNow(Date.now() + offset), ms);
    return () => clearInterval(id);
  }, [offset, ms]);
  return now;
}

export function useOrderActions() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries(api.merchant.board.pathFilter());
  return {
    accept: useMutation({ ...api.orders.merchant.accept.mutationOptions(), onSettled: refresh }),
    reject: useMutation({ ...api.orders.merchant.reject.mutationOptions(), onSettled: refresh }),
    ready: useMutation({ ...api.orders.merchant.ready.mutationOptions(), onSettled: refresh }),
  };
}

/** Last heartbeat outcome, shared by the runtime (which pings) and the board (offline strip). */
let online = true;
const onlineListeners = new Set<() => void>();
function setOnline(v: boolean) {
  if (online === v) return;
  online = v;
  for (const l of onlineListeners) l();
}
const subscribeOnline = (cb: () => void) => {
  onlineListeners.add(cb);
  return () => {
    onlineListeners.delete(cb);
  };
};

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => online, () => online);
}

/**
 * `orders.merchant.heartbeat` every 30 s while the app is open on a store (and once at start).
 * Mounted once, app-wide (MerchantRuntime); a missing response flips `useOnline()` to false.
 */
export function useHeartbeat(merchantOrgId: string | null): void {
  const client = useApiClient();
  const signedIn = useSignedIn();
  useEffect(() => {
    if (!signedIn || !merchantOrgId) return;
    let alive = true;
    const beat = () => {
      client.orders.merchant.heartbeat
        .mutate({ merchantOrgId })
        .then(() => alive && setOnline(true))
        .catch((err: unknown) => {
          // A refused call (4xx) is not "offline"; only a missing response is.
          const status = (err as { data?: { httpStatus?: number } } | null)?.data?.httpStatus;
          if (alive) setOnline(status !== undefined);
        });
    };
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [client, signedIn, merchantOrgId]);
}
