import { LIVE_RULES, type LiveEvent } from './live-io.js';

/**
 * Client side of the real-time channel, free of React and DOM types so every app (Expo native and
 * web, the Next.js Console) and plain Node tests share it (`@driver/contracts/live-client`):
 *
 *  - `XhrEventSource` — an EventSource over XMLHttpRequest for React Native (no EventSource there);
 *    browsers keep their native one;
 *  - `installReadableStreamPolyfill` — the minimal `ReadableStream` tRPC's SSE consumer needs (Hermes
 *    has none);
 *  - `createStreamTokenCache` — the `live.token` stream token for `connectionParams`, cached until
 *    shortly before it expires and dropped on an auth error;
 *  - `createLiveConnection` — keeps one subscription alive: reconnects with backoff, resyncs (the
 *    caller refetches) on every `hello`, and reports `fallback` after repeated failures so the
 *    screens poll slowly while it keeps trying.
 */

// ───────────────────────── backoff ─────────────────────────

/** Delay before reconnect attempt `n` (1-based): base × 2^(n−1), capped, ±20 % jitter. */
export function liveBackoffMs(
  n: number,
  random: () => number = Math.random,
  rules: Pick<typeof LIVE_RULES, 'backoffBaseMs' | 'backoffMaxMs'> = LIVE_RULES,
): number {
  const raw = Math.min(rules.backoffMaxMs, rules.backoffBaseMs * 2 ** Math.max(0, n - 1));
  return Math.round(raw * (0.8 + 0.4 * random()));
}

// ───────────────────────── connection controller ─────────────────────────

/** `connecting`: no stream yet · `live`: events flowing · `fallback`: SSE keeps failing, poll slowly · `stopped`. */
export type LiveMode = 'connecting' | 'live' | 'fallback' | 'stopped';

export interface LiveSubscriptionHandlers {
  onData(event: LiveEvent): void;
  onError(err: unknown): void;
  /** The server ended the stream (token expiry ends it with an error instead). */
  onComplete(): void;
}

export interface LiveTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface LiveConnectionOptions {
  /** Opens the tRPC subscription (`client.live.order.subscribe(input, handlers)`). */
  open(handlers: LiveSubscriptionHandlers): { unsubscribe(): void };
  /** Every event, `hello` included, after the controller's own bookkeeping. */
  onEvent(event: LiveEvent): void;
  /** Re-read everything the channel covers: called on every `hello` (first connect and each reconnect). */
  onResync(): void;
  onModeChange?(mode: LiveMode): void;
  /** True for a refused token (401): the stream token is dropped before the next attempt. */
  isAuthError?(err: unknown): boolean;
  onAuthError?(err: unknown): void;
  timers?: LiveTimers;
  random?: () => number;
  rules?: Partial<
    Pick<
      typeof LIVE_RULES,
      'connectTimeoutMs' | 'backoffBaseMs' | 'backoffMaxMs' | 'failuresBeforeFallback'
    >
  >;
}

export interface LiveConnection {
  start(): void;
  stop(): void;
  mode(): LiveMode;
  /** Retry now (app back in the foreground, network back) unless already live. */
  reconnectNow(): void;
}

/** The runtime's timers (typed structurally: this package compiles without DOM or Node types). */
const runtime = globalThis as unknown as {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
};
const realTimers: LiveTimers = {
  setTimeout: (fn, ms) => runtime.setTimeout(fn, ms),
  clearTimeout: (h) => runtime.clearTimeout(h),
};

export function createLiveConnection(opts: LiveConnectionOptions): LiveConnection {
  const rules = { ...LIVE_RULES, ...opts.rules };
  const timers = opts.timers ?? realTimers;
  let mode: LiveMode = 'stopped';
  let failures = 0;
  let generation = 0;
  let sub: { unsubscribe(): void } | null = null;
  let connectTimer: unknown = null;
  let retryTimer: unknown = null;

  const setMode = (next: LiveMode) => {
    if (mode === next) return;
    mode = next;
    opts.onModeChange?.(next);
  };
  const clearTimers = () => {
    if (connectTimer !== null) timers.clearTimeout(connectTimer);
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    connectTimer = null;
    retryTimer = null;
  };
  const drop = () => {
    generation += 1;
    const s = sub;
    sub = null;
    try {
      s?.unsubscribe();
    } catch {
      // already closed
    }
  };

  const fail = (err: unknown) => {
    if (mode === 'stopped') return;
    clearTimers();
    drop();
    failures += 1;
    if (opts.isAuthError?.(err)) opts.onAuthError?.(err);
    setMode(failures >= rules.failuresBeforeFallback ? 'fallback' : 'connecting');
    retryTimer = timers.setTimeout(
      () => {
        retryTimer = null;
        connect();
      },
      liveBackoffMs(failures, opts.random, rules),
    );
  };

  const connect = () => {
    if (mode === 'stopped') return;
    drop();
    const gen = generation;
    /** Callbacks of an attempt that was dropped (timed out, failed, stopped) are ignored. */
    const current = () => gen === generation && mode !== 'stopped';
    connectTimer = timers.setTimeout(() => {
      connectTimer = null;
      if (gen === generation) fail(new Error('live_connect_timeout'));
    }, rules.connectTimeoutMs);
    try {
      sub = opts.open({
        onData: (event: LiveEvent) => {
          if (!current()) return;
          if (event.type === 'hello') {
            if (connectTimer !== null) timers.clearTimeout(connectTimer);
            connectTimer = null;
            failures = 0;
            setMode('live');
            opts.onResync();
          }
          opts.onEvent(event);
        },
        onError: (err: unknown) => {
          if (current()) fail(err);
        },
        onComplete: () => {
          if (current()) fail(new Error('live_stream_ended'));
        },
      });
    } catch (err) {
      fail(err);
    }
  };

  return {
    start() {
      if (mode !== 'stopped') return;
      failures = 0;
      setMode('connecting');
      connect();
    },
    stop() {
      clearTimers();
      setMode('stopped');
      drop();
    },
    mode: () => mode,
    reconnectNow() {
      if (mode === 'stopped' || mode === 'live') return;
      clearTimers();
      connect();
    },
  };
}

/** Refetch interval for a query the channel covers: slow safety poll while live, fallback poll otherwise. */
export function livePollMs(
  mode: LiveMode,
  rules: Pick<typeof LIVE_RULES, 'safetyPollMs' | 'fallbackPollMs'> = LIVE_RULES,
): number {
  return mode === 'live' ? rules.safetyPollMs : rules.fallbackPollMs;
}

/** 401 from the API (refused or expired stream token / session). */
export function isLiveAuthError(err: unknown): boolean {
  const data = (err as { data?: { httpStatus?: unknown } } | null | undefined)?.data;
  return data?.httpStatus === 401;
}

// ───────────────────────── stream token ─────────────────────────

export interface StreamTokenCache {
  /** A valid stream token (cached; fetched single-flight when missing or about to expire). */
  get(): Promise<string>;
  clear(): void;
}

/** Keeps the `live.token` result; `connectionParams: async () => ({ streamToken: await cache.get() })`. */
export function createStreamTokenCache(
  fetchToken: () => Promise<{ token: string; expiresAt: Date }>,
  now: () => number = Date.now,
  marginMs = 10_000,
): StreamTokenCache {
  let cached: { token: string; expiresAt: Date } | null = null;
  let inflight: Promise<string> | null = null;
  return {
    get() {
      if (cached && cached.expiresAt.getTime() - now() > marginMs)
        return Promise.resolve(cached.token);
      inflight ??= fetchToken()
        .then((t) => {
          cached = t;
          return t.token;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    clear() {
      cached = null;
    },
  };
}

// ───────────────────────── EventSource over XHR (React Native) ─────────────────────────

type Listener = (event: { type: string; data?: string; lastEventId?: string }) => void;

/** The slice of XMLHttpRequest the ponyfill uses (structural: no DOM lib needed). */
export interface XhrLike {
  readyState: number;
  status: number;
  responseText: string;
  withCredentials?: boolean;
  onreadystatechange: (() => void) | null;
  onprogress: (() => void) | null;
  onerror: (() => void) | null;
  onload: (() => void) | null;
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  getResponseHeader?(name: string): string | null;
  send(body?: null): void;
  abort(): void;
}
export type XhrConstructor = new () => XhrLike;

/** Incremental `text/event-stream` parser (WHATWG): feed chunks, get dispatched events. */
export class SseParser {
  private buffer = '';
  private data: string[] = [];
  private event = '';
  private hasField = false;
  lastEventId = '';

  constructor(
    private readonly dispatch: (e: { type: string; data: string; lastEventId: string }) => void,
  ) {}

  feed(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const m = /\r\n|\r|\n/.exec(this.buffer);
      if (!m) return;
      // A lone \r at the end may be the first half of \r\n: wait for more.
      if (m[0] === '\r' && m.index === this.buffer.length - 1) return;
      const line = this.buffer.slice(0, m.index);
      this.buffer = this.buffer.slice(m.index + m[0].length);
      this.line(line);
    }
  }

  private line(line: string): void {
    if (line === '') {
      if (this.hasField && this.data.length > 0)
        this.dispatch({
          type: this.event || 'message',
          data: this.data.join('\n'),
          lastEventId: this.lastEventId,
        });
      this.data = [];
      this.event = '';
      this.hasField = false;
      return;
    }
    if (line.startsWith(':')) return;
    const i = line.indexOf(':');
    const field = i < 0 ? line : line.slice(0, i);
    let value = i < 0 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    this.hasField = true;
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
    else if (field === 'id' && !value.includes('\0')) this.lastEventId = value;
  }
}

/**
 * Builds an EventSource class over `Xhr` (default: the global XMLHttpRequest, which React Native
 * streams incrementally when `onprogress` is set before `send`). Unlike a browser EventSource it
 * never reconnects by itself: any failure closes it (`readyState = CLOSED`, then `error`), and the
 * live controller reconnects with backoff and a fresh stream token.
 */
export interface XhrEventSourceInstance {
  readonly CONNECTING: number;
  readonly OPEN: number;
  readonly CLOSED: number;
  readyState: number;
  readonly url: string;
  readonly withCredentials: boolean;
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
  close(): void;
}
/**
 * `headers`: extra request headers on every connection (a browser EventSource can send none; the
 * apps pass the build header `x-driver-app` here through httpSubscriptionLink's eventSourceOptions).
 */
export interface XhrEventSourceInit {
  withCredentials?: boolean;
  headers?: Readonly<Record<string, string>>;
}
export type XhrEventSourceConstructor = new (url: string, init?: XhrEventSourceInit) => XhrEventSourceInstance;

export function createXhrEventSource(Xhr?: XhrConstructor): XhrEventSourceConstructor {
  return class XhrEventSource {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readyState = 0;
    readonly url: string;
    readonly withCredentials: boolean;
    /** Why it closed (diagnostics: `error` events carry no detail, like a browser's). */
    lastError: unknown = null;
    private readonly listeners = new Map<string, Set<Listener>>();
    private xhr: XhrLike | null = null;
    private offset = 0;
    private readonly parser = new SseParser((e) =>
      this.emit(e.type, { type: e.type, data: e.data, lastEventId: e.lastEventId }),
    );

    private readonly headers: Readonly<Record<string, string>>;

    constructor(url: string, init?: XhrEventSourceInit) {
      this.url = url;
      this.withCredentials = Boolean(init?.withCredentials);
      this.headers = { ...init?.headers };
      // Listeners are attached right after construction; XHR callbacks are async anyway.
      Promise.resolve().then(
        () => this.connect(),
        (err: unknown) => this.fail(err),
      );
    }

    addEventListener(type: string, listener: Listener): void {
      let set = this.listeners.get(type);
      if (!set) this.listeners.set(type, (set = new Set()));
      set.add(listener);
    }

    removeEventListener(type: string, listener: Listener): void {
      this.listeners.get(type)?.delete(listener);
    }

    close(): void {
      this.readyState = this.CLOSED;
      const x = this.xhr;
      this.xhr = null;
      if (x) {
        x.onreadystatechange = x.onprogress = x.onerror = x.onload = null;
        try {
          x.abort();
        } catch {
          // already done
        }
      }
    }

    private emit(type: string, event: { type: string; data?: string; lastEventId?: string }): void {
      for (const l of [...(this.listeners.get(type) ?? [])]) l(event);
    }

    private connect(): void {
      if (this.readyState === this.CLOSED) return;
      const Ctor = Xhr ?? (globalThis as { XMLHttpRequest?: XhrConstructor }).XMLHttpRequest;
      if (!Ctor) return this.fail(new Error('XMLHttpRequest unavailable'));
      const x = new Ctor();
      this.xhr = x;
      x.open('GET', this.url);
      x.setRequestHeader('Accept', 'text/event-stream');
      x.setRequestHeader('Cache-Control', 'no-cache');
      for (const [k, v] of Object.entries(this.headers)) x.setRequestHeader(k, v);
      if (this.withCredentials) x.withCredentials = true;
      const pump = () => {
        if (this.xhr !== x) return;
        if (x.readyState >= 2 && this.readyState === this.CONNECTING) {
          if (x.status !== 200) return this.fail(new Error(`HTTP ${x.status}`));
          this.readyState = this.OPEN;
          this.emit('open', { type: 'open' });
        }
        if (x.readyState >= 3 && this.readyState === this.OPEN) {
          const text = x.responseText ?? '';
          if (text.length > this.offset) {
            const chunk = text.slice(this.offset);
            this.offset = text.length;
            this.parser.feed(chunk);
          }
        }
        if (x.readyState === 4 && this.xhr === x) this.fail(new Error('stream ended'));
      };
      // Set before send: React Native only streams incremental data when a progress handler exists.
      x.onprogress = pump;
      x.onreadystatechange = pump;
      x.onload = pump;
      x.onerror = () => this.fail(new Error('network error'));
      x.send(null);
    }

    private fail(err: unknown): void {
      if (this.readyState === this.CLOSED) return;
      this.lastError = err;
      this.close();
      this.emit('error', { type: 'error' });
    }
  };
}

/** The ponyfill bound to the global XMLHttpRequest. */
export const XhrEventSource = createXhrEventSource();

/** The slice of `fetch` the Node ponyfill uses (structural). */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: unknown },
) => Promise<{
  status: number;
  body: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
    };
  } | null;
}>;

/**
 * The same EventSource semantics over `fetch` streaming, for Node (22 has no EventSource): the
 * API's e2e tests and `scripts/e2e/three-apps.mjs` use it. Closes on any failure, like the XHR one.
 */
export function createFetchEventSource(fetchImpl?: FetchLike): XhrEventSourceConstructor {
  const g = globalThis as unknown as {
    fetch?: FetchLike;
    AbortController: new () => { signal: unknown; abort(): void };
    TextDecoder: new () => { decode(b: Uint8Array, o?: { stream: boolean }): string };
  };
  return class FetchEventSource implements XhrEventSourceInstance {
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSED = 2;
    readyState = 0;
    readonly url: string;
    readonly withCredentials = false;
    private readonly listeners = new Map<string, Set<Listener>>();
    private readonly ac = new g.AbortController();
    private readonly parser = new SseParser((e) =>
      this.emit(e.type, { type: e.type, data: e.data, lastEventId: e.lastEventId }),
    );

    constructor(url: string) {
      this.url = url;
      Promise.resolve().then(
        () => this.run(),
        () => this.fail(),
      );
    }

    addEventListener(type: string, listener: Listener): void {
      let set = this.listeners.get(type);
      if (!set) this.listeners.set(type, (set = new Set()));
      set.add(listener);
    }

    removeEventListener(type: string, listener: Listener): void {
      this.listeners.get(type)?.delete(listener);
    }

    close(): void {
      this.readyState = this.CLOSED;
      this.ac.abort();
    }

    private emit(type: string, event: { type: string; data?: string; lastEventId?: string }): void {
      for (const l of [...(this.listeners.get(type) ?? [])]) l(event);
    }

    private async run(): Promise<void> {
      try {
        const f = fetchImpl ?? g.fetch;
        if (!f) throw new Error('fetch unavailable');
        const res = await f(this.url, {
          headers: { accept: 'text/event-stream', 'cache-control': 'no-cache' },
          signal: this.ac.signal,
        });
        if (this.readyState === this.CLOSED) return;
        if (res.status !== 200 || !res.body) return this.fail();
        this.readyState = this.OPEN;
        this.emit('open', { type: 'open' });
        const reader = res.body.getReader();
        const decoder = new g.TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (this.readyState === this.CLOSED) {
            await reader.cancel().catch(() => undefined);
            return;
          }
          if (done) break;
          if (value) this.parser.feed(decoder.decode(value, { stream: true }));
        }
        this.fail();
      } catch {
        this.fail();
      }
    }

    private fail(): void {
      if (this.readyState === this.CLOSED) return;
      this.close();
      this.emit('error', { type: 'error' });
    }
  };
}

// ───────────────────────── ReadableStream (Hermes) ─────────────────────────

interface MiniController<T> {
  enqueue(chunk: T): void;
  close(): void;
  error(err: unknown): void;
}

/**
 * The part of WHATWG ReadableStream tRPC's `sseStreamConsumer` uses: `new ReadableStream({ start,
 * cancel })`, `getReader()`, `read()`, `cancel()`. Enqueue after close is ignored (an EventSource
 * listener may fire late).
 */
export class MiniReadableStream<T> {
  private readonly queue: T[] = [];
  private readonly waiters: Array<{
    resolve: (r: { done: boolean; value: T | undefined }) => void;
    reject: (e: unknown) => void;
  }> = [];
  private state: 'readable' | 'closed' | 'errored' = 'readable';
  private failure: unknown = null;
  private readonly onCancel: ((reason?: unknown) => unknown) | undefined;

  constructor(
    source: {
      start?(controller: MiniController<T>): unknown;
      cancel?(reason?: unknown): unknown;
    } = {},
  ) {
    this.onCancel = source.cancel?.bind(source);
    const controller: MiniController<T> = {
      enqueue: (chunk) => {
        if (this.state !== 'readable') return;
        const w = this.waiters.shift();
        if (w) w.resolve({ done: false, value: chunk });
        else this.queue.push(chunk);
      },
      close: () => {
        if (this.state !== 'readable') return;
        this.state = 'closed';
        if (this.queue.length === 0)
          for (const w of this.waiters.splice(0)) w.resolve({ done: true, value: undefined });
      },
      error: (err) => {
        if (this.state !== 'readable') return;
        this.state = 'errored';
        this.failure = err;
        this.queue.length = 0;
        for (const w of this.waiters.splice(0)) w.reject(err);
      },
    };
    try {
      const started = source.start?.(controller);
      if (started && typeof (started as Promise<unknown>).then === 'function')
        (started as Promise<unknown>).then(undefined, (e: unknown) => controller.error(e));
    } catch (err) {
      controller.error(err);
    }
  }

  getReader() {
    return {
      read: (): Promise<{ done: boolean; value: T | undefined }> => {
        if (this.queue.length > 0)
          return Promise.resolve({ done: false, value: this.queue.shift() });
        if (this.state === 'closed') return Promise.resolve({ done: true, value: undefined });
        if (this.state === 'errored') return Promise.reject(this.failure);
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
      cancel: async (reason?: unknown): Promise<void> => {
        if (this.state === 'readable') this.state = 'closed';
        this.queue.length = 0;
        for (const w of this.waiters.splice(0)) w.resolve({ done: true, value: undefined });
        await this.onCancel?.(reason);
      },
      releaseLock: () => undefined,
    };
  }
}

/** Installs `MiniReadableStream` as the global `ReadableStream` when the runtime has none (Hermes). */
export function installReadableStreamPolyfill(): boolean {
  const g = globalThis as { ReadableStream?: unknown };
  if (typeof g.ReadableStream !== 'undefined') return false;
  g.ReadableStream = MiniReadableStream;
  return true;
}
