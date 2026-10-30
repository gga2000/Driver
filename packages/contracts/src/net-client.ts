import type { MessageKey } from '@driver/i18n';
import { liveBackoffMs, type LiveMode, type LiveTimers } from './live-client.js';

/**
 * Network awareness, free of React and DOM types so every app (Expo native and web, the Next.js
 * Console) and plain Node tests share it (`@driver/contracts/net-client`):
 *
 *  - `createNetworkMonitor` — one state per app from two signals: what the device says (NetInfo on
 *    native, `navigator.onLine` on the web) and whether the API answers. A request that gets no
 *    response at all marks the API unreachable and starts probing until it answers: after 5 s, then
 *    waiting twice as long each time up to 30 s, each wait ±20 % at random, so when the server comes back
 *    every phone that lost it doesn't knock at the same second (plan W6, SEC-16).
 *  - `connectionBanner` — what the shared offline strip says now: offline, API unreachable, "رجع النت"
 *    for a moment after an outage, or "التحديث متأخر" when the live channel is down and data is old.
 *  - `trackFetch` — wraps the tRPC links' `fetch` so every answer and every failure feeds the monitor.
 *  - `withTimeout` — a deadline on every request, so one stalled connection can't freeze the app.
 *  - `isNetworkError` — "no response" (offline, DNS, refused, aborted) vs an answer from the server.
 *  - `classifyError` — whether trying again can help (no response, our server) or the answer is final.
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
  /** While the API can't be reached the first probe waits this long; each probe that gets no answer doubles it. */
  probeEveryMs: 5_000,
  /** …up to this long between probes (each wait ±20 % at random). */
  probeMaxMs: 30_000,
  /**
   * While the device says "no network" the API is still probed this often: Android can say offline on a
   * captive or unvalidated Wi-Fi while data works (audit CORE-14), and a real answer beats its word.
   */
  offlineProbeEveryMs: 15_000,
  /** Requests in a row with no response before the API counts as unreachable. */
  failuresBeforeUnreachable: 2,
  /** A skeleton turns into an error with a retry after this long. */
  slowLoadMs: 8_000,
  /** With the live channel down, data older than this reads "التحديث متأخر". */
  staleAfterMs: 45_000,
  /**
   * No answer to a request within this long counts as no response (audit CORE-01: Android's HTTP client
   * waits forever on a stalled link). The clock starts again once for the body after the headers arrive.
   */
  requestTimeoutMs: 15_000,
  /**
   * The token refresh request waits longer than others: the server rotates the token when it answers,
   * so giving up early on a slow answer would leave the phone with a retired token. Requests don't
   * wait this long for it (the session releases them after 10 s, `REFRESH_WAIT_MS`).
   */
  refreshTimeoutMs: 60_000,
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
  /** The jitter's dice (tests pin it). */
  random?: () => number;
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
  /** Probes in a row that got no answer while unreachable: sets the next wait. */
  let misses = 0;
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
    misses = 0;
    if (state === 'unreachable') schedule(unreachableWait());
    else if (state === 'offline') schedule(rules.offlineProbeEveryMs);
    else cancel();
    emit();
  };

  const unreachableWait = () => liveBackoffMs(misses + 1, opts.random, { backoffBaseMs: rules.probeEveryMs, backoffMaxMs: rules.probeMaxMs });

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
        (ok) => (ok ? onAnswer() : probeSilence()),
        () => probeSilence(),
      )
      .finally(() => {
        probing = false;
        if (probeTimer === null && snap.state !== 'online') schedule(snap.state === 'offline' ? rules.offlineProbeEveryMs : unreachableWait());
      });
  };

  const onAnswer = () => {
    failures = 0;
    // A real answer beats the device's word (NetInfo can lag behind a reconnect).
    device = true;
    set('online');
  };

  // Only probes stretch the wait: the app's own failing requests don't.
  const probeSilence = () => {
    if (snap.state === 'unreachable') misses += 1;
    onSilence();
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

/** The error a request that hit its deadline fails with (`isNetworkError` counts it as no response). */
export class RequestTimeoutError extends Error {
  override readonly name = 'TimeoutError';
  constructor(readonly afterMs: number) {
    super(`request_timeout_${afterMs}ms`);
  }
}

interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}
interface AbortControllerLike {
  readonly signal: AbortSignalLike;
  abort(reason?: unknown): void;
}
const AbortControllerImpl = (globalThis as { AbortController?: new () => AbortControllerLike }).AbortController;

/**
 * Wraps a fetch with a deadline: no response headers within `ms` aborts the request and rejects with
 * `RequestTimeoutError`; once the headers arrive the clock starts once more for reading the body. A
 * signal the caller passes still cancels it (that rejection stays an `AbortError`). The promise
 * settles at the deadline even on a runtime whose fetch ignores the abort.
 */
export function withTimeout<F extends FetchFn>(fetchImpl: F, ms: number, timers: LiveTimers = realTimers): F {
  const timed = ((input: never, init?: never) => {
    const callerSignal = (init as { signal?: AbortSignalLike | null } | undefined)?.signal ?? null;
    const ctrl = AbortControllerImpl ? new AbortControllerImpl() : null;
    let timer: unknown = null;
    let timedOut = false;
    const forward = () => ctrl?.abort();
    const done = () => {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      callerSignal?.removeEventListener('abort', forward);
    };
    if (callerSignal?.aborted) return Promise.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    callerSignal?.addEventListener('abort', forward);
    const arm = (onFire: () => void) => {
      if (timer !== null) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => {
        timer = null;
        onFire();
      }, ms);
    };

    return new Promise((resolve, reject) => {
      arm(() => {
        timedOut = true;
        ctrl?.abort();
        done();
        reject(new RequestTimeoutError(ms));
      });
      const passed = (ctrl ? { ...(init as object | undefined), signal: ctrl.signal } : init) as never;
      fetchImpl(input, passed).then(
        (res) => {
          if (timedOut) return;
          // The body gets one more window; aborting after it was read changes nothing.
          arm(() => {
            ctrl?.abort();
            done();
          });
          resolve(res);
        },
        (err: unknown) => {
          if (timedOut) return;
          done();
          reject(err);
        },
      );
    });
  }) as F;
  return timed;
}

/** Waits for `work` at most `ms`, never rejects: for best-effort calls that must not hold a person up (sign-out). */
export function settleWithin(work: Promise<unknown>, ms: number, timers: LiveTimers = realTimers): Promise<'done' | 'timeout'> {
  return new Promise((resolve) => {
    const timer = timers.setTimeout(() => resolve('timeout'), ms);
    work.then(
      () => {
        timers.clearTimeout(timer);
        resolve('done');
      },
      () => {
        timers.clearTimeout(timer);
        resolve('done');
      },
    );
  });
}

// ───────────────────────── what an error means ─────────────────────────

/**
 * What a failed request means for the app:
 *  - `network`: no response (offline, timed out, refused). Keep what is on screen, say "reconnecting", retry;
 *  - `server`: our server failed (5xx, `internal`, `service_unavailable`). Keep the data, retry with backoff;
 *  - `busy`: rate limited; retry only after `retryAfterSec`;
 *  - `auth`: the session was refused (401); the auth link refreshes once, then it is final;
 *  - `final`: a definitive answer (not found, forbidden, invalid, a rule said no). Retrying can't help.
 */
export type ErrorClassKind = 'network' | 'server' | 'busy' | 'auth' | 'final';

export interface ErrorClass {
  kind: ErrorClassKind;
  /** Trying the same request again later can succeed. */
  transient: boolean;
  /** The envelope's stable code, when the server answered with one. */
  code: string | null;
  retryAfterSec: number | null;
}

const TRANSIENT_CODES = new Set(['internal', 'service_unavailable']);

export function classifyError(err: unknown): ErrorClass {
  const data = (err as { data?: { code?: unknown; retryHint?: unknown; retryAfterSec?: unknown } | null } | null)?.data;
  const code = typeof data?.code === 'string' ? data.code : null;
  const retryAfterSec = typeof data?.retryAfterSec === 'number' ? data.retryAfterSec : null;
  const of = (kind: ErrorClassKind, transient: boolean): ErrorClass => ({ kind, transient, code, retryAfterSec });
  if (isNetworkError(err)) return of('network', true);
  const status = httpStatusOf(err);
  if (status === 401) return of('auth', false);
  if (status === 429 || code === 'rate_limited' || code === 'server_busy') return of('busy', true);
  if ((status !== undefined && status >= 500) || (code !== null && TRANSIENT_CODES.has(code))) return of('server', true);
  // Any other answer is the server's final word on this request (its retry hint is for the person, not
  // for an automatic retry); an error with no status at all is a bug on our side that a retry won't fix.
  return of('final', false);
}
