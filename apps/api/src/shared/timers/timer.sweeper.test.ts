import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../clock.js';
import { InMemoryTimerStore } from './timer.store.memory.js';
import { retryDelayMs, timerSweeperOptionsFromEnv, TimerSweeper, type TimerSweeperOptions } from './timer.sweeper.js';

const ON: TimerSweeperOptions = { enabled: true, intervalMs: 5_000, batch: 2, leaseMs: 60_000 };

function setup(opts: Partial<TimerSweeperOptions> = {}) {
  const clock = new FakeClock('2026-10-08T09:00:00Z');
  const store = new InMemoryTimerStore();
  const sweeper = new TimerSweeper(store, clock, 'all', { ...ON, ...opts });
  const ran: Array<{ id: string; name: string; data: unknown }> = [];
  sweeper.register('orders.timers', async (job) => {
    ran.push(job);
  });
  const at = (ms: number) => new Date(clock.now().getTime() + ms);
  return { clock, store, sweeper, ran, at };
}

describe('TimerSweeper', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fires a timer once it is due, through the queue handler, and only once', async () => {
    const { clock, store, sweeper, ran, at } = setup();
    await store.schedule({ queue: 'orders.timers', name: 'order.autoReject', jobId: 'order.o1.autoReject', data: { orderId: 'o1' }, dueAt: at(30_000) });
    expect(await sweeper.sweep()).toEqual({ fired: 0, retried: 0, failed: 0 });
    clock.advanceSeconds(30);
    expect(await sweeper.sweep()).toEqual({ fired: 1, retried: 0, failed: 0 });
    expect(ran).toEqual([{ id: 'order.o1.autoReject', name: 'order.autoReject', data: { orderId: 'o1' } }]);
    clock.advanceSeconds(60);
    await sweeper.sweep();
    expect(ran).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: 'fired', attempts: 1 });
  });

  it('works through more due timers than one batch, oldest first', async () => {
    const { clock, store, sweeper, ran, at } = setup({ batch: 2 });
    for (const [i, delay] of [3, 1, 2, 5, 4].entries()) {
      await store.schedule({ queue: 'orders.timers', name: 't', jobId: `j${i}`, data: delay, dueAt: at(delay * 1000) });
    }
    clock.advanceSeconds(10);
    expect((await sweeper.sweep()).fired).toBe(5);
    expect(ran.map((r) => r.data)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps the first schedule of a pending job id, and re-arms one that already fired', async () => {
    const { clock, store, at } = setup();
    expect(await store.schedule({ queue: 'orders.timers', name: 't', jobId: 'same', data: 1, dueAt: at(1_000) })).toBe(true);
    expect(await store.schedule({ queue: 'orders.timers', name: 't', jobId: 'same', data: 2, dueAt: at(9_000) })).toBe(false);
    expect(store.rows).toHaveLength(1);
    await store.markFired('orders.timers', 'same', clock.now());
    expect(await store.schedule({ queue: 'orders.timers', name: 't', jobId: 'same', data: 3, dueAt: at(5_000) })).toBe(true);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: 'pending', data: 3, attempts: 0, firedAt: null });
  });

  it('never runs a timer BullMQ already fired', async () => {
    const { clock, store, sweeper, ran, at } = setup();
    await store.schedule({ queue: 'orders.timers', name: 't', jobId: 'j', data: null, dueAt: at(1_000) });
    await store.markFired('orders.timers', 'j', clock.now());
    clock.advanceSeconds(5);
    await sweeper.sweep();
    expect(ran).toEqual([]);
  });

  it('retries a failing handler with backoff (SCALE-09), then gives up and says so', async () => {
    const clock = new FakeClock('2026-10-08T09:00:00Z');
    const store = new InMemoryTimerStore();
    const sweeper = new TimerSweeper(store, clock, 'all', ON);
    let calls = 0;
    sweeper.register('dispatch', async () => {
      calls += 1;
      throw new Error('database busy');
    });
    const error = vi.spyOn((sweeper as unknown as { logger: { error: (m: string) => void } }).logger, 'error').mockImplementation(() => undefined);
    vi.spyOn((sweeper as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
    await store.schedule({ queue: 'dispatch', name: 'offer.timeout', jobId: 'offer.1', data: {}, dueAt: clock.now(), maxAttempts: 3 });

    expect(await sweeper.sweep()).toEqual({ fired: 0, retried: 1, failed: 0 });
    clock.advance(retryDelayMs(1) - 1);
    await sweeper.sweep();
    expect(calls).toBe(1);
    clock.advance(1);
    expect(await sweeper.sweep()).toEqual({ fired: 0, retried: 1, failed: 0 });
    clock.advance(retryDelayMs(2));
    expect(await sweeper.sweep()).toEqual({ fired: 0, retried: 0, failed: 1 });
    expect(calls).toBe(3);
    expect(store.rows[0]).toMatchObject({ status: 'failed', lastError: 'database busy' });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('failed for good after 3 attempts'));
    expect((await store.stats(clock.now())).failed).toBe(1);
  });

  it('gives a crashed worker\'s claim back once its lease ends', async () => {
    const { clock, store, sweeper, ran, at } = setup();
    await store.schedule({ queue: 'orders.timers', name: 't', jobId: 'j', data: null, dueAt: at(0) });
    // Another process claimed it and died before finishing.
    expect(await store.claimDue({ now: clock.now(), queues: ['orders.timers'], limit: 10, leaseMs: 60_000, worker: 'dead' })).toHaveLength(1);
    await sweeper.sweep();
    expect(ran).toEqual([]);
    clock.advanceSeconds(60);
    await sweeper.sweep();
    expect(ran).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: 'fired', attempts: 2 });
  });

  it('claims only the queues it has handlers for', async () => {
    const { clock, store, sweeper, at } = setup();
    await store.schedule({ queue: 'khat.timers', name: 't', jobId: 'k', data: null, dueAt: at(0) });
    clock.advanceSeconds(1);
    await sweeper.sweep();
    expect(store.rows[0]).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('reports pending, overdue and how late the oldest is', async () => {
    const { clock, store, at } = setup();
    await store.schedule({ queue: 'orders.timers', name: 't', jobId: 'a', data: null, dueAt: at(1_000) });
    await store.schedule({ queue: 'orders.timers', name: 't', jobId: 'b', data: null, dueAt: at(60_000) });
    clock.advanceSeconds(11);
    expect(await store.stats(clock.now())).toEqual({ pending: 2, overdue: 1, oldestOverdueMs: 10_000, failed: 0 });
  });

  it('prunes fired timers after 7 days', async () => {
    const { clock, store, sweeper, at } = setup();
    await store.schedule({ queue: 'orders.timers', name: 't', jobId: 'a', data: null, dueAt: at(0) });
    await sweeper.sweep();
    clock.advance(7 * 86_400_000 + 1);
    expect(await store.prune(clock.now())).toBe(1);
    expect(store.rows).toEqual([]);
  });

  it('starts only when switched on, and never on a web machine', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const store = new InMemoryTimerStore();
    const clock = new FakeClock();
    new TimerSweeper(store, clock, 'all', { ...ON, enabled: false }).onApplicationBootstrap();
    new TimerSweeper(store, clock, 'web', ON).onApplicationBootstrap();
    expect(spy).not.toHaveBeenCalled();
    const worker = new TimerSweeper(store, clock, 'worker', ON);
    vi.spyOn((worker as unknown as { logger: { log: (m: string) => void } }).logger, 'log').mockImplementation(() => undefined);
    worker.onApplicationBootstrap();
    expect(worker.active).toBe(true);
    void worker.onModuleDestroy();
  });

  it('refuses two handlers for one queue', () => {
    const { sweeper } = setup();
    expect(() => sweeper.register('orders.timers', async () => undefined)).toThrow(/already has a handler/);
  });
});

describe('timer sweeper settings', () => {
  it('is off unless TIMERS_SWEEPER=on', () => {
    expect(timerSweeperOptionsFromEnv({})).toEqual({ enabled: false, intervalMs: 5_000, batch: 50, leaseMs: 60_000 });
    expect(timerSweeperOptionsFromEnv({ TIMERS_SWEEPER: 'ON', TIMERS_SWEEP_MS: '1000' })).toMatchObject({ enabled: true, intervalMs: 1_000 });
    expect(timerSweeperOptionsFromEnv({ TIMERS_SWEEPER: 'off', TIMERS_SWEEP_MS: 'x' })).toMatchObject({ enabled: false, intervalMs: 5_000 });
  });

  it('backs off 5 s, 10 s, 20 s… up to 5 minutes', () => {
    expect([1, 2, 3, 4, 7, 20].map(retryDelayMs)).toEqual([5_000, 10_000, 20_000, 40_000, 300_000, 300_000]);
  });
});
