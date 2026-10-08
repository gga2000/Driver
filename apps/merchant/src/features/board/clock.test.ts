import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverClock } from './clock';

describe('serverClock (h3: one shared clock)', () => {
  afterEach(() => {
    serverClock.setOffset(0);
    vi.useRealTimers();
  });

  it('adds the board offset to device time', () => {
    vi.useFakeTimers({ now: 1_000_000 });
    serverClock.setOffset(5_000);
    expect(serverClock.now()).toBe(1_005_000);
  });

  it('runs one 1-s timer for every listener, and stops it when the last one leaves', () => {
    vi.useFakeTimers({ now: 0 });
    const a = vi.fn();
    const b = vi.fn();
    const stopA = serverClock.subscribe(a);
    const stopB = serverClock.subscribe(b);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(3_000);
    expect(a).toHaveBeenCalledTimes(3);
    expect(b).toHaveBeenCalledTimes(3);
    stopA();
    stopB();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tells listeners at once when the offset changes', () => {
    vi.useFakeTimers({ now: 0 });
    const a = vi.fn();
    const stop = serverClock.subscribe(a);
    serverClock.setOffset(2_000);
    serverClock.setOffset(2_000);
    expect(a).toHaveBeenCalledTimes(1);
    stop();
  });
});
