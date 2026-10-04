import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  connectionBanner,
  createNetworkMonitor,
  errorKind,
  isNetworkError,
  isStale,
  NET_RULES,
  secondsSince,
  trackFetch,
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
