import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import type { LiveEvent, LiveKey } from '@driver/contracts';
import { getNetwork } from '@driver/ui';
import {
  createLiveConnection,
  isLiveAuthError,
  livePollMs,
  type LiveMode,
  type LiveSubscriptionHandlers,
} from '@driver/contracts/live-client';
import { useApi, useApiClient, useLiveTokens } from './api';
import { stopLiveOnUpdateRequired } from './app-version';

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

/** The selected store's channel (`live.merchantBoard`), mounted once app-wide by MerchantRuntime. */
export const LIVE_MERCHANT_KEY = 'merchant';

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
    const pending = new Set<LiveKey>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      for (const k of pending) void qc.invalidateQueries(liveFilter(api, k));
      pending.clear();
    };
    const invalidate = (keys: readonly LiveKey[]) => {
      for (const k of keys) pending.add(k);
      timer ??= setTimeout(flush, 250);
    };
    const conn = createLiveConnection({
      // An old build (`update_required`) stops the stream for good instead of reconnecting with backoff.
      open: (h) => ref.current.subscribe(client, stopLiveOnUpdateRequired(h, () => conn.stop())),
      onEvent: (e) => {
        if (e.type === 'invalidate') invalidate(e.keys);
        ref.current.onEvent?.(e, qc, api);
      },
      onResync: () => invalidate(ref.current.resyncKeys),
      onModeChange: (m) => {
        setLocalMode(m);
        setMode(names, m === 'stopped' ? null : m);
      },
      isAuthError: isLiveAuthError,
      onAuthError: () => tokens?.clear(),
    });
    conn.start();
    // Back in the foreground (or the network is back): retry now instead of waiting out the backoff.
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') conn.reconnectNow();
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
      offNet();
      conn.stop();
      if (timer) clearTimeout(timer);
      setMode(names, null);
    };
  }, [opts.enabled, opts.key, aliasKey, api, client, tokens, qc]);

  return opts.enabled ? mode : 'stopped';
}
