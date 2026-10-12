import { Logger } from '@nestjs/common';
import type { Clock } from '../clock.js';
import { afterCommit, type UnitOfWork } from '../db/unit-of-work.js';
import { assertJobId, type JobHandler, type Queue } from '../queue.js';
import type { TimerStore } from './timer.store.js';
import type { TimerSweeper } from './timer.sweeper.js';

/** The durable copy is due this long after the Redis job, so the sweeper fires it only when that job did not run. */
export const TIMER_SWEEP_GRACE_MS = 60_000;

export interface DurableTimerOptions {
  delayMs: number;
  /** Required: the BullMQ job and its durable copy are matched by it. */
  jobId: string;
}

/**
 * A module's timers on its queue with a durable copy in `scheduled_timers` (orders, trips, خطوط).
 *
 * `schedule` writes the copy in the caller's transaction (`current()`), and enqueues the BullMQ job
 * only after that transaction commits, without waiting for it and without ever throwing: Redis being
 * down never fails or slows the request, and a job never runs before the row it reads is committed.
 * A copy still pending `TIMER_SWEEP_GRACE_MS` after its due time (the job was never enqueued, was
 * lost, or failed every attempt) is fired by the `TimerSweeper` through the same handler. Either way
 * the handler runs in a transaction that first takes the copy (`TimerStore.take`: row locked, marked
 * fired, put back on rollback), so a BullMQ retry and the sweeper firing one timer at once run it
 * once. Handlers still re-check the state they change (a timer whose copy is missing runs unguarded).
 *
 * Until `bind` (unit tests and narrow harnesses) there is no copy: the job alone, still after commit.
 */
export class DurableTimers<T> {
  private readonly logger: Logger;
  private store: TimerStore | null = null;
  private sweeper: TimerSweeper | null = null;
  private handler: JobHandler<T> | null = null;
  private registered = false;

  constructor(
    private readonly queue: Queue<T>,
    private readonly clock: Clock,
    private readonly uow: Pick<UnitOfWork, 'current' | 'run'>,
  ) {
    this.logger = new Logger(`DurableTimers(${queue.name})`);
  }

  get name(): string {
    return this.queue.name;
  }

  /** The module binds the durable store and the sweeper at start-up (either order with `process`). */
  bind(store: TimerStore, sweeper: TimerSweeper | null): void {
    this.store = store;
    this.sweeper = sweeper;
    this.register();
  }

  /** The queue's handler: run by BullMQ and by the sweeper, each time inside `run`. */
  process(handler: JobHandler<T>): void {
    this.handler = handler;
    this.queue.process((job) => this.run(job));
    this.register();
  }

  async schedule(name: string, data: T, opts: DurableTimerOptions): Promise<void> {
    assertJobId(opts.jobId);
    const dueAt = this.clock.now().getTime() + Math.max(0, opts.delayMs);
    const jobId = opts.jobId;
    const tx = this.uow.current();
    if (this.store) await this.store.schedule({ queue: this.queue.name, name, jobId: opts.jobId, data, dueAt: new Date(dueAt + TIMER_SWEEP_GRACE_MS) }, tx);
    const enqueue = async () => {
      try {
        await this.queue.add(name, data, { jobId, delayMs: Math.max(0, dueAt - this.clock.now().getTime()) });
      } catch (err) {
        this.logger.warn(`timer ${name} (${jobId}) not queued${this.store ? ', the sweeper fires it' : ''}: ${(err as Error).message}`);
      }
    };
    if (!afterCommit(tx, () => void enqueue())) void enqueue();
  }

  /** One run of a timer (its BullMQ job or the sweeper): takes its copy and runs the handler in one transaction. */
  private async run(job: { id: string; name: string; data: T }): Promise<void> {
    const handler = this.handler;
    if (!handler) return;
    const store = this.store;
    if (!store) return handler(job);
    await this.uow.run(async (tx) => {
      if ((await store.take(this.queue.name, job.id, this.clock.now(), tx)) === 'done') return;
      await handler(job);
    });
  }

  private register(): void {
    if (this.registered || !this.handler || !this.sweeper) return;
    this.sweeper.register<T>(this.queue.name, (job) => this.run(job));
    this.registered = true;
  }
}
