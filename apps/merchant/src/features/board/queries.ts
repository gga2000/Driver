import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { MerchantBoard } from '@driver/contracts';
import { useNetwork } from '@driver/ui';
import { useApi, useApiClient } from '@/lib/api';
import { LIVE_MERCHANT_KEY, useLiveChannel, useLivePollMs } from '@/lib/live';
import { useSignedIn } from '@/lib/session';
import { clockOffset } from '@/lib/time';
import { serverClock } from './clock';
import { isPractice, practice, usePractice } from './practice';
import { applyRadar } from './radar';
import { readyQueue, useReadyQueue, withQueuedReady } from './ready-queue';
import { beatLog } from './shop-load';

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

/**
 * The live board, and the server-clock offset for timers (rings, "من 4 د"). Step 6: the practice
 * order (device-only) sits on top, and a «صار جاهز» kept offline already reads as ready.
 */
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
  useEffect(() => serverClock.setOffset(offset), [offset]);
  const trial = usePractice().order;
  const queue = useReadyQueue();
  const data = useMemo(() => {
    if (!q.data || (!trial && queue.length === 0)) return q.data;
    const orders = withQueuedReady(q.data.orders, queue);
    return { ...q.data, orders: trial ? [trial, ...orders] : orders };
  }, [q.data, trial, queue]);
  return { ...q, data, offset };
}

/**
 * A board action that the practice order answers on the device (s2): its id never reaches the server.
 * Everything else goes to the server as before.
 */
function trial<O extends { mutationFn?: unknown }>(opts: O, action: Parameters<typeof practice.run>[0]): O {
  const real = opts.mutationFn as (input: unknown, ...rest: unknown[]) => Promise<unknown>;
  const mutationFn = (input: { orderId: string; prepMinutes?: number }, ...rest: unknown[]) => (isPractice(input.orderId) ? practice.run(action, input) : real(input, ...rest));
  return { ...opts, mutationFn } as O;
}

export function useOrderActions() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries(api.merchant.board.pathFilter());
  return {
    accept: useMutation({ ...trial(api.orders.merchant.accept.mutationOptions(), 'accept'), onSettled: refresh }),
    reject: useMutation({ ...trial(api.orders.merchant.reject.mutationOptions(), 'reject'), onSettled: refresh }),
    ready: useMutation({ ...trial(api.orders.merchant.ready.mutationOptions(), 'ready'), onSettled: refresh }),
    /** "+5 د" once per order (M-12): moves the promised time; the customer is told. */
    extend: useMutation({ ...trial(api.orders.merchant.extendPrep.mutationOptions(), 'extend'), onSettled: refresh }),
    /** "سلّمته" (S-M4): the bag went to the courier at the pass; idempotent on the server. */
    handOver: useMutation({ ...trial(api.orders.merchant.handOver.mutationOptions(), 'handOver'), onSettled: refresh }),
  };
}

/**
 * y6: sends the «صار جاهز» taps kept offline as soon as the board can act again (and at start, for a
 * tablet that restarted offline). Mounted once, app-wide (MerchantRuntime).
 */
export function useReadyQueueFlush(merchantOrgId: string | null): void {
  const client = useApiClient();
  const api = useApi();
  const qc = useQueryClient();
  const online = useOnline();
  const queued = useReadyQueue().length;
  useEffect(() => {
    void readyQueue.load();
  }, []);
  useEffect(() => {
    if (!online || queued === 0 || !merchantOrgId) return;
    let alive = true;
    void readyQueue.flush((orderId) => client.orders.merchant.ready.mutate({ orderId })).then((sent) => {
      if (alive && sent > 0) void qc.invalidateQueries(api.merchant.board.pathFilter());
    });
    return () => {
      alive = false;
    };
  }, [online, queued, merchantOrgId, client, api, qc]);
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
 *
 * h5 (Ali, 2026-10-08): 5 minutes without a heartbeat pause the shop for customers, and an app in the
 * background sends none. So the moment the app is in front again it beats at once (the 30-s rhythm
 * restarts from there), and every answered beat goes in the beat log, which tells the board how long
 * the shop was paused while the app was away.
 */
export function useHeartbeat(merchantOrgId: string | null): void {
  const client = useApiClient();
  const signedIn = useSignedIn();
  useEffect(() => {
    if (!signedIn || !merchantOrgId) return;
    let alive = true;
    void beatLog.load(merchantOrgId);
    const beat = () => {
      client.orders.merchant.heartbeat
        .mutate({ merchantOrgId })
        .then(() => {
          if (!alive) return;
          setOnline(true);
          void beatLog.ok(merchantOrgId, Date.now());
        })
        .catch((err: unknown) => {
          // A refused call (4xx) is not "offline"; only a missing response is.
          const status = (err as { data?: { httpStatus?: number } } | null)?.data?.httpStatus;
          if (alive) setOnline(status !== undefined);
        });
    };
    beat();
    let id = setInterval(beat, HEARTBEAT_MS);
    let state: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const wasAway = state !== 'active';
      state = next;
      if (next !== 'active' || !wasAway) return;
      beat();
      clearInterval(id);
      id = setInterval(beat, HEARTBEAT_MS);
    });
    return () => {
      alive = false;
      clearInterval(id);
      sub.remove();
    };
  }, [client, signedIn, merchantOrgId]);
}

/** `orders.merchant.remakeRule` (c6): whether «سوّيناه من جديد» may show, and from when after «جاهز». */
export function useRemakeRule(enabled: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({ ...api.orders.merchant.remakeRule.queryOptions(), enabled: signedIn && enabled, staleTime: 5 * 60_000 });
}

/** c6: «سوّيناه من جديد» — Driver pays the first batch of a ready order no courier came for. */
export function useRemake() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({ ...api.orders.merchant.remake.mutationOptions(), onSettled: () => void qc.invalidateQueries(api.merchant.board.pathFilter()) });
}
