/**
 * Speed reports from real phones (`@driver/contracts/speed-report`), the twin of `crash-report`:
 * how long the app takes to start and how long each screen takes to open, posted to Sentry's
 * performance view as transaction events over plain `fetch` — no SDK, no native module — and only
 * when a DSN is set (the same `EXPO_PUBLIC_SENTRY_DSN` as crash reports).
 *
 * The lab numbers in CI (`scripts/perf/`) run on a fast runner; these come from the phones people
 * actually hold in Aziziyah, so a slow cheap Android shows up here first.
 *
 * Privacy: nothing personal is in a speed report. A screen is named by its route pattern
 * (`restaurant/[id]`, never the id), there is no user, no request, no text from the screen. Only a
 * sample of app sessions reports at all (default 1 in 10, decided once at start), at most
 * `perMinute` reports a minute.
 *
 * Battery: nothing ticks. A measurement is two animation frames after something already happened
 * (the first screen, a navigation); no timers, no polling.
 */

import { envelopeEndpoint, parseSentryDsn, type CrashFetch, type ParsedDsn } from './crash-report.js';

export interface SpeedMeta {
  /** `customer` | `partner` | `merchant`: a tag, and the client name. */
  app: string;
  environment: string;
  release: string;
  /** `ios` | `android` | `web`; a tag. */
  os?: string;
}

export interface SpeedEvent {
  event_id: string;
  type: 'transaction';
  transaction: string;
  transaction_info: { source: 'route' | 'custom' };
  start_timestamp: number;
  timestamp: number;
  platform: 'javascript';
  environment: string;
  release: string;
  tags: Record<string, string>;
  contexts: { trace: { trace_id: string; span_id: string; op: string; status: 'ok' } };
  spans: [];
  measurements: Record<string, { value: number; unit: 'millisecond' | 'megabyte' | 'none' }>;
}

/** What one report says: `op` is Sentry's operation (`app.start.cold`, `ui.load`). */
export interface SpeedSample {
  name: string;
  op: string;
  source: 'route' | 'custom';
  /** Wall-clock start and end, in ms since the epoch. */
  startMs: number;
  endMs: number;
  measurements?: SpeedEvent['measurements'];
  tags?: Record<string, string>;
}

/** Keeps a route pattern only: `/restaurant/42` style concrete paths (digits, ids) never pass. */
export function routeName(segments: readonly string[]): string {
  const kept = segments.filter((s) => s.length > 0).map((s) => (/^[\w()[\]+.-]+$/.test(s) && !/\d{2,}/.test(s) ? s : '[x]'));
  return kept.length ? kept.join('/').slice(0, 120) : 'index';
}

export function buildSpeedEvent(sample: SpeedSample, meta: SpeedMeta, ids: { eventId: string; traceId: string; spanId: string }): SpeedEvent {
  return {
    event_id: ids.eventId,
    type: 'transaction',
    transaction: sample.name,
    transaction_info: { source: sample.source },
    start_timestamp: sample.startMs / 1000,
    timestamp: sample.endMs / 1000,
    platform: 'javascript',
    environment: meta.environment,
    release: meta.release,
    tags: { app: meta.app, ...(meta.os ? { os: meta.os } : {}), ...(sample.tags ?? {}) },
    contexts: { trace: { trace_id: ids.traceId, span_id: ids.spanId, op: sample.op, status: 'ok' } },
    spans: [],
    measurements: sample.measurements ?? {},
  };
}

export function buildSpeedEnvelope(dsn: ParsedDsn, event: SpeedEvent, now: Date): string {
  return [JSON.stringify({ event_id: event.event_id, sent_at: now.toISOString(), dsn: dsn.dsn }), JSON.stringify({ type: 'transaction' }), JSON.stringify(event)].join('\n');
}

// ─── Reporter ────────────────────────────────────────────────────────────────────────────────────

export interface SpeedReporter {
  /** False when there is no DSN or this app session was not sampled: every call is then a no-op. */
  readonly enabled: boolean;
  send(sample: SpeedSample): void;
}

export const noopSpeedReporter: SpeedReporter = { enabled: false, send: () => undefined };

export interface SpeedReporterOptions extends SpeedMeta {
  dsn: string | undefined;
  /** Share of app sessions that report, 0–1. Default 0.1; malformed → the default. */
  sampleRate?: number | string;
  /** At most this many reports a minute (a navigation storm must not flood). Default 20. */
  perMinute?: number;
  fetch?: CrashFetch;
  now?: () => Date;
  random?: () => number;
  randomHex?: (bytes: number) => string;
}

export const SPEED_SAMPLE_RATE = 0.1;
export const SPEED_REPORTS_PER_MINUTE = 20;

export function parseSampleRate(raw: number | string | undefined): number {
  const n = typeof raw === 'string' ? (raw.trim() === '' ? NaN : Number(raw)) : raw;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1 ? n : SPEED_SAMPLE_RATE;
}

function hex(bytes: number): string {
  const a = new Uint8Array(bytes);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createSpeedReporter(opts: SpeedReporterOptions): SpeedReporter {
  const raw = opts.dsn?.trim();
  const dsn = raw ? parseSentryDsn(raw) : null;
  if (!dsn) return noopSpeedReporter;
  const fetchImpl = opts.fetch ?? ((globalThis as { fetch?: CrashFetch }).fetch as CrashFetch | undefined);
  if (!fetchImpl) return noopSpeedReporter;
  // One roll per app session: a sampled phone reports everything, the others nothing.
  if ((opts.random ?? Math.random)() >= parseSampleRate(opts.sampleRate)) return noopSpeedReporter;
  const now = opts.now ?? (() => new Date());
  const randomHex = opts.randomHex ?? hex;
  const perMinute = opts.perMinute ?? SPEED_REPORTS_PER_MINUTE;
  const url = envelopeEndpoint(dsn, `driver-${opts.app}/${opts.release}`);
  // One trace per app session, so Sentry groups a phone's start and its screens together.
  const traceId = randomHex(16);
  let windowStart = 0;
  let sentInWindow = 0;

  return {
    enabled: true,
    send(sample) {
      try {
        if (!(sample.endMs >= sample.startMs) || sample.endMs - sample.startMs > 120_000) return; // clock jumps, a phone put to sleep
        const at = now();
        if (at.getTime() - windowStart >= 60_000) {
          windowStart = at.getTime();
          sentInWindow = 0;
        }
        if (sentInWindow >= perMinute) return;
        sentInWindow += 1;
        const event = buildSpeedEvent(sample, opts, { eventId: randomHex(16), traceId, spanId: randomHex(8) });
        void Promise.resolve()
          .then(() => fetchImpl(url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: buildSpeedEnvelope(dsn, event, at), keepalive: true }))
          .catch(() => undefined); // reporting must never throw into the app
      } catch {
        // never let the reporter itself break the app
      }
    },
  };
}

// ─── Measuring ───────────────────────────────────────────────────────────────────────────────────

interface PerfLike {
  now?: () => number;
  timeOrigin?: number;
  /** React Native ≥ 0.76: native process start → JS bundle start, in `performance.now()` time. */
  rnStartupTiming?: { startTime?: number | null };
  /** Hermes and Chrome: the JS heap. */
  memory?: { usedJSHeapSize?: number | null };
}

type RafLike = (cb: () => void) => unknown;

/** Calls `done` once two frames have been drawn after now: the screen is on the glass. */
export function afterPaint(done: () => void, target: object = globalThis): void {
  const raf = (target as { requestAnimationFrame?: RafLike }).requestAnimationFrame;
  if (typeof raf !== 'function') {
    done();
    return;
  }
  raf(() => raf(done));
}

/**
 * When the app process started, in wall-clock ms: React Native's native start mark when there is
 * one (that is the honest "tapped the icon" moment), else the page's time origin on the web.
 * Null when neither is known (the start report is then skipped, never guessed).
 */
export function processStartMs(target: object = globalThis): number | null {
  const perf = (target as { performance?: PerfLike }).performance;
  if (!perf || typeof perf.now !== 'function') return null;
  const origin = typeof perf.timeOrigin === 'number' && perf.timeOrigin > 0 ? perf.timeOrigin : Date.now() - perf.now();
  let native: number | null | undefined;
  try {
    native = perf.rnStartupTiming?.startTime;
  } catch {
    native = null; // older native side without the startup timing module
  }
  if (typeof native === 'number' && Number.isFinite(native) && native > 0) return origin + native;
  // The web: navigation started at the time origin.
  return (target as { document?: unknown }).document ? origin : null;
}

export function jsHeapMb(target: object = globalThis): number | null {
  try {
    const used = (target as { performance?: PerfLike }).performance?.memory?.usedJSHeapSize;
    return typeof used === 'number' && used > 0 ? Math.round((used / 1048576) * 10) / 10 : null;
  } catch {
    return null;
  }
}

export interface ScreenSpeed {
  /** Call when a navigation is asked for (a tap on a row, a back press), before anything renders. */
  onNavigate(): void;
  /** Call on every route change with the route's segments; the first call also reports the app start. */
  onRoute(segments: readonly string[]): void;
}

/** A navigation older than this when the route changes is not the one that changed it. */
const NAVIGATE_WINDOW_MS = 10_000;

/**
 * App start (cold) and screen open times, for a root layout to feed with its route segments.
 * App start: process start → the first screen drawn. Screen open: the navigation was asked for
 * (`onNavigate`, from the navigator's action event) → the new screen drawn, so it includes the JS
 * work of rendering it, which is what a person waits on. Data still loading behind a skeleton is
 * not counted: the screen is open, the skeleton is the answer.
 */
export function createScreenSpeed(reporter: SpeedReporter, target: object = globalThis): ScreenSpeed {
  if (!reporter.enabled) return { onNavigate: () => undefined, onRoute: () => undefined };
  let first = true;
  let navigateAt = 0;
  let last = '';
  let pending = 0;
  return {
    onNavigate() {
      navigateAt = Date.now();
    },
    onRoute(segments) {
      const name = routeName(segments);
      if (name === last) return;
      last = name;
      const seenAt = Date.now();
      // Without a navigation just before (a deep link, a redirect), only the paint is timed.
      const startMs = navigateAt > 0 && seenAt - navigateAt <= NAVIGATE_WINDOW_MS ? navigateAt : seenAt;
      navigateAt = 0;
      const token = ++pending;
      const isFirst = first;
      first = false;
      afterPaint(() => {
        const endMs = Date.now();
        if (isFirst) {
          const start = processStartMs(target);
          const heap = jsHeapMb(target);
          if (start !== null) {
            reporter.send({
              name: 'app start',
              op: 'app.start.cold',
              source: 'custom',
              startMs: start,
              endMs,
              tags: { first_screen: name },
              measurements: { app_start_cold: { value: Math.round(endMs - start), unit: 'millisecond' }, ...(heap !== null ? { js_heap: { value: heap, unit: 'megabyte' } } : {}) },
            });
          }
          return;
        }
        // A newer navigation beat this one to the glass: only the screen that stayed is timed.
        if (token !== pending) return;
        reporter.send({ name, op: 'ui.load', source: 'route', startMs, endMs, measurements: { screen_open: { value: Math.round(endMs - startMs), unit: 'millisecond' } } });
      }, target);
    },
  };
}
