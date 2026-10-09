'use client';

import { useSyncExternalStore } from 'react';
import { t } from '@driver/i18n';
import {
  createNetworkMonitor,
  errorKind,
  httpStatusOf,
  trackFetch,
  type NetSnapshot,
  type NetworkMonitor,
} from '@driver/contracts/net-client';

/** Same as `trpc.ts` (read here too so the two modules don't import each other). */
const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000/trpc';

/**
 * The Console's network awareness (K-06), from the shared `@driver/contracts/net-client`: the
 * browser's online / offline events plus every tRPC request (`consoleFetch`); while the API doesn't
 * answer it is probed every 5 s ("نحاول كل 5 ثواني"). Pages read it through `useConsoleNetwork()`;
 * the live badge, the shell's strip and error messages all agree.
 */

let monitor: NetworkMonitor | null = null;

async function probe(): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 4_000);
  try {
    await fetch(`${API_URL.replace(/\/$/, '')}/health.ping`, { cache: 'no-store', signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function consoleNetwork(): NetworkMonitor {
  if (!monitor) {
    const m = createNetworkMonitor({ probe, deviceOnline: typeof navigator === 'undefined' ? true : navigator.onLine !== false });
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => m.setDeviceOnline(true));
      window.addEventListener('offline', () => m.setDeviceOnline(false));
    }
    monitor = m;
  }
  return monitor;
}

/** `fetch` for the tRPC batch link: answers and failures reach the monitor. */
export const consoleFetch = trackFetch(
  { reportResponse: () => consoleNetwork().reportResponse(), reportNetworkError: () => consoleNetwork().reportNetworkError() },
  (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),
) as typeof fetch;

const ONLINE: NetSnapshot = { state: 'online', since: 0, backAt: null };
const subscribe = (cb: () => void) => consoleNetwork().subscribe(cb);

export function useConsoleNetwork(): NetSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => consoleNetwork().getSnapshot(),
    () => ONLINE,
  );
}

/**
 * Arabic for any failed request: never "Failed to fetch". No response → offline / can't reach the
 * server (we keep trying); 5xx → a server problem with its status; otherwise the server's own message.
 */
export function errorText(error: { message?: string; data?: unknown } | null | undefined): string {
  if (!error) return '';
  const kind = errorKind(error);
  if (kind === 'network') return consoleNetwork().getSnapshot().state === 'offline' ? t('console.net_offline') : t('console.net_unreachable');
  if (kind === 'server') return t('console.net_server', { status: httpStatusOf(error) ?? 500 });
  return error.message || t('error.generic');
}
