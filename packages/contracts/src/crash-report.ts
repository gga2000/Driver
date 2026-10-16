/**
 * Crash reports for the phone apps and the Console (`@driver/contracts/crash-report`), the client
 * twin of the API's `apps/api/src/shared/error-reporter.ts`: errors are posted to Sentry's envelope
 * endpoint with plain `fetch` — no SDK, no native module (it runs in Expo Go and the web studio) —
 * and nothing happens unless a DSN is set (`EXPO_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`).
 *
 * Privacy (personal data never leaves the device): every message and stack is scrubbed of Iraqi
 * phone numbers, OTP-looking 4–6 digit codes, emails and tokens before it is sent; no user, no
 * person id (the API's reporter sends none either), no request bodies, no breadcrumbs. `extra`
 * keeps only short primitive values under keys that can't hold personal data.
 *
 * Free of React and DOM types, like `net-client`, so Expo native and web, Next.js and Node tests
 * share it.
 */

export interface ParsedDsn {
  envelopeUrl: string;
  publicKey: string;
  dsn: string;
}

/**
 * `https://<key>@<host>[/<path>]/<projectId>` → the project's envelope endpoint; null when malformed.
 * A regex, not `URL`: React Native's `URL` has no `username`. The API's `parseSentryDsn` is this one.
 */
export function parseSentryDsn(dsn: string): ParsedDsn | null {
  const m = /^(https?):\/\/([^:@/\s]+)(?::[^@/\s]*)?@([^/?#\s]+)(\/[^?#\s]*)?$/i.exec(dsn.trim());
  if (!m) return null;
  const [, protocol, publicKey, host, path = ''] = m;
  const parts = path.split('/').filter(Boolean);
  const projectId = parts.pop();
  if (!protocol || !publicKey || !host || !projectId || !/^\d+$/.test(projectId)) return null;
  const prefix = parts.length ? `/${parts.join('/')}` : '';
  return { envelopeUrl: `${protocol.toLowerCase()}://${host.toLowerCase()}${prefix}/api/${projectId}/envelope/`, publicKey, dsn };
}

// ─── Scrubbing ───────────────────────────────────────────────────────────────────────────────────

/** Western, Arabic-Indic and Persian digits (a number typed on an Arabic keyboard is still a number). */
const D = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9]';
const SEP = '[\\s.-]?';
/** +964 / 00964 / 964 then 7xx xxx xxxx, or the local 07xx xxx xxxx (with or without spaces/dashes). */
const PHONE_RE = new RegExp(`(?:(?:\\+|00)?964${SEP}0?|0)?7${D}{2}${SEP}${D}{3}${SEP}${D}{4}(?!${D})`, 'g');
const JWT_RE = /eyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g;
const BEARER_RE = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi;
/** `token=…`, `"authorization": "…"`, `otp: 1234`, `?code=…` and the like: the key stays, the value goes. */
const SECRET_KV_RE =
  /\b((?:[a-z]+[_-]?)?(?:token|authorization|auth|password|passwd|secret|otp|code|pin|api[_-]?key|session|cookie|sig|signature))(["']?\s*[:=]\s*["']?)([^\s"'&,;}\]]+)/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/**
 * A lone 4–6 digit run (an OTP, a seat PIN): not glued to letters or more digits. In a stack, a run
 * after `:` is a line or column number and stays.
 */
const CODE_RE = new RegExp(`(^|[^\\w\\u0660-\\u0669\\u06F0-\\u06F9])${D}{4,6}(?![\\w\\u0660-\\u0669\\u06F0-\\u06F9])`, 'g');
const STACK_CODE_RE = new RegExp(`(^|[^\\w:.\\u0660-\\u0669\\u06F0-\\u06F9])${D}{4,6}(?![\\w\\u0660-\\u0669\\u06F0-\\u06F9])`, 'g');

/** Removes phone numbers, tokens, emails and OTP-looking codes from a message (or a stack). */
export function scrubText(text: string, kind: 'message' | 'stack' = 'message'): string {
  // Arabic-Indic and Persian digits → 0–9 first, so a number typed on an Arabic keyboard is caught too.
  return text
    .replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) & 0xf))
    .replace(JWT_RE, '[token]')
    .replace(BEARER_RE, '$1 [token]')
    .replace(SECRET_KV_RE, '$1$2[redacted]')
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, '[phone]')
    .replace(kind === 'stack' ? STACK_CODE_RE : CODE_RE, '$1[code]');
}

/** Keys whose values may hold personal data or credentials: never sent, even scrubbed. */
const BLOCKED_KEY_RE = /name|phone|mobile|user|person|email|address|body|payload|request|header|cookie|token|auth|pass|secret|otp|pin|code|child|guardian|location|lat|lng|lon/i;

/** `extra`: primitives only, under safe keys, strings scrubbed and cut; objects (users, requests) are dropped. */
export function scrubExtra(extra: Record<string, unknown> | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!extra) return out;
  for (const [key, value] of Object.entries(extra)) {
    if (BLOCKED_KEY_RE.test(key)) continue;
    if (typeof value === 'string') out[key] = clip(scrubText(value), 500);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ─── Envelope ────────────────────────────────────────────────────────────────────────────────────

export interface CrashContext {
  /** Where it came from: `global`, `unhandledrejection`, `boundary`, … */
  logger?: string;
  /** False for a crash the person saw (default); true for an error the app caught and survived. */
  handled?: boolean;
  level?: 'fatal' | 'error' | 'warning';
  extra?: Record<string, unknown>;
}

export interface CrashEventMeta {
  /** `customer` | `partner` | `merchant` | `console`: a tag, and the client name. */
  app: string;
  environment: string;
  release: string;
  /** `ios` | `android` | `web`; a tag. */
  os?: string;
}

export interface CrashEvent {
  event_id: string;
  timestamp: number;
  platform: 'javascript';
  level: string;
  logger: string;
  environment: string;
  release: string;
  tags: Record<string, string>;
  exception: { values: Array<{ type: string; value: string; mechanism: { type: string; handled: boolean } }> };
  extra: Record<string, string | number | boolean>;
}

/** Any thrown value → name, message and stack (all scrubbed). Never reads its other fields. */
export function describeError(error: unknown): { type: string; message: string; stack?: string } {
  if (error instanceof Error || (typeof error === 'object' && error !== null && 'message' in error)) {
    const e = error as { name?: unknown; message?: unknown; stack?: unknown };
    const type = typeof e.name === 'string' && e.name ? e.name : 'Error';
    const message = typeof e.message === 'string' ? e.message : '';
    const stack = typeof e.stack === 'string' ? e.stack : undefined;
    return { type: clip(type, 80), message: clip(scrubText(message), 1000), ...(stack ? { stack: clip(scrubText(stack, 'stack'), 8000) } : {}) };
  }
  // A thrown string or number is kept (scrubbed); an object (a user, a response) is never serialized.
  const message = typeof error === 'string' || typeof error === 'number' || typeof error === 'boolean' ? String(error) : `Non-Error ${error === null ? 'null' : typeof error} thrown`;
  return { type: 'Error', message: clip(scrubText(message), 1000) };
}

export function buildCrashEvent(error: unknown, ctx: CrashContext, meta: CrashEventMeta, eventId: string, now: Date): CrashEvent {
  const { type, message, stack } = describeError(error);
  const handled = ctx.handled ?? false;
  return {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: 'javascript',
    level: ctx.level ?? (handled ? 'error' : 'fatal'),
    logger: ctx.logger ?? `driver-${meta.app}`,
    environment: meta.environment,
    release: meta.release,
    tags: { app: meta.app, ...(meta.os ? { os: meta.os } : {}), handled: handled ? 'yes' : 'no' },
    exception: { values: [{ type, value: message, mechanism: { type: ctx.logger ?? 'generic', handled } }] },
    extra: { ...scrubExtra(ctx.extra), ...(stack ? { stack } : {}) },
  };
}

/** Header line, item header, event: Sentry's envelope format (the same three lines as the API sends). */
export function buildEnvelope(dsn: ParsedDsn, event: CrashEvent, now: Date): string {
  return [JSON.stringify({ event_id: event.event_id, sent_at: now.toISOString(), dsn: dsn.dsn }), JSON.stringify({ type: 'event' }), JSON.stringify(event)].join('\n');
}

/**
 * The URL a client posts to. Auth rides in the query string (as Sentry's browser SDK does) and the
 * body goes as text/plain, so a browser sends it without a CORS preflight.
 */
export function envelopeEndpoint(dsn: ParsedDsn, client: string): string {
  return `${dsn.envelopeUrl}?sentry_version=7&sentry_key=${encodeURIComponent(dsn.publicKey)}&sentry_client=${encodeURIComponent(client)}`;
}

// ─── Reporter ────────────────────────────────────────────────────────────────────────────────────

export interface CrashReporter {
  readonly enabled: boolean;
  capture(error: unknown, ctx?: CrashContext): void;
  /** Waits (at most `timeoutMs`) for reports still in flight. */
  flush(timeoutMs?: number): Promise<void>;
}

export const noopCrashReporter: CrashReporter = { enabled: false, capture: () => undefined, flush: async () => undefined };

export type CrashFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; keepalive?: boolean }) => Promise<unknown>;

export interface CrashReporterOptions extends CrashEventMeta {
  /** Unset, empty or malformed → the no-op reporter: nothing is ever sent. */
  dsn: string | undefined;
  /** At most this many reports per minute, the rest dropped (a crash loop must not flood). Default 10. */
  perMinute?: number;
  fetch?: CrashFetch;
  now?: () => Date;
  randomId?: () => string;
}

/** Default reports a minute from one device (the API allows 30 for the whole server). */
export const CRASH_REPORTS_PER_MINUTE = 10;

function randomEventId(): string {
  const bytes = new Uint8Array(16);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function createCrashReporter(opts: CrashReporterOptions): CrashReporter {
  const raw = opts.dsn?.trim();
  const dsn = raw ? parseSentryDsn(raw) : null;
  if (!dsn) return noopCrashReporter;
  const fetchImpl = opts.fetch ?? ((globalThis as { fetch?: CrashFetch }).fetch as CrashFetch | undefined);
  if (!fetchImpl) return noopCrashReporter;
  const now = opts.now ?? (() => new Date());
  const perMinute = opts.perMinute ?? CRASH_REPORTS_PER_MINUTE;
  const url = envelopeEndpoint(dsn, `driver-${opts.app}/${opts.release}`);
  const inFlight = new Set<Promise<unknown>>();
  // The same error object reaches us twice at times (the boundary and the global handler).
  const seen = new WeakSet<object>();
  let windowStart = 0;
  let sentInWindow = 0;

  return {
    enabled: true,
    capture(error, ctx = {}) {
      try {
        if (typeof error === 'object' && error !== null) {
          if (seen.has(error)) return;
          seen.add(error);
        }
        const at = now();
        if (at.getTime() - windowStart >= 60_000) {
          windowStart = at.getTime();
          sentInWindow = 0;
        }
        if (sentInWindow >= perMinute) return;
        sentInWindow += 1;
        const event = buildCrashEvent(error, ctx, opts, (opts.randomId ?? randomEventId)(), at);
        const send = Promise.resolve()
          .then(() => fetchImpl(url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: buildEnvelope(dsn, event, at), keepalive: true }))
          .catch(() => undefined); // reporting must never throw into the app
        inFlight.add(send);
        void send.finally(() => inFlight.delete(send));
      } catch {
        // never let the reporter itself crash the app
      }
    },
    async flush(timeoutMs = 2000) {
      if (inFlight.size === 0) return;
      // Timers through globalThis: this module carries no DOM or Node types.
      const timers = globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
      let timer: unknown;
      await Promise.race([Promise.allSettled([...inFlight]), new Promise<void>((resolve) => (timer = timers.setTimeout(resolve, timeoutMs)))]);
      timers.clearTimeout(timer);
    },
  };
}

// ─── Global handlers ─────────────────────────────────────────────────────────────────────────────

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
interface ErrorUtilsLike {
  getGlobalHandler(): GlobalHandler | undefined;
  setGlobalHandler(h: GlobalHandler): void;
}
interface EventTargetLike {
  addEventListener(type: string, listener: (e: unknown) => void): void;
  removeEventListener(type: string, listener: (e: unknown) => void): void;
}
interface HermesLike {
  enablePromiseRejectionTracker?: (opts: { allRejections: boolean; onUnhandled: (id: number, reason: unknown) => void; onHandled: (id: number) => void }) => void;
}

export interface CrashHandlerOptions {
  /** Where `ErrorUtils`, `addEventListener` and `HermesInternal` are looked up. Default `globalThis`. */
  target?: object;
  /**
   * React Native on Hermes: track unhandled promise rejections. Off in development, where RN's own
   * tracker (the LogBox warning) owns the hook.
   */
  hermesRejections?: boolean;
}

/**
 * Hooks every unhandled error into the reporter, chaining to whatever handled them before:
 * React Native's `ErrorUtils` global handler (the red box / the native crash still happen), Hermes'
 * promise rejection tracker, and on the web `window` `error` / `unhandledrejection`.
 * Returns an undo (tests, fast refresh). A no-op reporter installs nothing.
 */
export function installCrashHandlers(reporter: CrashReporter, opts: CrashHandlerOptions = {}): () => void {
  if (!reporter.enabled) return () => undefined;
  const g = (opts.target ?? globalThis) as { ErrorUtils?: ErrorUtilsLike; HermesInternal?: HermesLike } & Partial<EventTargetLike>;
  const undo: Array<() => void> = [];

  const eu = g.ErrorUtils;
  if (eu && typeof eu.setGlobalHandler === 'function') {
    const previous = eu.getGlobalHandler?.();
    eu.setGlobalHandler((error, isFatal) => {
      reporter.capture(error, { logger: 'global', handled: false, level: isFatal === false ? 'error' : 'fatal' });
      previous?.(error, isFatal);
    });
    undo.push(() => {
      if (previous) eu.setGlobalHandler(previous);
    });
  }

  if (opts.hermesRejections && typeof g.HermesInternal?.enablePromiseRejectionTracker === 'function') {
    g.HermesInternal.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (_id, reason) => reporter.capture(reason, { logger: 'unhandledrejection', handled: false, level: 'error' }),
      onHandled: () => undefined,
    });
  }

  if (typeof g.addEventListener === 'function' && typeof g.removeEventListener === 'function') {
    const onError = (e: unknown) => {
      const ev = e as { error?: unknown; message?: unknown };
      reporter.capture(ev.error ?? (typeof ev.message === 'string' ? ev.message : 'Script error'), { logger: 'window.onerror', handled: false });
    };
    const onRejection = (e: unknown) => reporter.capture((e as { reason?: unknown }).reason, { logger: 'unhandledrejection', handled: false, level: 'error' });
    g.addEventListener('error', onError);
    g.addEventListener('unhandledrejection', onRejection);
    undo.push(() => {
      g.removeEventListener?.('error', onError);
      g.removeEventListener?.('unhandledrejection', onRejection);
    });
  }

  return () => undo.forEach((u) => u());
}
