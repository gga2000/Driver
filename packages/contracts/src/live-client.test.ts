import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIVE_RULES, type LiveEvent } from './live-io.js';
import {
  createLiveConnection,
  createStreamTokenCache,
  createXhrEventSource,
  isLiveAuthError,
  liveBackoffMs,
  livePollMs,
  MiniReadableStream,
  SseParser,
  type LiveMode,
  type LiveSubscriptionHandlers,
  type XhrLike,
} from './live-client.js';

const hello: LiveEvent = { type: 'hello', channels: ['order:o1'], serverNow: new Date() };
const inv: LiveEvent = { type: 'invalidate', keys: ['orders.track'], cause: 'order.accepted' };

afterEach(() => {
  vi.useRealTimers();
});

/** A controller over a scripted subscription: each `open` is an attempt the test drives. */
function harness() {
  const attempts: Array<LiveSubscriptionHandlers & { closed: boolean }> = [];
  const modes: LiveMode[] = [];
  const events: LiveEvent[] = [];
  const onResync = vi.fn();
  const onAuthError = vi.fn();
  const conn = createLiveConnection({
    open: (h) => {
      const a = { ...h, closed: false };
      attempts.push(a);
      return { unsubscribe: () => void (a.closed = true) };
    },
    onEvent: (e) => events.push(e),
    onResync,
    onModeChange: (m) => modes.push(m),
    isAuthError: isLiveAuthError,
    onAuthError,
    random: () => 0.5,
  });
  return {
    conn,
    attempts,
    modes,
    events,
    onResync,
    onAuthError,
    last: () => attempts[attempts.length - 1]!,
  };
}

describe('live connection controller', () => {
  it('connects, goes live on hello and resyncs; forwards events', () => {
    vi.useFakeTimers();
    const h = harness();
    h.conn.start();
    expect(h.conn.mode()).toBe('connecting');
    h.last().onData(hello);
    h.last().onData(inv);
    expect(h.conn.mode()).toBe('live');
    expect(h.onResync).toHaveBeenCalledTimes(1);
    expect(h.events).toEqual([hello, inv]);
  });

  it('reconnects with backoff after a drop and resyncs on the new hello', () => {
    vi.useFakeTimers();
    const h = harness();
    h.conn.start();
    h.last().onData(hello);
    h.last().onError(new Error('network'));
    expect(h.attempts[0]!.closed).toBe(true);
    expect(h.conn.mode()).toBe('connecting');
    vi.advanceTimersByTime(liveBackoffMs(1, () => 0.5) - 1);
    expect(h.attempts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(h.attempts).toHaveLength(2);
    h.last().onData(hello);
    expect(h.conn.mode()).toBe('live');
    expect(h.onResync).toHaveBeenCalledTimes(2);
  });

  it('falls back to slow polling after repeated failures, keeps retrying, and recovers', () => {
    vi.useFakeTimers();
    const h = harness();
    h.conn.start();
    for (let i = 1; i <= LIVE_RULES.failuresBeforeFallback; i++) {
      h.last().onError(new Error('proxy'));
      vi.advanceTimersByTime(liveBackoffMs(i, () => 0.5));
    }
    expect(h.modes).toContain('fallback');
    expect(livePollMs(h.conn.mode())).toBe(LIVE_RULES.fallbackPollMs);
    // Still trying in the background.
    expect(h.attempts).toHaveLength(LIVE_RULES.failuresBeforeFallback + 1);
    h.last().onData(hello);
    expect(h.conn.mode()).toBe('live');
    expect(livePollMs('live')).toBe(LIVE_RULES.safetyPollMs);
  });

  it('a proxy that buffers SSE (no hello) counts as a failure after the connect timeout', () => {
    vi.useFakeTimers();
    const h = harness();
    h.conn.start();
    vi.advanceTimersByTime(LIVE_RULES.connectTimeoutMs);
    expect(h.attempts[0]!.closed).toBe(true);
    // A late hello on the dropped attempt is ignored.
    h.attempts[0]!.onData(hello);
    expect(h.conn.mode()).toBe('connecting');
  });

  it('a 401 drops the cached stream token before the next attempt; the server ending the stream reconnects', () => {
    vi.useFakeTimers();
    const h = harness();
    h.conn.start();
    h.last().onData(hello);
    h.last().onError({ data: { httpStatus: 401, code: 'session_expired' } });
    expect(h.onAuthError).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    h.last().onData(hello);
    h.last().onComplete();
    expect(h.conn.mode()).toBe('connecting');
    vi.advanceTimersByTime(1_000);
    expect(h.attempts).toHaveLength(3);
  });

  it('reconnectNow skips the wait; stop closes everything', () => {
    vi.useFakeTimers();
    const h = harness();
    h.conn.start();
    h.last().onError(new Error('x'));
    h.conn.reconnectNow();
    expect(h.attempts).toHaveLength(2);
    h.conn.stop();
    expect(h.last().closed).toBe(true);
    expect(h.conn.mode()).toBe('stopped');
    vi.advanceTimersByTime(60_000);
    expect(h.attempts).toHaveLength(2);
  });

  it('backoff doubles up to the cap with ±20 % jitter', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => liveBackoffMs(n, () => 0.5))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
    expect(liveBackoffMs(1, () => 0)).toBe(800);
    expect(liveBackoffMs(1, () => 1)).toBe(1200);
  });
});

describe('stream token cache', () => {
  it('fetches once, reuses until shortly before expiry, refetches after clear', async () => {
    let now = 0;
    let n = 0;
    const cache = createStreamTokenCache(
      async () => ({ token: `t${++n}`, expiresAt: new Date(60_000) }),
      () => now,
    );
    expect(await Promise.all([cache.get(), cache.get()])).toEqual(['t1', 't1']);
    now = 45_000;
    expect(await cache.get()).toBe('t1');
    now = 55_000;
    expect(await cache.get()).toBe('t2');
    cache.clear();
    expect(await cache.get()).toBe('t3');
  });
});

describe('SSE parsing and the React Native ponyfills', () => {
  it('parses events split across chunks, CRLF, comments and multi-line data', () => {
    const got: Array<{ type: string; data: string; lastEventId: string }> = [];
    const p = new SseParser((e) => got.push(e));
    p.feed('event: connected\r\ndata: {"a"');
    p.feed(':1}\r\n\r\n: ping comment\n\nid: 7\ndata: line1\ndata: line2\n\n');
    p.feed('event: ping\ndata: \n\n');
    expect(got).toEqual([
      { type: 'connected', data: '{"a":1}', lastEventId: '' },
      { type: 'message', data: 'line1\nline2', lastEventId: '7' },
      { type: 'ping', data: '', lastEventId: '7' },
    ]);
  });

  it('MiniReadableStream: queue, waiting reads, close, error, cancel', async () => {
    let ctl!: { enqueue(v: number): void; close(): void; error(e: unknown): void };
    const cancelled = vi.fn();
    const s = new MiniReadableStream<number>({ start: (c) => void (ctl = c), cancel: cancelled });
    const r = s.getReader();
    ctl.enqueue(1);
    expect(await r.read()).toEqual({ done: false, value: 1 });
    const pending = r.read();
    ctl.enqueue(2);
    expect(await pending).toEqual({ done: false, value: 2 });
    ctl.close();
    ctl.enqueue(3);
    expect(await r.read()).toEqual({ done: true, value: undefined });
    const s2 = new MiniReadableStream<number>({ start: (c) => void (ctl = c), cancel: cancelled });
    const r2 = s2.getReader();
    const failing = r2.read();
    ctl.error(new Error('boom'));
    await expect(failing).rejects.toThrow('boom');
    const s3 = new MiniReadableStream<number>({ cancel: cancelled });
    await s3.getReader().cancel('bye');
    expect(cancelled).toHaveBeenCalledWith('bye');
  });

  it('XhrEventSource streams incremental responseText and closes (no auto-reconnect) when the stream ends', async () => {
    let xhr!: XhrLike & { push(text: string, state?: number): void };
    class FakeXhr implements XhrLike {
      readyState = 0;
      status = 0;
      responseText = '';
      onreadystatechange: (() => void) | null = null;
      onprogress: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      headers: Record<string, string> = {};
      url = '';
      constructor() {
        xhr = Object.assign(this, {
          push: (text: string, state = 3) => {
            this.status = 200;
            this.readyState = state;
            this.responseText += text;
            this.onprogress?.();
          },
        });
      }
      open(_m: string, url: string) {
        this.url = url;
      }
      setRequestHeader(k: string, v: string) {
        this.headers[k] = v;
      }
      send() {}
      abort() {}
    }
    const ES = createXhrEventSource(FakeXhr);
    const es = new ES('http://api/trpc/live.order?input=1');
    const seen: string[] = [];
    es.addEventListener('open', () => seen.push('open'));
    es.addEventListener('connected', (e) => seen.push(`connected:${e.data}`));
    es.addEventListener('message', (e) => seen.push(`message:${e.data}`));
    es.addEventListener('error', () => seen.push(`error:${es.readyState}`));
    await Promise.resolve();
    expect((xhr as unknown as { headers: Record<string, string> }).headers['Accept']).toBe(
      'text/event-stream',
    );
    xhr.push('event: connected\ndata: {}\n\n');
    xhr.push('data: {"json":1}\n');
    xhr.push('\n');
    xhr.push('', 4);
    expect(seen).toEqual(['open', 'connected:{}', 'message:{"json":1}', `error:${es.CLOSED}`]);
  });
});
