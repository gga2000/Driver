import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriverError, LIVE_RULES, type LiveBusEvent, type LiveEvent, type SessionClaims } from '@driver/contracts';
import { InMemoryLiveBus } from './live.bus.js';
import { LIVE_QUEUE_MAX, LiveService } from './live.service.js';
import { StreamTokens } from './live.tokens.js';

// Session claims are checked against the real clock: issue them now, not on a fixed date (a fixed T0
// expired 15 minutes after it, failing these tests later the same day).
const T0 = new Date();
const claims = (over: Partial<SessionClaims> = {}): SessionClaims => ({
  sub: 'p1',
  sid: 's1',
  iss: 'driver-api',
  iat: T0.getTime() / 1000,
  exp: T0.getTime() / 1000 + 900,
  ...over,
});
const actor = { personId: 'p1', sessionId: 's1' };

function harness(opts: { sessionLive?: () => Promise<void> } = {}) {
  const bus = new InMemoryLiveBus();
  const clock = { now: () => new Date() };
  const tokens = new StreamTokens(
    new TextEncoder().encode('test-secret-test-secret-test-secret!!'),
    () => clock.now(),
  );
  const sessions = { assertSessionLive: vi.fn(opts.sessionLive ?? (async () => undefined)) };
  const live = new LiveService(bus, tokens, sessions, clock);
  return { bus, live, sessions, tokens };
}

/** Pulls events off a stream in the background. */
function drain(it: AsyncIterable<LiveEvent>) {
  const events: LiveEvent[] = [];
  let error: unknown = null;
  let done = false;
  const finished = (async () => {
    try {
      for await (const e of it) events.push(e);
    } catch (err) {
      error = err;
    } finally {
      done = true;
    }
  })();
  return {
    events,
    finished,
    get error() {
      return error;
    },
    get done() {
      return done;
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveService.stream — fan-out through the in-memory bus', () => {
  it('says hello once listening, then forwards only its own channels', async () => {
    const { bus, live } = harness();
    const ac = new AbortController();
    const a = drain(
      live.stream({
        actor,
        claims: claims(),
        channels: ['order:o1'],
        check: async () => undefined,
        signal: ac.signal,
      }),
    );
    const b = drain(
      live.stream({
        actor,
        claims: claims(),
        channels: ['order:o2'],
        check: async () => undefined,
        signal: ac.signal,
      }),
    );
    await flush();
    expect(a.events[0]).toMatchObject({ type: 'hello', channels: ['order:o1'] });
    await bus.publish('order:o1', {
      type: 'invalidate',
      keys: ['orders.track'],
      cause: 'order.accepted',
      orderId: 'o1',
    });
    await bus.publish('order:o2', {
      type: 'order_state',
      orderId: 'o2',
      state: 'ready',
      cause: 'order.ready',
    });
    await flush();
    expect(a.events.map((e) => e.type)).toEqual(['hello', 'invalidate']);
    expect(b.events.map((e) => e.type)).toEqual(['hello', 'order_state']);
    ac.abort();
    await Promise.all([a.finished, b.finished]);
    // Abort unsubscribes: nothing left listening.
    expect(bus.channels()).toEqual([]);
  });

  it('a refused scope check streams nothing (not even hello) and leaves no listener', async () => {
    const { bus, live } = harness();
    const s = drain(
      live.stream({
        actor,
        claims: claims(),
        channels: ['merchant:m2'],
        check: async () => {
          throw new DriverError('forbidden');
        },
      }),
    );
    await s.finished;
    expect(s.events).toEqual([]);
    expect((s.error as DriverError).code).toBe('forbidden');
    expect(bus.channels()).toEqual([]);
  });

  it('filters events per stream', async () => {
    const { bus, live } = harness();
    const ac = new AbortController();
    const s = drain(
      live.stream({
        actor,
        claims: claims(),
        channels: ['c'],
        check: async () => undefined,
        filter: (e) => e.type !== 'position',
        signal: ac.signal,
      }),
    );
    await flush();
    await bus.publish('c', {
      type: 'position',
      orderId: 'o',
      tripId: 't',
      pin: { lat: 1, lng: 2 },
      bearing: null,
      speedKmh: null,
      at: new Date(),
    });
    await bus.publish('c', { type: 'invalidate', keys: ['orders.track'], cause: 'x' });
    await flush();
    expect(s.events.map((e) => e.type)).toEqual(['hello', 'invalidate']);
    ac.abort();
    await s.finished;
  });

  it('re-checks scope and session every recheckMs; a revoked role ends the stream', async () => {
    vi.useFakeTimers({ now: T0 });
    let allowed = true;
    const { live, sessions } = harness();
    const s = drain(
      live.stream({
        actor,
        claims: claims(),
        channels: ['merchant:m1'],
        check: async () => {
          if (!allowed) throw new DriverError('forbidden');
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(LIVE_RULES.recheckMs + 10);
    expect(sessions.assertSessionLive).toHaveBeenCalledTimes(1);
    expect(s.done).toBe(false);
    allowed = false;
    await vi.advanceTimersByTimeAsync(LIVE_RULES.recheckMs + 10);
    await s.finished;
    expect((s.error as DriverError).code).toBe('forbidden');
  });

  it('a revoked session ends the stream at the next re-check', async () => {
    vi.useFakeTimers({ now: T0 });
    let live = true;
    const h = harness({
      sessionLive: async () => {
        if (!live) throw new DriverError('session_expired');
      },
    });
    const s = drain(
      h.live.stream({
        actor,
        claims: claims(),
        channels: ['driver:p1'],
        check: async () => undefined,
      }),
    );
    live = false;
    await vi.advanceTimersByTimeAsync(LIVE_RULES.recheckMs + 10);
    await s.finished;
    expect((s.error as DriverError).code).toBe('session_expired');
  });

  it('drops the stream when its token expires (401: the client mints a new one and reconnects)', async () => {
    vi.useFakeTimers({ now: T0 });
    const { live } = harness();
    const s = drain(
      live.stream({
        actor,
        claims: claims({ exp: T0.getTime() / 1000 + 5 }),
        channels: ['order:o1'],
        check: async () => undefined,
      }),
    );
    await vi.advanceTimersByTimeAsync(4_000);
    expect(s.done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    await s.finished;
    expect((s.error as DriverError).code).toBe('session_expired');
  });

  it('a client that falls too far behind is cut off (it reconnects and resyncs)', async () => {
    const { bus, live } = harness();
    const stream = live.stream({ actor, claims: claims(), channels: ['city:aziziyah'], check: async () => undefined });
    const it = stream[Symbol.asyncIterator]();
    expect((await it.next()).value).toMatchObject({ type: 'hello' });
    for (let i = 0; i <= LIVE_QUEUE_MAX; i++)
      await bus.publish('city:aziziyah', {
        type: 'invalidate',
        keys: ['dispatch.board'],
        cause: `e${i}`,
      });
    // The backlog is stale anyway: the stream ends at once and the client's resync re-reads everything.
    expect(await it.next()).toEqual({ done: true, value: undefined });
  });

  it('module shutdown ends open streams', async () => {
    const { live } = harness();
    const s = drain(
      live.stream({
        actor,
        claims: claims(),
        channels: ['order:o1'],
        check: async () => undefined,
      }),
    );
    await flush();
    expect(live.openStreams()).toBe(1);
    live.onModuleDestroy();
    await s.finished;
    expect(s.error).toBeNull();
    expect(live.openStreams()).toBe(0);
  });
});

describe('stream tokens', () => {
  it('round-trip; expire with the access token; refuse another key or a tampered token', async () => {
    const { live, tokens, sessions } = harness();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const t = await live.token(actor, claims({ exp, did: 'd1' }));
    expect(t.expiresAt.getTime()).toBe(exp * 1000);
    expect(await live.authenticate(t.token)).toMatchObject({
      sub: 'p1',
      sid: 's1',
      did: 'd1',
      exp,
    });
    expect(sessions.assertSessionLive).toHaveBeenCalledWith(expect.objectContaining({ sid: 's1' }));
    const other = new StreamTokens(
      new TextEncoder().encode('another-secret-another-secret-12345'),
      () => new Date(),
    );
    await expect(other.verify(t.token)).rejects.toMatchObject({ code: 'token_invalid' });
    await expect(tokens.verify(`${t.token}x`)).rejects.toMatchObject({ code: 'token_invalid' });
    // Never longer than the stream-token TTL.
    const long = await live.token(actor, claims({ exp: Math.floor(Date.now() / 1000) + 86_400 }));
    expect(long.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
      LIVE_RULES.streamTokenTtlSec * 1000 + 1000,
    );
  });

  it('an expired token is session_expired', async () => {
    vi.useFakeTimers({ now: T0 });
    const { tokens } = harness();
    const t = await tokens.issue(claims({ exp: T0.getTime() / 1000 + 10 }));
    vi.setSystemTime(new Date(T0.getTime() + 11_000));
    await expect(tokens.verify(t.token)).rejects.toMatchObject({ code: 'session_expired' });
  });
});

describe('LiveService.watch — wake-ups for a public stream (live.share)', () => {
  /** Counts wake-ups in the background. */
  function count(it: AsyncIterable<void>) {
    let n = 0;
    let done = false;
    const finished = (async () => {
      const wakes = it[Symbol.asyncIterator]();
      while (!(await wakes.next()).done) n += 1;
      done = true;
    })();
    return {
      finished,
      get n() {
        return n;
      },
      get done() {
        return done;
      },
    };
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const event: LiveBusEvent = { type: 'invalidate', keys: ['orders.track'], cause: 'order.accepted' };

  it('wakes once listening, then on its channels only — a burst is the first event at once plus one after the gap', async () => {
    const { bus, live } = harness();
    const ac = new AbortController();
    const w = count(live.watch({ channels: ['order:o1'], everyMs: 60_000, minGapMs: 40, signal: ac.signal }));
    await sleep(5);
    expect(w.n).toBe(1);
    await bus.publish('order:o2', event);
    await sleep(60);
    expect(w.n).toBe(1);
    for (let i = 0; i < 5; i++) await bus.publish('order:o1', event);
    await sleep(80);
    expect(w.n).toBe(3);
    ac.abort();
    await w.finished;
    expect(w.done).toBe(true);
    expect(live.openStreams()).toBe(0);
  });

  it('wakes on its own when the channels stay quiet (intercity has none)', async () => {
    const { live } = harness();
    const ac = new AbortController();
    const w = count(live.watch({ channels: [], everyMs: 30, minGapMs: 10, signal: ac.signal }));
    await sleep(100);
    expect(w.n).toBeGreaterThanOrEqual(3);
    ac.abort();
    await w.finished;
  });

  it('ends on shutdown', async () => {
    const { live } = harness();
    const w = count(live.watch({ channels: ['order:o1'], everyMs: 60_000, minGapMs: 10 }));
    await sleep(5);
    live.onModuleDestroy();
    await w.finished;
    expect(w.done).toBe(true);
  });
});
