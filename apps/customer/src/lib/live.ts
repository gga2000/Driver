import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { LIVE_RULES, type LiveEvent, type LiveKey } from '@driver/contracts';
import { getNetwork } from '@driver/ui';
import {
  createLiveConnection,
  isLiveAuthError,
  livePollMs,
  type LiveMode,
  type LiveSubscriptionHandlers,
} from '@driver/contracts/live-client';
import { useApi, useApiClient, useLiveTokens } from './api';
import { needsResync } from './live-resync';

/**
 * The real-time channel in this app (`live.*` over SSE; same file in customer, partner and merchant).
 * `useLiveChannel` keeps one subscription alive — reconnect with backoff, a refetch of what the
 * channel covers on every (re)connect, slow polling while SSE keeps failing — and turns `invalidate`
 * events into React Query invalidations (batched per 250 ms). Screens keep their queries and read
 * `useLivePollMs(key)` for the refetch interval: a slow safety refetch while live, 30 s otherwise.
 */

type Api = ReturnType<typeof useApi>;
type Client = ReturnType<typeof useApiClient>;

/** Every cached query of a procedure the server says changed. */
export function liveFilter(api: Api, key: LiveKey) {
  switch (key) {
    case 'orders.track':
      return api.orders.track.pathFilter();
    case 'orders.courierPosition':
      return api.orders.courierPosition.pathFilter();
    case 'orders.mine':
      return api.orders.mine.pathFilter();
    case 'orders.listActive':
      return api.orders.listActive.pathFilter();
    case 'chat.threads':
      return api.chat.threads.pathFilter();
    case 'chat.thread':
      return api.chat.thread.pathFilter();
    case 'chat.trip.threads':
      return api.chat.trip.threads.pathFilter();
    case 'partner.status':
      return api.partner.status.pathFilter();
    case 'partner.currentOffer':
      return api.partner.currentOffer.pathFilter();
    case 'partner.activeJob':
      return api.partner.activeJob.pathFilter();
    case 'merchant.board':
      return api.merchant.board.pathFilter();
    case 'merchant.storeStatus':
      return api.merchant.storeStatus.pathFilter();
    case 'dispatch.board':
      return api.dispatch.board.pathFilter();
    case 'dispatch.drivers':
      return api.dispatch.drivers.pathFilter();
    case 'dispatch.myRideOffers':
      return api.dispatch.myRideOffers.pathFilter();
    case 'trips.board':
      return api.trips.board.pathFilter();
    case 'console.rightNow':
      return api.console.rightNow.pathFilter();
    case 'safety.open':
      return api.safety.list.pathFilter();
  }
}

// ───────────────────────── connection mode per channel ─────────────────────────

const modes = new Map<string, LiveMode>();
const listeners = new Set<() => void>();
function setMode(keys: readonly string[], mode: LiveMode | null) {
  for (const k of keys) {
    if (mode === null) modes.delete(k);
    else modes.set(k, mode);
  }
  for (const l of listeners) l();
}
const subscribeModes = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};

/** The mode of the channel registered under `key` (`stopped` when no screen keeps it open). */
export function useLiveMode(key: string): LiveMode {
  return useSyncExternalStore(
    subscribeModes,
    () => modes.get(key) ?? 'stopped',
    () => modes.get(key) ?? 'stopped',
  );
}

/** Refetch interval for a query a channel covers: the safety poll while live, the fallback poll otherwise. */
export function useLivePollMs(key: string): number {
  return livePollMs(useLiveMode(key));
}

// ───────────────────────── the hook ─────────────────────────

export interface LiveChannelOptions {
  enabled: boolean;
  /** The channel's name here; a change reconnects. `aliases` register the same mode under more names. */
  key: string;
  aliases?: readonly string[];
  subscribe(client: Client, handlers: LiveSubscriptionHandlers): { unsubscribe(): void };
  /** Patches (a position, an order state, the kitchen's ring). Invalidations are applied here. */
  onEvent?(event: LiveEvent, qc: QueryClient, api: Api): void;
  /** What a (re)connect re-reads: everything the channel covers. */
  resyncKeys: readonly LiveKey[];
}

export function useLiveChannel(opts: LiveChannelOptions): LiveMode {
  const api = useApi();
  const client = useApiClient();
  const tokens = useLiveTokens();
  const qc = useQueryClient();
  const [mode, setLocalMode] = useState<LiveMode>('stopped');
  const ref = useRef(opts);
  ref.current = opts;
  const aliasKey = (opts.aliases ?? []).join('|');

  useEffect(() => {
    if (!opts.enabled) return;
    const names = [opts.key, ...(aliasKey ? aliasKey.split('|') : [])];
    // Key → whether only a resync asked for it (then fresh data is kept). A server `invalidate` wins.
    const pending = new Map<LiveKey, boolean>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const now = Date.now();
      for (const [k, resyncOnly] of pending) {
        const filter = liveFilter(api, k);
        void qc.invalidateQueries(resyncOnly ? { ...filter, predicate: (q) => needsResync(q.state.dataUpdatedAt, now) } : filter);
      }
      pending.clear();
    };
    const invalidate = (keys: readonly LiveKey[], resyncOnly = false) => {
      for (const k of keys) pending.set(k, resyncOnly && (pending.get(k) ?? true));
      timer ??= setTimeout(flush, 250);
    };
    const conn = createLiveConnection({
      open: (h) => ref.current.subscribe(client, h),
      onEvent: (e) => {
        if (e.type === 'invalidate') invalidate(e.keys);
        ref.current.onEvent?.(e, qc, api);
      },
      onResync: () => invalidate(ref.current.resyncKeys, true),
      onModeChange: (m) => {
        setLocalMode(m);
        setMode(names, m === 'stopped' ? null : m);
      },
      isAuthError: isLiveAuthError,
      onAuthError: () => tokens?.clear(),
    });
    conn.start();
    // In the background the stream closes after a short grace (no battery or data spent on a screen
    // nobody sees, CORE-09); back in the foreground it reopens and resyncs, or retries now instead of
    // waiting out the backoff.
    let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        if (backgroundTimer) clearTimeout(backgroundTimer);
        backgroundTimer = null;
        if (conn.mode() === 'stopped') conn.start();
        else conn.reconnectNow();
      } else if (s === 'background' && !backgroundTimer) {
        backgroundTimer = setTimeout(() => {
          backgroundTimer = null;
          conn.stop();
        }, LIVE_RULES.backgroundCloseMs);
      }
    });
    const net = getNetwork();
    let reachable = net.getSnapshot().state === 'online';
    const offNet = net.subscribe(() => {
      const now = net.getSnapshot().state === 'online';
      if (now && !reachable) conn.reconnectNow();
      reachable = now;
    });
    return () => {
      appState.remove();
      if (backgroundTimer) clearTimeout(backgroundTimer);
      offNet();
      conn.stop();
      if (timer) clearTimeout(timer);
      setMode(names, null);
    };
  }, [opts.enabled, opts.key, aliasKey, api, client, tokens, qc]);

  return opts.enabled ? mode : 'stopped';
}
