import { Logger } from '@nestjs/common';
import type { Clock } from '../clock.js';
import { afterCommit, type Tx } from '../db/unit-of-work.js';
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
 * The job's handler marks the copy fired; a copy still pending `TIMER_SWEEP_GRACE_MS` after its due
 * time (the job was never enqueued, was lost, or failed every attempt) is fired by the `TimerSweeper`
 * through the same handler. So a timer may run twice: every handler re-checks the state it changes.
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
    private readonly current: () => Tx | undefined,
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

  /** The queue's handler: run by BullMQ (then the copy is marked fired) and by the sweeper. */
  process(handler: JobHandler<T>): void {
    this.handler = handler;
    this.queue.process(async (job) => {
      await handler(job);
      await this.markFired(job.id);
    });
    this.register();
  }

  async schedule(name: string, data: T, opts: DurableTimerOptions): Promise<void> {
    assertJobId(opts.jobId);
    const dueAt = this.clock.now().getTime() + Math.max(0, opts.delayMs);
    const tx = this.current();
    if (this.store) await this.store.schedule({ queue: this.queue.name, name, jobId: opts.jobId, data, dueAt: new Date(dueAt + TIMER_SWEEP_GRACE_MS) }, tx);
    const enqueue = async () => {
      try {
        await this.queue.add(name, data, { jobId: opts.jobId, delayMs: Math.max(0, dueAt - this.clock.now().getTime()) });
      } catch (err) {
        this.logger.warn(`timer ${name} (${opts.jobId}) not queued${this.store ? ', the sweeper fires it' : ''}: ${(err as Error).message}`);
      }
    };
    if (!afterCommit(tx, () => void enqueue())) void enqueue();
  }

  private register(): void {
    if (this.registered || !this.handler || !this.sweeper) return;
    this.sweeper.register(this.queue.name, this.handler);
    this.registered = true;
  }

  private async markFired(jobId: string): Promise<void> {
    if (!this.store) return;
    try {
      await this.store.markFired(this.queue.name, jobId, this.clock.now());
    } catch (err) {
      // The job ran; its copy will run once more through the sweeper, which changes nothing.
      this.logger.warn(`timer ${jobId} ran but its durable copy was not marked fired: ${(err as Error).message}`);
    }
  }
}
