import { Logger } from '@nestjs/common';
import type { Clock } from '../../shared/clock.js';
import type { UnitOfWork } from '../../shared/db/unit-of-work.js';
import type { Queue } from '../../shared/queue.js';
import { runAsBackground } from '../../shared/request-context.js';
import type { EventsRepository } from './events.repository.js';
import type { OutboxRecord } from './events.types.js';
import type { SubscriberRegistry, Subscription } from './subscriber.registry.js';
import { OUTBOX_LEASE_MS, OUTBOX_MAX_ATTEMPTS, backoffMs } from './timestamps.js';

export const OUTBOX_QUEUE = 'outbox';
export const OUTBOX_TICK_JOB_ID = 'tick';
export const OUTBOX_BATCH = 200;
export const OUTBOX_TICK_MS = 500;

export type OutboxTick = Record<string, never>;

export interface DrainResult {
  claimed: number;
  published: number;
  retried: number;
  failed: number;
}

export interface OutboxPublisherOptions {
  batchSize?: number;
  tickMs?: number;
  maxAttempts?: number;
  /** How long a claim holds (`OUTBOX_LEASE_MS`); tests shorten it. */
  leaseMs?: number;
}

/**
 * Moves committed outbox rows to subscribers (plan Step 3, architecture §2).
 *
 * Queue mode (REDIS_URL set): a BullMQ worker on the `outbox` queue drains on every `tick` job; a
 * 500-ms interval and every commit that wrote events enqueue `tick` with a fixed jobId, so at most
 * one waits however many API instances poke. If Redis is down the pokes fail quietly, rows stay
 * `pending` (the Console sees them climb) and the next tick after Redis returns drains them.
 *
 * Sync mode (no Redis: tests, the dev server, the simulator): the commit that wrote events drains
 * before `UnitOfWork.run` returns, and `start()` keeps a 500-ms interval for backoff retries.
 *
 * Delivery: per row, every matching subscriber that has not committed this row yet runs in its own
 * transaction together with its delivery record. All delivered → `published`; any failure →
 * attempts+1, next attempt in 2^attempts s, `failed` with `lastError` after 10.
 */
export class OutboxPublisher {
  private readonly logger = new Logger(OutboxPublisher.name);
  private readonly batchSize: number;
  private readonly tickMs: number;
  private readonly maxAttempts: number;
  private readonly leaseMs: number;
  private draining: Promise<number> | null = null;
  private rerun = false;
  private timer: NodeJS.Timeout | undefined;
  private started = false;

  constructor(
    private readonly repo: EventsRepository,
    private readonly registry: SubscriberRegistry,
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
    private readonly queue: Queue<OutboxTick> | null = null,
    opts: OutboxPublisherOptions = {},
  ) {
    this.batchSize = opts.batchSize ?? OUTBOX_BATCH;
    this.tickMs = opts.tickMs ?? OUTBOX_TICK_MS;
    this.maxAttempts = opts.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;
    this.leaseMs = opts.leaseMs ?? OUTBOX_LEASE_MS;
  }

  get mode(): 'queue' | 'sync' {
    return this.queue ? 'queue' : 'sync';
  }

  /** Called after a commit that wrote events. Never throws. */
  async poke(): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.add('tick', {}, { jobId: OUTBOX_TICK_JOB_ID, transient: true });
      } catch (err) {
        this.logger.warn(`outbox poke not queued (rows stay pending): ${(err as Error).message}`);
      }
      return;
    }
    try {
      await this.drainUntilIdle();
    } catch (err) {
      this.logger.error(`outbox drain failed: ${(err as Error).message}`, (err as Error).stack);
    }
  }

  /** Registers the worker (queue mode) and the 500-ms tick. `interval: false` for tests driving ticks by hand. */
  start(opts: { interval?: boolean } = {}): void {
    if (this.started) return;
    this.started = true;
    if (this.queue) {
      this.queue.process(async () => {
        try {
          await this.drainUntilIdle();
        } catch (err) {
          this.logger.error(`outbox drain failed: ${(err as Error).message}`, (err as Error).stack);
        }
      });
    }
    if (opts.interval === false) return;
    this.timer = setInterval(() => void this.poke(), this.tickMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Graceful shutdown (src/shutdown.ts, docs/deploy/runbook.md): stops the interval, lets a running
   * drain finish, then drains once more until nothing is due, so the rows this instance's last
   * commits wrote are delivered before the process exits. Returns how many rows the final drain
   * claimed. Anything it cannot finish stays `pending` for the next instance (at-least-once).
   */
  async shutdown(): Promise<number> {
    this.stop();
    if (this.draining) await this.draining.catch(() => 0);
    return this.drainUntilIdle();
  }

  /**
   * Drains until nothing is due. Re-entrant calls (a subscriber's own commit poking while this
   * drain runs) return at once and the running loop picks their rows up; awaiting the running
   * drain from inside it would deadlock.
   */
  async drainUntilIdle(): Promise<number> {
    if (this.draining) {
      this.rerun = true;
      return 0;
    }
    const run = async () => {
      let total = 0;
      for (let guard = 0; guard < 10_000; guard++) {
        this.rerun = false;
        const r = await this.drainOnce();
        total += r.claimed;
        if (r.claimed === 0 && !this.rerun) break;
      }
      return total;
    };
    this.draining = run();
    try {
      return await this.draining;
    } finally {
      this.draining = null;
    }
  }

  /**
   * One batch: claims up to `limit` due rows (a short committed claim, `claimDue`) and delivers them in
   * order. Once half the lease has passed it starts no new row and hands the rest back (due now), so it
   * never delivers a row another drain may already have reclaimed.
   */
  async drainOnce(limit = this.batchSize): Promise<DrainResult> {
    const now = this.clock.now();
    const started = Date.now();
    // Background work even when a request's commit poked it: the batch gets the job time limits.
    return runAsBackground('outbox-drain', () =>
      this.repo.claimDue(
        now,
        limit,
        async (rows) => {
          const result: DrainResult = { claimed: rows.length, published: 0, retried: 0, failed: 0 };
          for (const [i, row] of rows.entries()) {
            if (Date.now() - started >= this.leaseMs / 2) {
              for (const rest of rows.slice(i)) await this.repo.updateOutbox(rest.id, { nextAttemptAt: this.clock.now() });
              this.logger.warn(`outbox batch handed back ${rows.length - i} of ${rows.length} rows: half the lease used`);
              break;
            }
            // Log lines of this row's subscribers carry `outbox-<rowId>` (the e2e job maps it to its subjects).
            const outcome = await runAsBackground(`outbox-${row.id}`, () => this.deliverRow(row, now));
            result[outcome] += 1;
          }
          return result;
        },
        this.leaseMs,
      ),
    );
  }

  private async deliverRow(row: OutboxRecord, now: Date): Promise<'published' | 'retried' | 'failed'> {
    const event = { ...row.event, outboxId: row.id };
    const done = await this.repo.deliveredTo(row.id);
    const errors: string[] = [];
    for (const sub of this.registry.matching(event)) {
      if (done.has(sub.name)) continue;
      try {
        await this.deliverTo(sub, row);
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        errors.push(`${sub.name}: ${msg}`);
        this.logger.warn(`subscriber ${sub.name} failed on ${row.type} ${row.id} (attempt ${row.attempts + 1}): ${msg}`);
        await this.repo.recordDeliveryFailure(row.id, sub.name, msg);
      }
    }
    if (errors.length === 0) {
      await this.repo.updateOutbox(row.id, { status: 'published', publishedAt: now, lastError: null });
      return 'published';
    }
    const attempts = row.attempts + 1;
    const lastError = errors.join('; ').slice(0, 2000);
    if (attempts >= this.maxAttempts) {
      await this.repo.updateOutbox(row.id, { status: 'failed', attempts, lastError });
      this.logger.error(`outbox row ${row.id} (${row.type}) failed after ${attempts} attempts: ${lastError}`);
      return 'failed';
    }
    await this.repo.updateOutbox(row.id, { attempts, lastError, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) });
    return 'retried';
  }

  /** The handler and its delivery record commit together: a redelivery after success is skipped. */
  private async deliverTo(sub: Subscription, row: OutboxRecord): Promise<void> {
    await this.uow.run(async (tx) => {
      // A row two drains hold (one's lease ran out) still runs this handler once: the second waits here.
      await this.repo.lockDelivery(row.id, sub.name, tx);
      if ((await this.repo.deliveredTo(row.id, tx)).has(sub.name)) return;
      await sub.handler({ ...row.event, outboxId: row.id }, { tx, subscriber: sub.name });
      await this.repo.markDelivered(row.id, sub.name, this.clock.now(), tx);
    });
  }
}
