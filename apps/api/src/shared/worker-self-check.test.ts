import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerSelfCheck, workerSelfCheckOptionsFromEnv, type StallProbe } from './worker-self-check.js';

const T0 = 1_800_000_000_000;
const MIN = 60_000;

function probe(name: string, lateMs: number | Error, lastProgressAt: number): StallProbe {
  return { name, oldestOverdueMs: async () => (lateMs instanceof Error ? Promise.reject(lateMs) : lateMs), lastProgressAt: () => lastProgressAt };
}

function setup(heartbeatUrl?: string) {
  const exit = vi.fn();
  const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => new Response('ok'));
  const opts = { enabled: true, ...workerSelfCheckOptionsFromEnv({}), ...(heartbeatUrl ? { heartbeatUrl } : {}) };
  const check = new WorkerSelfCheck('worker', opts, exit, fetchFn as unknown as typeof fetch);
  return { check, exit, fetchFn };
}

describe('worker self-check', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('work overdue 2 min while nothing finished for 2 min: one error, then the process exits', async () => {
    const { check, exit } = setup();
    check.watch(probe('jobs', 0, T0));
    check.watch(probe('outbox', 3 * MIN, T0 - 2 * MIN));
    expect(await check.check(T0)).toBe('outbox stuck: oldest due item 180 s late, nothing finished for 120 s');
    expect(await check.check(T0 + 30_000)).not.toBeNull();
    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('a backlog that is still moving, or a short pause, is not stuck', async () => {
    const { check, exit } = setup();
    check.watch(probe('outbox', 10 * MIN, T0 - 5_000)); // 10 min of rows, a batch finished 5 s ago
    check.watch(probe('jobs', 90_000, T0 - 10 * MIN)); // idle for a while, a job 90 s late
    expect(await check.check(T0)).toBeNull();
    vi.advanceTimersByTime(5_000);
    expect(exit).not.toHaveBeenCalled();
  });

  it('a probe that cannot answer (Redis away) is not a stuck worker, and no heartbeat goes out', async () => {
    const { check, exit, fetchFn } = setup('https://beats.example/w');
    check.watch(probe('jobs', new Error("Stream isn't writeable"), T0 - 10 * MIN));
    expect(await check.check(T0)).toBeNull();
    vi.advanceTimersByTime(5_000);
    expect(exit).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('while healthy it pings the heartbeat about once a minute', async () => {
    const { check, fetchFn } = setup('https://beats.example/w');
    check.watch(probe('jobs', 0, T0));
    for (let t = 0; t <= 3 * MIN; t += 30_000) await check.check(T0 + t);
    expect(fetchFn).toHaveBeenCalledTimes(4); // 0, 60, 120, 180 s
    expect(fetchFn.mock.calls[0]![0]).toBe('https://beats.example/w');
  });

  it('starts only on job machines with the check enabled', () => {
    const web = new WorkerSelfCheck('web', { enabled: true, ...workerSelfCheckOptionsFromEnv({}) }, vi.fn());
    const off = new WorkerSelfCheck('worker', { enabled: false, ...workerSelfCheckOptionsFromEnv({}) }, vi.fn());
    const on = new WorkerSelfCheck('worker', { enabled: true, ...workerSelfCheckOptionsFromEnv({}) }, vi.fn());
    for (const c of [web, off, on]) c.onApplicationBootstrap();
    expect(vi.getTimerCount()).toBe(1);
    for (const c of [web, off, on]) c.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reads WORKER_HEARTBEAT_URL', () => {
    expect(workerSelfCheckOptionsFromEnv({ WORKER_HEARTBEAT_URL: ' https://beats.example/w ' }).heartbeatUrl).toBe('https://beats.example/w');
    expect(workerSelfCheckOptionsFromEnv({}).heartbeatUrl).toBeUndefined();
  });
});
