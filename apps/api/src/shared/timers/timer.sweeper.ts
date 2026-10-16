import { hostname } from 'node:os';
import { Inject, Injectable, Logger, Optional, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { CLOCK, type Clock } from '../clock.js';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../process-role.js';
import type { JobHandler } from '../queue.js';
import { TIMER_STORE, type TimerStore } from './timer.store.js';

export interface TimerSweeperOptions {
  /** `TIMERS_SWEEPER=on` (default off: BullMQ alone fires timers, today's behaviour; plan 7.6). */
  enabled: boolean;
  /** How often a sweep runs. Default 5 s: Redis loss delays a timer by at most this much. */
  intervalMs: number;
  /** Timers claimed per round; a sweep keeps claiming rounds until nothing is due (bounded). */
  batch: number;
  /** How long a claim holds before another sweeper may take the timer (a crashed or stuck worker). */
  leaseMs: number;
}

const ROUNDS_PER_SWEEP = 20;
const PRUNE_EVERY_MS = 3_600_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

export function timerSweeperOptionsFromEnv(env: Record<string, string | undefined> = process.env): TimerSweeperOptions {
  const int = (key: string, fallback: number) => (Number(env[key]) > 0 ? Math.floor(Number(env[key])) : fallback);
  return {
    enabled: (env['TIMERS_SWEEPER'] ?? 'off').trim().toLowerCase() === 'on',
    intervalMs: int('TIMERS_SWEEP_MS', 5_000),
    batch: int('TIMERS_SWEEP_BATCH', 50),
    leaseMs: int('TIMERS_LEASE_MS', 60_000),
  };
}

/** SCALE-09: a failed timer is retried 5 s, 10 s, 20 s… later (at most 5 min), up to its max attempts. */
export function retryDelayMs(attempts: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

export interface SweepResult {
  fired: number;
  retried: number;
  failed: number;
}

/**
 * Fires due timers from `public.scheduled_timers` (plan W4 `redis_as_single_source_of_timers`).
 *
 * Each queue registers the same handler it gives BullMQ. A sweep claims due timers of those queues
 * with a lease (SKIP LOCKED: any number of workers, each timer to one), runs the handler, and marks the
 * timer fired, or due again with backoff, or failed for good after `maxAttempts` (logged as an error,
 * counted in `stats().failed` for the alerts). BullMQ and the sweeper may both fire a timer, so every
 * handler must be idempotent on the state it changes; that is already the rule for BullMQ retries.
 *
 * Runs only where jobs run (DRIVER_ROLE all or worker) and only with `TIMERS_SWEEPER=on`.
 */
@Injectable()
export class TimerSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TimerSweeper.name);
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<SweepResult> | undefined;
  private lastPrune = 0;
  private readonly worker = `${hostname()}:${process.pid}`;

  constructor(
    @Inject(TIMER_STORE) private readonly store: TimerStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
    @Optional() private readonly opts: TimerSweeperOptions = timerSweeperOptionsFromEnv(),
  ) {}

  /** The handler for a queue's timers; the queue's BullMQ handler, so both paths run the same code. */
  register<T>(queue: string, handler: JobHandler<T>): void {
    if (this.handlers.has(queue)) throw new Error(`timer queue ${queue} already has a handler`);
    this.handlers.set(queue, handler as JobHandler<unknown>);
  }

  get active(): boolean {
    return this.timer !== undefined;
  }

  onApplicationBootstrap(): void {
    if (!this.opts.enabled || !runsJobs(this.role)) return;
    this.timer = setInterval(() => void this.sweep(), this.opts.intervalMs);
    this.timer.unref();
    this.logger.log(`timer sweeper on: every ${this.opts.intervalMs} ms, queues ${[...this.handlers.keys()].join(', ') || '(none yet)'}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running?.catch(() => undefined);
  }

  /** One sweep (never two at once in a process; never throws). */
  sweep(): Promise<SweepResult> {
    this.running ??= this.sweepOnce().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async sweepOnce(): Promise<SweepResult> {
    const result: SweepResult = { fired: 0, retried: 0, failed: 0 };
    const queues = [...this.handlers.keys()];
    if (queues.length === 0) return result;
    try {
      for (let round = 0; round < ROUNDS_PER_SWEEP; round++) {
        const claimed = await this.store.claimDue({ now: this.clock.now(), queues, limit: this.opts.batch, leaseMs: this.opts.leaseMs, worker: this.worker });
        for (const t of claimed) {
          const handler = this.handlers.get(t.queue);
          if (!handler) continue;
          try {
            await handler({ id: t.jobId ?? t.id, name: t.name, data: t.data });
            await this.store.complete(t.id, this.clock.now());
            result.fired += 1;
          } catch (err) {
            const message = (err as Error)?.message ?? String(err);
            if (t.attempts >= t.maxAttempts) {
              await this.store.fail(t.id, message, null);
              result.failed += 1;
              this.logger.error(`timer ${t.queue}/${t.name} (${t.jobId ?? t.id}) failed for good after ${t.attempts} attempts: ${message}`);
            } else {
              await this.store.fail(t.id, message, new Date(this.clock.now().getTime() + retryDelayMs(t.attempts)));
              result.retried += 1;
              this.logger.warn(`timer ${t.queue}/${t.name} (${t.jobId ?? t.id}) attempt ${t.attempts} failed, retrying: ${message}`);
            }
          }
        }
        if (claimed.length < this.opts.batch) break;
      }
      const now = this.clock.now().getTime();
      if (now - this.lastPrune >= PRUNE_EVERY_MS) {
        this.lastPrune = now;
        await this.store.prune(this.clock.now());
      }
    } catch (err) {
      // Database unreachable: timers wait in the table and the next sweep picks them up.
      this.logger.warn(`timer sweep skipped: ${(err as Error).message}`);
    }
    return result;
  }
}
