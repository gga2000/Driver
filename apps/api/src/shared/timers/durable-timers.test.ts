import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../clock.js';
import { NoDatabaseRunner, UnitOfWork } from '../db/unit-of-work.js';
import { BullMqQueueFactory, InMemoryQueue } from '../queue.js';
import { DurableTimers, TIMER_SWEEP_GRACE_MS } from './durable-timers.js';
import { InMemoryTimerStore } from './timer.store.memory.js';
import { TimerSweeper } from './timer.sweeper.js';

interface Job {
  id: string;
}

function setup() {
  const clock = new FakeClock('2026-10-11T09:00:00Z');
  const uow = new UnitOfWork(new NoDatabaseRunner());
  const queue = new InMemoryQueue<Job>('orders.timers', () => clock.now());
  const store = new InMemoryTimerStore();
  const sweeper = new TimerSweeper(store, clock, 'all', { enabled: false, intervalMs: 5_000, batch: 50, leaseMs: 60_000 });
  const timers = new DurableTimers(queue, clock, () => uow.current());
  const ran: string[] = [];
  timers.process(async (job) => {
    ran.push(`${job.name}:${job.data.id}`);
  });
  timers.bind(store, sweeper);
  return { clock, uow, queue, store, sweeper, timers, ran };
}

describe('DurableTimers (FLW-22)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes the durable copy in the transaction and queues the job only after it commits', async () => {
    const { uow, queue, store, timers } = setup();
    let queuedInside = -1;
    await uow.run(async () => {
      await timers.schedule('t', { id: 'o1' }, { delayMs: 90_000, jobId: 'order.o1.t' });
      queuedInside = queue.size;
      expect(store.rows).toHaveLength(1);
    });
    expect(queuedInside).toBe(0);
    expect(queue.size).toBe(1);
    expect(store.rows[0]).toMatchObject({ queue: 'orders.timers', name: 't', jobId: 'order.o1.t', status: 'pending' });
  });

  it('queues nothing when the transaction rolls back', async () => {
    const { uow, queue, timers } = setup();
    await expect(
      uow.run(async () => {
        await timers.schedule('t', { id: 'o1' }, { delayMs: 90_000, jobId: 'order.o1.t' });
        throw new Error('placing failed');
      }),
    ).rejects.toThrow('placing failed');
    expect(queue.size).toBe(0);
  });

  it('a job that ran marks its copy fired: the sweeper never runs it again', async () => {
    const { clock, uow, queue, store, sweeper, timers, ran } = setup();
    await uow.run(() => timers.schedule('t', { id: 'o1' }, { delayMs: 90_000, jobId: 'order.o1.t' }));
    clock.advance(90_000);
    expect(await queue.drain()).toBe(1);
    expect(store.rows[0]!.status).toBe('fired');
    clock.advance(TIMER_SWEEP_GRACE_MS);
    expect((await sweeper.sweep()).fired).toBe(0);
    expect(ran).toEqual(['t:o1']);
  });

  it('a lost job is fired by the sweeper once its grace is over, through the same handler', async () => {
    const { clock, uow, queue, sweeper, timers, ran } = setup();
    await uow.run(() => timers.schedule('t', { id: 'o1' }, { delayMs: 90_000, jobId: 'order.o1.t' }));
    await queue.close(); // Redis lost the job
    clock.advance(90_000 + TIMER_SWEEP_GRACE_MS - 1_000);
    expect((await sweeper.sweep()).fired).toBe(0);
    clock.advance(1_000);
    expect((await sweeper.sweep()).fired).toBe(1);
    expect(ran).toEqual(['t:o1']);
  });

  it('an enqueue that fails after commit is logged, never thrown; the sweeper fires the timer', async () => {
    const { clock, uow, queue, sweeper, timers, ran } = setup();
    vi.spyOn(queue, 'add').mockRejectedValue(new Error("Stream isn't writeable and enableOfflineQueue options is false"));
    await expect(uow.run(async () => timers.schedule('t', { id: 'o1' }, { delayMs: 1_000, jobId: 'order.o1.t' }))).resolves.toBeUndefined();
    clock.advance(1_000 + TIMER_SWEEP_GRACE_MS);
    expect((await sweeper.sweep()).fired).toBe(1);
    expect(ran).toEqual(['t:o1']);
  });

  it('a job whose copy could not be marked fired still succeeds (the sweeper re-runs it, harmlessly)', async () => {
    const { clock, uow, queue, store, sweeper, timers, ran } = setup();
    await uow.run(() => timers.schedule('t', { id: 'o1' }, { delayMs: 1_000, jobId: 'order.o1.t' }));
    vi.spyOn(store, 'markFired').mockRejectedValueOnce(new Error('database timeout'));
    clock.advance(1_000);
    expect(await queue.drain()).toBe(1);
    clock.advance(TIMER_SWEEP_GRACE_MS);
    expect((await sweeper.sweep()).fired).toBe(1);
    expect(ran).toEqual(['t:o1', 't:o1']);
  });

  it('registers with the sweeper whichever comes first, bind or process', async () => {
    const clock = new FakeClock();
    const store = new InMemoryTimerStore();
    const sweeper = new TimerSweeper(store, clock, 'all', { enabled: false, intervalMs: 5_000, batch: 50, leaseMs: 60_000 });
    const timers = new DurableTimers(new InMemoryQueue<Job>('trips.timers', () => clock.now()), clock, () => undefined);
    timers.bind(store, sweeper);
    const ran: string[] = [];
    timers.process(async (job) => void ran.push(job.data.id));
    await store.schedule({ queue: 'trips.timers', name: 't', jobId: 'j', data: { id: 'x' }, dueAt: clock.now() });
    await sweeper.sweep();
    expect(ran).toEqual(['x']);
  });

  it('refuses a job id BullMQ would refuse, before writing anything', async () => {
    const { store, timers } = setup();
    await expect(timers.schedule('t', { id: 'o1' }, { delayMs: 0, jobId: 'order:o1' })).rejects.toThrow(/cannot contain :/);
    expect(store.rows).toHaveLength(0);
  });

  it('with Redis unreachable, the transaction still commits at once and the copy waits for the sweeper', async () => {
    const clock = new FakeClock();
    const uow = new UnitOfWork(new NoDatabaseRunner());
    const factory = new BullMqQueueFactory('redis://127.0.0.1:1', 'durable-test');
    const store = new InMemoryTimerStore();
    const timers = new DurableTimers(factory.queue<Job>('orders.timers'), clock, () => uow.current());
    timers.bind(store, null);
    const started = Date.now();
    try {
      await uow.run(() => timers.schedule('t', { id: 'o1' }, { delayMs: 90_000, jobId: 'order.o1.t' }));
      expect(Date.now() - started).toBeLessThan(1_000);
      expect(store.rows[0]).toMatchObject({ jobId: 'order.o1.t', status: 'pending' });
    } finally {
      await factory.onModuleDestroy().catch(() => undefined);
    }
  });
});
