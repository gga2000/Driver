import type { MessageKey } from '@driver/i18n';
import type { LiveMode, LiveTimers } from './live-client.js';

/**
 * Network awareness, free of React and DOM types so every app (Expo native and web, the Next.js
 * Console) and plain Node tests share it (`@driver/contracts/net-client`):
 *
 *  - `createNetworkMonitor` — one state per app from two signals: what the device says (NetInfo on
 *    native, `navigator.onLine` on the web) and whether the API answers. A request that gets no
 *    response at all marks the API unreachable and starts a probe every few seconds until it answers.
 *  - `connectionBanner` — what the shared offline strip says now: offline, API unreachable, "رجع النت"
 *    for a moment after an outage, or "التحديث متأخر" when the live channel is down and data is old.
 *  - `trackFetch` — wraps the tRPC links' `fetch` so every answer and every failure feeds the monitor.
 *  - `isNetworkError` — "no response" (offline, DNS, refused, aborted) vs an answer from the server.
 *
 * SSE down is not offline: the live channel falls back to polling and the data can still be fresh.
 * Offline / unreachable says "we can't reach Driver"; stale says "what you see may be old".
 */

export type NetState = 'online' | 'offline' | 'unreachable';

export const NET_RULES = {
  /** The strip appears this long after the loss (one blip doesn't flash it); the audit asks ≤ 3 s. */
  bannerDelayMs: 1_500,
  /** "رجع النت" stays this long after an outage that showed the strip. */
  backBannerMs: 3_000,
  /** While the API can't be reached it is probed this often ("نحاول كل 5 ثواني"). */
  probeEveryMs: 5_000,
  /** Requests in a row with no response before the API counts as unreachable. */
  failuresBeforeUnreachable: 2,
  /** A skeleton turns into an error with a retry after this long. */
  slowLoadMs: 8_000,
  /** With the live channel down, data older than this reads "التحديث متأخر". */
  staleAfterMs: 45_000,
} as const;

export type NetRules = { -readonly [K in keyof typeof NET_RULES]: number };

export interface NetSnapshot {
  state: NetState;
  /** When the current state began (ms since epoch). */
  since: number;
  /** When the connection came back after an outage long enough to have shown the strip; else null. */
  backAt: number | null;
}

export interface NetworkMonitorOptions {
  now?: () => number;
  timers?: LiveTimers;
  /** Resolves true when the API answered at all (any HTTP status). Without one, only real traffic recovers. */
  probe?: () => Promise<boolean>;
  rules?: Partial<NetRules>;
  /** The device's word at start (`navigator.onLine`); default online. */
  deviceOnline?: boolean;
}

export interface NetworkMonitor {
  getSnapshot(): NetSnapshot;
  subscribe(listener: () => void): () => void;
  /** NetInfo / `online`·`offline` events. */
  setDeviceOnline(online: boolean): void;
  /** Any HTTP response, error statuses included: the API is reachable. */
  reportResponse(): void;
  /** A request that got no response (fetch rejected). */
  reportNetworkError(): void;
  /** Probe now ("جرّب مرة ثانية", app back in the foreground). */
  retryNow(): void;
  stop(): void;
}

const runtime = globalThis as unknown as {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
};
const realTimers: LiveTimers = {
  setTimeout: (fn, ms) => runtime.setTimeout(fn, ms),
  clearTimeout: (h) => runtime.clearTimeout(h),
};

export function createNetworkMonitor(opts: NetworkMonitorOptions = {}): NetworkMonitor {
  const rules: NetRules = { ...NET_RULES, ...opts.rules };
  const now = opts.now ?? (() => Date.now());
  const timers = opts.timers ?? realTimers;
  const listeners = new Set<() => void>();
  let device = opts.deviceOnline ?? true;
  let failures = 0;
  let probeTimer: unknown = null;
  let probing = false;
  let stopped = false;
  let snap: NetSnapshot = { state: device ? 'online' : 'offline', since: now(), backAt: null };

  const emit = () => {
    for (const l of [...listeners]) l();
  };

  const set = (state: NetState) => {
    if (snap.state === state) return;
    const at = now();
    const wasDown = snap.state !== 'online';
    const downFor = at - snap.since;
    snap = {
      state,
      since: at,
      // Only an outage that showed the strip earns "رجع النت"; a blip passes silently.
      backAt: state === 'online' && wasDown && downFor >= rules.bannerDelayMs ? at : state === 'online' ? null : snap.backAt,
    };
    if (state === 'unreachable') schedule(rules.probeEveryMs);
    else cancel();
    emit();
  };

  const cancel = () => {
    if (probeTimer !== null) timers.clearTimeout(probeTimer);
    probeTimer = null;
  };

  const schedule = (ms: number) => {
    cancel();
    if (stopped || !opts.probe) return;
    probeTimer = timers.setTimeout(() => {
      probeTimer = null;
      runProbe();
    }, ms);
  };

  const runProbe = () => {
    if (stopped || probing || !opts.probe) return;
    probing = true;
    opts
      .probe()
      .then(
        (ok) => (ok ? onAnswer() : onSilence()),
        () => onSilence(),
      )
      .finally(() => {
        probing = false;
        if (snap.state === 'unreachable' && probeTimer === null) schedule(rules.probeEveryMs);
      });
  };

  const onAnswer = () => {
    failures = 0;
    // A real answer beats the device's word (NetInfo can lag behind a reconnect).
    device = true;
    set('online');
  };

  const onSilence = () => {
    if (!device) return;
    failures += 1;
    if (failures >= rules.failuresBeforeUnreachable) set('unreachable');
  };

  return {
    getSnapshot: () => snap,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    setDeviceOnline(online) {
      if (device === online) return;
      device = online;
      if (!online) {
        set('offline');
        return;
      }
      // Back on a network: say so, and check the API straight away.
      failures = 0;
      set('online');
      runProbe();
    },
    reportResponse: onAnswer,
    reportNetworkError: onSilence,
    retryNow() {
      if (snap.state === 'offline') return;
      cancel();
      runProbe();
    },
    stop() {
      stopped = true;
      cancel();
      listeners.clear();
    },
  };
}

// ───────────────────────── what the strip says ─────────────────────────

export type ConnectionBannerKind = 'offline' | 'unreachable' | 'back' | 'stale';

/**
 * True when the live channel is not delivering (fallback polling, or stuck connecting) and the newest
 * data is older than `staleAfterMs`. A live stream only pushes on change, so its data never reads stale.
 */
export function isStale(input: { live?: LiveMode | null; updatedAt?: number | null; now: number }, rules: Pick<NetRules, 'staleAfterMs'> = NET_RULES): boolean {
  if (!input.updatedAt || !input.live || input.live === 'live' || input.live === 'stopped') return false;
  return input.now - input.updatedAt > rules.staleAfterMs;
}

export function connectionBanner(
  input: { net: NetSnapshot; now: number; live?: LiveMode | null; updatedAt?: number | null },
  rules: Pick<NetRules, 'bannerDelayMs' | 'backBannerMs' | 'staleAfterMs'> = NET_RULES,
): ConnectionBannerKind | null {
  const { net, now } = input;
  if (net.state !== 'online') return now - net.since >= rules.bannerDelayMs ? net.state : null;
  if (net.backAt !== null && now >= net.backAt && now - net.backAt < rules.backBannerMs) return 'back';
  return isStale(input, rules) ? 'stale' : null;
}

/** Whole seconds since `at` (for "آخر تحديث قبل 40 ثانية"), never negative. */
export function secondsSince(at: number, now: number): number {
  return Math.max(0, Math.floor((now - at) / 1000));
}

type AgoKey = Extract<MessageKey, `net.ago_${string}`>;
export type AgoT = (key: AgoKey, params?: Record<string, string | number>) => string;

/**
 * "قبل 40 ثانية" / "قبل دقيقتين" / "قبل 5 دقايق" with Iraqi number agreement: 3–10 take the plural
 * (ثواني، دقايق), 11 and up the singular, 1 and 2 have their own words. Western digits.
 */
export function agoText(seconds: number, t: AgoT): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 3) return t('net.ago_now');
  if (s < 60) return t(s <= 10 ? 'net.ago_seconds_few' : 'net.ago_seconds', { n: s });
  const m = Math.floor(s / 60);
  if (m >= 60) return t('net.ago_hours');
  if (m === 1) return t('net.ago_minute');
  if (m === 2) return t('net.ago_two_minutes');
  return t(m <= 10 ? 'net.ago_minutes_few' : 'net.ago_minutes', { n: m });
}

// ───────────────────────── errors and fetch ─────────────────────────

const NO_RESPONSE = /failed to fetch|network ?error|network request failed|fetch failed|load failed|networkerror|err_internet_disconnected|err_connection|econnrefused|enotfound|etimedout|socket hang up|aborted|timeout/i;

/**
 * True when a request got no response at all (offline, DNS, refused, timed out). A tRPC error that
 * carries an HTTP status is the server answering, never a network error.
 */
export function isNetworkError(err: unknown): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 4; depth++) {
    const o = e as { data?: { httpStatus?: unknown } | null; message?: unknown; name?: unknown; cause?: unknown };
    if (typeof o.data?.httpStatus === 'number') return false;
    if (o.name === 'AbortError' || o.name === 'TimeoutError') return true;
    if (typeof o.message === 'string' && NO_RESPONSE.test(o.message)) return true;
    e = o.cause;
  }
  return false;
}

/** The HTTP status a tRPC error carries (`data.httpStatus`), if any. */
export function httpStatusOf(err: unknown): number | undefined {
  const s = (err as { data?: { httpStatus?: unknown } | null } | null)?.data?.httpStatus;
  return typeof s === 'number' ? s : undefined;
}

/** What kind of failure to tell the person about: their network, our server, or anything else. */
export function errorKind(err: unknown): 'network' | 'server' | 'other' {
  if (isNetworkError(err)) return 'network';
  const status = httpStatusOf(err);
  return status !== undefined && status >= 500 ? 'server' : 'other';
}

// Structural fetch types: this package compiles without DOM types.
export type FetchFn = (input: never, init?: never) => Promise<unknown>;

/** Wraps a fetch so every answer and every no-response failure reaches the monitor. */
export function trackFetch<F extends FetchFn>(monitor: Pick<NetworkMonitor, 'reportResponse' | 'reportNetworkError'>, fetchImpl: F): F {
  const tracked = (async (input: never, init?: never) => {
    try {
      const res = await fetchImpl(input, init);
      monitor.reportResponse();
      return res;
    } catch (err) {
      // A request the app cancelled itself (unmount, superseded query) says nothing about the network.
      if ((err as { name?: unknown } | null)?.name !== 'AbortError') monitor.reportNetworkError();
      throw err;
    }
  }) as F;
  return tracked;
}
