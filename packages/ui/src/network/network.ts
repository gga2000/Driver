import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { LiveMode } from '@driver/contracts/live-client';
import {
  connectionBanner,
  createNetworkMonitor,
  errorKind,
  NET_RULES,
  secondsSince,
  trackFetch,
  type ConnectionBannerKind,
  type NetSnapshot,
  type NetworkMonitor,
} from '@driver/contracts/net-client';
import type { RetryKind } from '../components/RetryState';
import { deviceOnlineNow, subscribeDevice } from './device';

/**
 * The app's one network monitor (`@driver/contracts/net-client`), fed by the device (NetInfo on
 * native, `navigator.onLine` on the web) and by every tRPC request (`networkFetch`). Apps call
 * `configureNetwork({ apiUrl })` once, next to their API client, and `bindOnlineManager` so React Query
 * pauses while offline and refetches on reconnect.
 */

let probeUrl: string | null = null;
let monitor: NetworkMonitor | null = null;
const PROBE_TIMEOUT_MS = 4_000;

/** Any HTTP answer from `health.ping` counts as reachable (even 4xx/5xx: the server is there). */
async function probe(): Promise<boolean> {
  if (!probeUrl) return false;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), PROBE_TIMEOUT_MS);
  try {
    await fetch(probeUrl, { method: 'GET', cache: 'no-store', ...(ctrl ? { signal: ctrl.signal } : {}) });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function getNetwork(): NetworkMonitor {
  if (!monitor) {
    const m = createNetworkMonitor({ probe, deviceOnline: deviceOnlineNow() });
    subscribeDevice((online) => m.setDeviceOnline(online));
    monitor = m;
  }
  return monitor;
}

/** Points the reachability probe at the app's API (`…/trpc` → `…/trpc/health.ping`). */
export function configureNetwork({ apiUrl }: { apiUrl: string }): NetworkMonitor {
  probeUrl = `${apiUrl.replace(/\/$/, '')}/health.ping`;
  return getNetwork();
}

/** `fetch` for the tRPC links: every answer and every failure reaches the monitor. */
export const networkFetch = trackFetch(
  { reportResponse: () => getNetwork().reportResponse(), reportNetworkError: () => getNetwork().reportNetworkError() },
  // Read the global per call: tests and polyfills may replace it after this module loads.
  (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
) as typeof fetch;

/** React Query's `onlineManager` (structural, so this package doesn't depend on React Query). */
export function bindOnlineManager(om: { setEventListener(setup: (setOnline: (online: boolean) => void) => () => void): void }): void {
  om.setEventListener((setOnline) => {
    const net = getNetwork();
    const sync = () => setOnline(net.getSnapshot().state !== 'offline');
    sync();
    return net.subscribe(sync);
  });
}

const subscribe = (cb: () => void) => getNetwork().subscribe(cb);
const snapshot = () => getNetwork().getSnapshot();

export interface NetworkStatus extends NetSnapshot {
  /** The API answers: actions can go through. */
  online: boolean;
}

export function useNetwork(): NetworkStatus {
  const snap = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { ...snap, online: snap.state === 'online' };
}

/** `Date.now()`, re-rendering every `ms` while `active`. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

export interface ConnectionBannerState {
  kind: ConnectionBannerKind | null;
  net: NetworkStatus;
  /** Seconds since `updatedAt` (stale data), when given. */
  ageSeconds: number | null;
  now: number;
}

/**
 * What the shared strip says now. `live` / `updatedAt` add "التحديث متأخر" for a screen whose live
 * channel is down and whose data is old; without them only offline / unreachable / "رجع النت" show.
 */
export function useConnectionBanner(opts: { live?: LiveMode | null; updatedAt?: number | null } = {}): ConnectionBannerState {
  const net = useNetwork();
  const watching = net.state !== 'online' || net.backAt !== null || (opts.live != null && opts.live !== 'live' && opts.live !== 'stopped' && !!opts.updatedAt);
  const now = useNow(watching, 1000);
  const kind = connectionBanner({ net, now, live: opts.live ?? null, updatedAt: opts.updatedAt ?? null });
  return { kind, net, now, ageSeconds: opts.updatedAt ? secondsSince(opts.updatedAt, now) : null };
}

/**
 * Skeleton timeout: true once `loading` has lasted `ms` (default 8 s). `restart()` (the retry button)
 * starts the clock again while the request is still out.
 */
export function useLoadTimeout(loading: boolean, ms: number = NET_RULES.slowLoadMs): [slow: boolean, restart: () => void] {
  const [slow, setSlow] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    setSlow(false);
    if (!loading) return;
    const id = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(id);
  }, [loading, ms, round]);
  const restart = useCallback(() => setRound((r) => r + 1), []);
  return [loading && slow, restart];
}

/**
 * Which "couldn't load" state to show: the network's word first (offline / API unreachable), then
 * the error itself (our server vs no response), else a slow load (skeleton timeout).
 */
export function retryKindFor({ net, error, slow }: { net: Pick<NetSnapshot, 'state'>; error?: unknown; slow?: boolean }): RetryKind {
  if (net.state === 'offline') return 'offline';
  if (net.state === 'unreachable') return 'unreachable';
  if (error) return errorKind(error) === 'network' ? 'unreachable' : slow ? 'slow' : 'server';
  return 'slow';
}
