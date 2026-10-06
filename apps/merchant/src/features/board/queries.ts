import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { MerchantBoard } from '@driver/contracts';
import { useNetwork } from '@driver/ui';
import { useApi, useApiClient } from '@/lib/api';
import { LIVE_MERCHANT_KEY, useLiveChannel, useLivePollMs } from '@/lib/live';
import { useSignedIn } from '@/lib/session';
import { clockOffset } from '@/lib/time';
import { applyRadar } from './radar';

/**
 * The store's live channel (`live.merchantBoard`, SSE), mounted once app-wide by MerchantRuntime: a
 * new order rings the moment it arrives (`new_order`, before the board is even re-read); a courier
 * on his way moves on the radar with each fix (`courier_radar`, patched in place); order, courier and
 * store changes re-read the board. The board keeps a slow safety refetch while live and
 * polls every 30 s when SSE does not get through.
 */
export function useLiveMerchantBoard(merchantOrgId: string | null, onNewOrder: (orderId: string) => void) {
  const signedIn = useSignedIn();
  return useLiveChannel({
    enabled: signedIn && !!merchantOrgId,
    key: `merchant:${merchantOrgId ?? ''}`,
    aliases: [LIVE_MERCHANT_KEY],
    subscribe: (client, h) => client.live.merchantBoard.subscribe({ merchantOrgId: merchantOrgId ?? '' }, h),
    resyncKeys: ['merchant.board', 'merchant.storeStatus', 'chat.threads'],
    onEvent: (e, qc, api) => {
      if (e.type === 'courier_radar') {
        qc.setQueriesData<MerchantBoard>(api.merchant.board.pathFilter(), (b) => applyRadar(b, e));
        return;
      }
      if (e.type !== 'new_order' || e.merchantOrgId !== merchantOrgId) return;
      onNewOrder(e.orderId);
      void qc.invalidateQueries(api.merchant.board.pathFilter());
    },
  });
}
/** Merchant presence ping (edge-case review A.2): silent for 2 min counts as "no presence". */
export const HEARTBEAT_MS = 30_000;

/** The live board, and the server-clock offset for timers (rings, "من 4 د"). */
export function useBoard(merchantOrgId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  const pollMs = useLivePollMs(LIVE_MERCHANT_KEY);
  const q = useQuery({
    ...api.merchant.board.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: signedIn && !!merchantOrgId,
    refetchInterval: pollMs,
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
    /** "+5 د" once per order (M-12): moves the promised time; the customer is told. */
    extend: useMutation({ ...api.orders.merchant.extendPrep.mutationOptions(), onSettled: refresh }),
    /** "سلّمته" (S-M4): the bag went to the courier at the pass; idempotent on the server. */
    handOver: useMutation({ ...api.orders.merchant.handOver.mutationOptions(), onSettled: refresh }),
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

/**
 * Can the board act? False within seconds of losing the network (M-08): the device's word and every
 * request feed the shared network monitor; the 30-s heartbeat stays as the backstop.
 */
export function useOnline(): boolean {
  const beat = useSyncExternalStore(subscribeOnline, () => online, () => online);
  return useNetwork().online && beat;
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
