import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyError,
  connectionBanner,
  createNetworkMonitor,
  errorKind,
  isNetworkError,
  isStale,
  NET_RULES,
  RequestTimeoutError,
  secondsSince,
  settleWithin,
  trackFetch,
  withTimeout,
  type NetSnapshot,
} from './net-client.js';

afterEach(() => {
  vi.useRealTimers();
});

/** A monitor on fake timers with a scripted probe. */
function harness(probeAnswers: boolean[] = []) {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const probe = vi.fn(async () => probeAnswers.shift() ?? false);
  const monitor = createNetworkMonitor({ probe });
  const seen: NetSnapshot[] = [];
  monitor.subscribe(() => seen.push(monitor.getSnapshot()));
  return { monitor, probe, seen, state: () => monitor.getSnapshot().state };
}

describe('network monitor', () => {
  it('follows the device: offline at once, online again with a probe', async () => {
    const h = harness([true]);
    expect(h.state()).toBe('online');
    h.monitor.setDeviceOnline(false);
    expect(h.state()).toBe('offline');
    // Requests failing while the device is offline don't turn it into "unreachable".
    h.monitor.reportNetworkError();
    h.monitor.reportNetworkError();
    expect(h.state()).toBe('offline');
    vi.advanceTimersByTime(5_000);
    h.monitor.setDeviceOnline(true);
    expect(h.state()).toBe('online');
    expect(h.probe).toHaveBeenCalledTimes(1);
    // The outage showed the strip, so "رجع النت" is due.
    expect(h.monitor.getSnapshot().backAt).toBe(Date.now());
  });

  it('a blip shorter than the banner delay earns no "رجع النت"', () => {
    const h = harness([true]);
    h.monitor.setDeviceOnline(false);
    vi.advanceTimersByTime(NET_RULES.bannerDelayMs - 1);
    h.monitor.setDeviceOnline(true);
    expect(h.monitor.getSnapshot().backAt).toBeNull();
  });

  it('marks the API unreachable after failures in a row, probes every 5 s, recovers on an answer', async () => {
    const h = harness([false, true]);
    h.monitor.reportNetworkError();
    expect(h.state()).toBe('online');
    h.monitor.reportNetworkError();
    expect(h.state()).toBe('unreachable');
    expect(h.probe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(NET_RULES.probeEveryMs);
    expect(h.probe).toHaveBeenCalledTimes(1);
    expect(h.state()).toBe('unreachable');
    await vi.advanceTimersByTimeAsync(NET_RULES.probeEveryMs);
    expect(h.probe).toHaveBeenCalledTimes(2);
    expect(h.state()).toBe('online');
    // No more probing once back.
    await vi.advanceTimersByTimeAsync(NET_RULES.probeEveryMs * 3);
    expect(h.probe).toHaveBeenCalledTimes(2);
  });

  it('any answer resets the failure count and beats a stale "offline" from the device', () => {
    const h = harness();
    h.monitor.reportNetworkError();
    h.monitor.reportResponse();
    h.monitor.reportNetworkError();
    expect(h.state()).toBe('online');
    h.monitor.setDeviceOnline(false);
    h.monitor.reportResponse();
    expect(h.state()).toBe('online');
  });

  it('retryNow probes at once while unreachable, never while offline', async () => {
    const h = harness([true]);
    h.monitor.reportNetworkError();
    h.monitor.reportNetworkError();
    h.monitor.retryNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state()).toBe('online');
    h.monitor.setDeviceOnline(false);
    const calls = h.probe.mock.calls.length;
    h.monitor.retryNow();
    expect(h.probe).toHaveBeenCalledTimes(calls);
  });

  it('notifies on every state change only', () => {
    const h = harness();
    h.monitor.setDeviceOnline(false);
    h.monitor.setDeviceOnline(false);
    expect(h.seen.map((s) => s.state)).toEqual(['offline']);
  });
});

describe('connection banner', () => {
  const net = (state: NetSnapshot['state'], since: number, backAt: number | null = null): NetSnapshot => ({ state, since, backAt });

  it('shows offline / unreachable only after the delay (≤ 3 s)', () => {
    expect(NET_RULES.bannerDelayMs).toBeLessThanOrEqual(3_000);
    expect(connectionBanner({ net: net('offline', 0), now: NET_RULES.bannerDelayMs - 1 })).toBeNull();
    expect(connectionBanner({ net: net('offline', 0), now: NET_RULES.bannerDelayMs })).toBe('offline');
    expect(connectionBanner({ net: net('unreachable', 0), now: 10_000 })).toBe('unreachable');
  });

  it('says "رجع النت" for a moment after an outage, then nothing', () => {
    expect(connectionBanner({ net: net('online', 10_000, 10_000), now: 11_000 })).toBe('back');
    expect(connectionBanner({ net: net('online', 10_000, 10_000), now: 10_000 + NET_RULES.backBannerMs })).toBeNull();
  });

  it('stale: live channel down and data older than the threshold; never while live', () => {
    const now = 100_000;
    const old = now - NET_RULES.staleAfterMs - 1;
    expect(connectionBanner({ net: net('online', 0), now, live: 'fallback', updatedAt: old })).toBe('stale');
    expect(connectionBanner({ net: net('online', 0), now, live: 'connecting', updatedAt: old })).toBe('stale');
    expect(connectionBanner({ net: net('online', 0), now, live: 'live', updatedAt: old })).toBeNull();
    expect(connectionBanner({ net: net('online', 0), now, live: 'fallback', updatedAt: now - 1_000 })).toBeNull();
    expect(isStale({ live: 'fallback', updatedAt: null, now })).toBe(false);
    // Offline wins over stale.
    expect(connectionBanner({ net: net('offline', 0), now, live: 'fallback', updatedAt: old })).toBe('offline');
  });

  it('counts whole seconds', () => {
    expect(secondsSince(1_000, 41_999)).toBe(40);
    expect(secondsSince(5_000, 1_000)).toBe(0);
  });
});

describe('errors and fetch', () => {
  it('tells a missing response from a server answer', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError({ message: 'x', cause: new TypeError('Network request failed') })).toBe(true);
    expect(isNetworkError({ name: 'AbortError', message: '' })).toBe(true);
    expect(isNetworkError({ message: 'Failed to fetch', data: { httpStatus: 502 } })).toBe(false);
    expect(isNetworkError(new Error('المطعم مسدود'))).toBe(false);
    expect(errorKind({ message: 'boom', data: { httpStatus: 500 } })).toBe('server');
    expect(errorKind(new TypeError('Load failed'))).toBe('network');
    expect(errorKind({ message: 'no', data: { httpStatus: 409 } })).toBe('other');
  });

  it('trackFetch reports answers and failures, but not the app aborting its own request', async () => {
    const monitor = { reportResponse: vi.fn(), reportNetworkError: vi.fn() };
    const ok = trackFetch(monitor, (async () => ({ status: 500 })) as never);
    await (ok as unknown as () => Promise<unknown>)();
    expect(monitor.reportResponse).toHaveBeenCalledTimes(1);
    const down = trackFetch(monitor, (async () => {
      throw new TypeError('Failed to fetch');
    }) as never);
    await expect((down as unknown as () => Promise<unknown>)()).rejects.toThrow('Failed to fetch');
    expect(monitor.reportNetworkError).toHaveBeenCalledTimes(1);
    const aborted = trackFetch(monitor, (async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as never);
    await expect((aborted as unknown as () => Promise<unknown>)()).rejects.toThrow();
    expect(monitor.reportNetworkError).toHaveBeenCalledTimes(1);
  });
});

type Call = (input?: unknown, init?: { signal?: AbortSignal }) => Promise<unknown>;

/** A fetch that never answers unless aborted (then it rejects like a real one). */
function stalledFetch() {
  const seen: { signal?: AbortSignal }[] = [];
  const impl = ((_input: unknown, init?: { signal?: AbortSignal }) => {
    seen.push(init ?? {});
    return new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
    });
  }) as never;
  return { impl, seen };
}

describe('request deadline (CORE-01)', () => {
  it('a stalled request fails as no response after the deadline, and its connection is aborted', async () => {
    vi.useFakeTimers();
    const { impl, seen } = stalledFetch();
    const timed = withTimeout(impl, 15_000) as unknown as Call;
    const result = timed('https://api/x', {}).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(seen[0]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const err = await result;
    expect(err).toBeInstanceOf(RequestTimeoutError);
    expect(isNetworkError(err)).toBe(true);
    expect(classifyError(err)).toMatchObject({ kind: 'network', transient: true });
    expect(seen[0]?.signal?.aborted).toBe(true);
  });

  it('settles at the deadline even when the fetch ignores the abort', async () => {
    vi.useFakeTimers();
    const deaf = withTimeout((() => new Promise(() => {})) as never, 5_000) as unknown as Call;
    const result = deaf().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toBeInstanceOf(RequestTimeoutError);
  });

  it('a timed-out request reaches the monitor as a network failure', async () => {
    vi.useFakeTimers();
    const monitor = { reportResponse: vi.fn(), reportNetworkError: vi.fn() };
    const tracked = trackFetch(monitor, withTimeout(stalledFetch().impl, 1_000)) as unknown as Call;
    const result = tracked().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    await result;
    expect(monitor.reportNetworkError).toHaveBeenCalledTimes(1);
  });

  it("the caller's own cancel still cancels, stays an AbortError and says nothing about the network", async () => {
    vi.useFakeTimers();
    const monitor = { reportResponse: vi.fn(), reportNetworkError: vi.fn() };
    const { impl, seen } = stalledFetch();
    const tracked = trackFetch(monitor, withTimeout(impl, 15_000)) as unknown as Call;
    const caller = new AbortController();
    const result = tracked('u', { signal: caller.signal }).catch((e: unknown) => e);
    caller.abort();
    const err = (await result) as Error;
    expect(err.name).toBe('AbortError');
    expect(seen[0]?.signal?.aborted).toBe(true);
    expect(monitor.reportNetworkError).not.toHaveBeenCalled();
    // No deadline left running for a request that is over.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an already-cancelled signal fails at once without sending anything', async () => {
    const { impl, seen } = stalledFetch();
    const caller = new AbortController();
    caller.abort();
    const err = (await (withTimeout(impl, 15_000) as unknown as Call)('u', { signal: caller.signal }).catch((e: unknown) => e)) as Error;
    expect(err.name).toBe('AbortError');
    expect(seen).toHaveLength(0);
  });

  it('an answer in time passes through; the body then gets one more window', async () => {
    vi.useFakeTimers();
    const seen: { signal?: AbortSignal }[] = [];
    const answer = { status: 200 };
    const timed = withTimeout(((_: unknown, init?: { signal?: AbortSignal }) => {
      seen.push(init ?? {});
      return Promise.resolve(answer);
    }) as never, 15_000) as unknown as Call;
    expect(await timed('u', {})).toBe(answer);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(seen[0]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    // A body still being read after its window is cut, so a stalled body can't hang either.
    expect(seen[0]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a failure in time passes through unchanged', async () => {
    const down = withTimeout((async () => {
      throw new TypeError('Failed to fetch');
    }) as never, 15_000) as unknown as Call;
    await expect(down()).rejects.toThrow('Failed to fetch');
  });

  it('settleWithin never rejects and stops waiting at its limit', async () => {
    vi.useFakeTimers();
    await expect(settleWithin(Promise.reject(new Error('x')), 1_000)).resolves.toBe('done');
    const slow = settleWithin(new Promise(() => {}), 4_000);
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(slow).resolves.toBe('timeout');
  });
});

describe('classifyError: can trying again help?', () => {
  const answered = (httpStatus: number, code?: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(code ?? 'x'), { data: { httpStatus, ...(code ? { code } : {}), ...extra } });

  it.each([
    ['no response', new TypeError('Network request failed'), 'network', true],
    ['timed out', new RequestTimeoutError(15_000), 'network', true],
    ['cancelled', Object.assign(new Error('x'), { name: 'AbortError' }), 'network', true],
    ['our server failed', answered(500, 'internal'), 'server', true],
    ['database down', answered(503, 'service_unavailable'), 'server', true],
    ['gateway', answered(502), 'server', true],
    ['rate limited', answered(429, 'rate_limited', { retryAfterSec: 5 }), 'busy', true],
    ['session refused', answered(401, 'token_invalid'), 'auth', false],
    ['not found', answered(404, 'not_found'), 'final', false],
    ['forbidden', answered(403, 'forbidden'), 'final', false],
    ['bad input', answered(400, 'invalid_input'), 'final', false],
    ['a rule said no', answered(409, 'store_closed'), 'final', false],
    ['a wrong code (the person may retry, not the app)', answered(400, 'otp_invalid', { retryHint: 'now' }), 'final', false],
    ['a bug', new Error('cannot read properties of undefined'), 'final', false],
  ] as const)('%s → %s', (_label, err, kind, transient) => {
    expect(classifyError(err)).toMatchObject({ kind, transient });
  });

  it('carries the code and the wait the server asked for', () => {
    expect(classifyError(answered(429, 'rate_limited', { retryAfterSec: 30 }))).toEqual({ kind: 'busy', transient: true, code: 'rate_limited', retryAfterSec: 30 });
  });
});
