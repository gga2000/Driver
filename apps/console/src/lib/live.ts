'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { LIVE_RULES, type LiveEvent, type LiveKey } from '@driver/contracts';
import {
  createLiveConnection,
  isLiveAuthError,
  livePollMs,
  type LiveConnection,
  type LiveMode,
} from '@driver/contracts/live-client';
import { consoleNetwork } from './network';
import { useSignedIn } from './session';
import { liveTokensOf, useTRPC, useTRPCClient } from './trpc';

/** The one city at launch. */
export const CITY_ID = 'aziziyah';
export const CITY_TZ = 'Asia/Baghdad';

/**
 * The live badge's nominal freshness. The board itself is pushed (`live.consoleBoard`, SSE): the
 * dispatch board, trips, orders, right-now bar and driver pins re-read on events, with a slow safety
 * refetch while the stream is live and 30-s polling when SSE does not get through.
 */
export const LIVE_POLL_MS = 2_000;
export const SLOW_POLL_MS = 5_000;

/** Don't retry auth failures; poll only while signed in and the tab is visible (react-query default). */
const retry = (count: number, err: unknown) => {
  const status = (err as { data?: { httpStatus?: number } | null })?.data?.httpStatus;
  if (status === 401 || status === 403) return false;
  return count < 1;
};

// ───────────────────────── live.consoleBoard (one shared connection) ─────────────────────────

let mode: LiveMode = 'stopped';
const modeListeners = new Set<() => void>();
const subscribeMode = (cb: () => void) => {
  modeListeners.add(cb);
  return () => void modeListeners.delete(cb);
};
let shared: { conn: LiveConnection; refs: number; cityId: string; offNet: () => void } | null = null;

type Trpc = ReturnType<typeof useTRPC>;

function filterOf(trpc: Trpc, key: LiveKey) {
  switch (key) {
    case 'dispatch.board':
      return trpc.dispatch.board.pathFilter();
    case 'dispatch.drivers':
      return trpc.dispatch.drivers.pathFilter();
    case 'trips.board':
      return trpc.trips.board.pathFilter();
    case 'console.rightNow':
      return trpc.console.rightNow.pathFilter();
    case 'orders.listActive':
      return trpc.orders.listActive.pathFilter();
    default:
      return null;
  }
}

/**
 * Keeps one `live.consoleBoard` stream open while any board hook is mounted (ref-counted, so the
 * dispatch page's four hooks share it). Invalidations are batched per 250 ms; driver pins re-read the
 * positions at most every 2 s.
 */
function useLiveConsoleBoard(): LiveMode {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const qc = useQueryClient();
  const signedIn = useSignedIn();
  useEffect(() => {
    if (!signedIn) return;
    if (shared) {
      shared.refs += 1;
    } else {
      const pending = new Set<LiveKey>();
      let timer: ReturnType<typeof setTimeout> | null = null;
      let lastPins = 0;
      const flush = () => {
        timer = null;
        for (const k of pending) {
          const f = filterOf(trpc, k);
          if (f) void qc.invalidateQueries(f);
        }
        pending.clear();
      };
      const invalidate = (keys: readonly LiveKey[]) => {
        for (const k of keys) pending.add(k);
        timer ??= setTimeout(flush, 250);
      };
      const onEvent = (e: LiveEvent) => {
        if (e.type === 'invalidate') invalidate(e.keys);
        else if (
          e.type === 'driver_pin' &&
          Date.now() - lastPins >= LIVE_RULES.positionThrottleMs
        ) {
          lastPins = Date.now();
          invalidate(['dispatch.drivers']);
        }
      };
      const conn = createLiveConnection({
        open: (h) => client.live.consoleBoard.subscribe({ cityId: CITY_ID }, h),
        onEvent,
        onResync: () =>
          invalidate([
            'dispatch.board',
            'dispatch.drivers',
            'trips.board',
            'console.rightNow',
            'orders.listActive',
          ]),
        onModeChange: (m) => {
          mode = m;
          for (const l of modeListeners) l();
        },
        isAuthError: isLiveAuthError,
        onAuthError: () => liveTokensOf(client)?.clear(),
      });
      // The network is back (browser event or a probe answered): reconnect now, not after the backoff.
      const net = consoleNetwork();
      let reachable = net.getSnapshot().state === 'online';
      const offNet = net.subscribe(() => {
        const now = net.getSnapshot().state === 'online';
        if (now && !reachable) conn.reconnectNow();
        reachable = now;
      });
      shared = { conn, refs: 1, cityId: CITY_ID, offNet };
      conn.start();
    }
    return () => {
      if (!shared) return;
      shared.refs -= 1;
      if (shared.refs > 0) return;
      shared.conn.stop();
      shared.offNet();
      shared = null;
    };
  }, [signedIn, trpc, client, qc]);
  return useSyncExternalStore(
    subscribeMode,
    () => mode,
    () => 'stopped' as LiveMode,
  );
}

/** The shared board stream's mode (`stopped` when no board page is open). */
export function useConsoleLiveMode(): LiveMode {
  return useSyncExternalStore(
    subscribeMode,
    () => mode,
    () => 'stopped' as LiveMode,
  );
}

// ───────────────────────── board hooks ─────────────────────────

export function useDispatchBoard() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const live = useLiveConsoleBoard();
  return useQuery(
    trpc.dispatch.board.queryOptions(
      { cityId: CITY_ID },
      { enabled: signedIn, refetchInterval: livePollMs(live), retry, staleTime: 0 },
    ),
  );
}

export function useActiveTrips() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const live = useLiveConsoleBoard();
  return useQuery(
    trpc.trips.board.queryOptions(
      { cityId: CITY_ID },
      { enabled: signedIn, refetchInterval: livePollMs(live), retry, staleTime: 0 },
    ),
  );
}

export function useActiveOrders() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const live = useLiveConsoleBoard();
  return useQuery(
    trpc.orders.listActive.queryOptions(
      { cityId: CITY_ID },
      { enabled: signedIn, refetchInterval: livePollMs(live), retry },
    ),
  );
}

/** Live driver pins from presence (`dispatch.drivers`): positions, states, cash vs cap. */
export function useDriverPins() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const live = useLiveConsoleBoard();
  return useQuery(
    trpc.dispatch.drivers.queryOptions(
      { cityId: CITY_ID },
      { enabled: signedIn, refetchInterval: livePollMs(live), retry, staleTime: 0 },
    ),
  );
}

/** The dispatch board's right-now bar (`console.rightNow`). */
export function useRightNow() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const live = useLiveConsoleBoard();
  return useQuery(
    trpc.console.rightNow.queryOptions(
      { cityId: CITY_ID },
      { enabled: signedIn, refetchInterval: livePollMs(live), retry, staleTime: 0 },
    ),
  );
}

/** Merchant orgs with live balances (`merchants.list`) for pickers. */
export function useMerchants() {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  return useQuery(
    trpc.merchants.list.queryOptions(
      { cityId: CITY_ID },
      { enabled: signedIn, refetchInterval: 10_000, retry },
    ),
  );
}

export { retry as queryRetry };
