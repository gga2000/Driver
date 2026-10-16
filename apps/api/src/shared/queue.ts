import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue as BullQueue, Worker as BullWorker, type Job, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { runsJobs, type ProcessRole } from './process-role.js';
import { runAsBackground } from './request-context.js';

export type RedisStatus = 'ok' | 'unavailable';

export interface EnqueueOptions {
  /** Milliseconds to wait before the job becomes available (timers: offer waves, auto-reject…). */
  delayMs?: number;
  /** Stable id: enqueueing the same id twice is a no-op (idempotent pokes and timers). */
  jobId?: string;
  /** Default 3 (`DEFAULT_JOB_ATTEMPTS`): handlers re-check the state they change, so a retry is safe. */
  attempts?: number;
  /** First retry delay, doubling after it. Default 2 s. */
  backoffMs?: number;
  /**
   * Forget the job (and its `jobId`) as soon as it finishes, completed or failed, so the same id
   * can be enqueued again. For pokes such as the outbox `tick`: one waiting at a time, never
   * suppressed by a finished one.
   */
  transient?: boolean;
}

export type JobHandler<T> = (job: { id: string; name: string; data: T }) => Promise<void>;

/**
 * The queue abstraction every module uses for timers and background work. The BullMQ
 * implementation is bound when REDIS_URL is set; `InMemoryQueue` runs the same contract
 * in process for tests and the simulator (jobs run when `drain()` is called or when the
 * fake clock says their delay has elapsed).
 */
export interface Queue<T = unknown> {
  readonly name: string;
  add(name: string, data: T, opts?: EnqueueOptions): Promise<void>;
  process(handler: JobHandler<T>): void;
  close(): Promise<void>;
}

export interface QueueFactory {
  queue<T>(name: string): Queue<T>;
}

export const QUEUE_FACTORY = Symbol('QUEUE_FACTORY');

/** A job that throws runs again (after 2 s, then 4 s) before it lands in the failed set and the error log. */
export const DEFAULT_JOB_ATTEMPTS = 3;
export const DEFAULT_JOB_BACKOFF_MS = 2_000;

/** At most one line per this long for Redis connection errors, however many queues see them. */
const REDIS_ERROR_LOG_MS = 10_000;

/**
 * BullMQ refuses custom job ids that contain ':' ("Custom Id cannot contain :", it reserves the
 * colon for its own Redis keys). Both queue implementations enforce it, so a bad id fails in a unit
 * test instead of silently never scheduling in production. Build ids with `jobKey`.
 */
export function assertJobId(jobId: string): void {
  if (jobId.includes(':')) throw new Error(`Custom Id cannot contain : (${jobId})`);
}

/** A BullMQ-safe job id from its parts, joined with '.' (`jobKey('order', id, 'autoClose')`). */
export function jobKey(...parts: ReadonlyArray<string | number>): string {
  return parts.join('.');
}

// ───────────────────────── BullMQ ─────────────────────────

/** What a queue's worker gets from its factory: its own connection, and where it reports. */
interface WorkerHost {
  workerConnection(): Redis;
  jobFinished(queue: string, job: Job | undefined, err?: Error): void;
  redisError(source: string, err: Error): void;
}

class BullMqQueue<T> implements Queue<T> {
  private readonly queue: BullQueue<T>;

  private worker: BullWorker<T> | undefined;

  constructor(
    readonly name: string,
    connection: Redis,
    private readonly prefix: string,
    private readonly role: ProcessRole,
    private readonly host: WorkerHost,
  ) {
    this.queue = new BullQueue<T>(name, { connection, prefix });
  }

  /** The oldest job here that should have started by now: how late it is in ms (0 when none). */
  async oldestOverdueMs(now: number): Promise<number> {
    const [waiting, delayed] = await Promise.all([this.queue.getJobs(['wait'], 0, 0, true), this.queue.getJobs(['delayed'], 0, 0, true)]);
    let late = 0;
    for (const job of [...waiting, ...delayed]) {
      // A retried job keeps its first timestamp; its backoff counts from the attempt that failed.
      const due = Math.max(job.timestamp, job.processedOn ?? 0) + (job.delay ?? 0);
      late = Math.max(late, now - due);
    }
    return late;
  }

  async add(name: string, data: T, opts: EnqueueOptions = {}): Promise<void> {
    if (opts.jobId !== undefined) assertJobId(opts.jobId);
    const jobOpts: JobsOptions = {
      removeOnComplete: opts.transient ? true : 1000,
      removeOnFail: opts.transient ? true : 5000,
      attempts: opts.attempts ?? DEFAULT_JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: opts.backoffMs ?? DEFAULT_JOB_BACKOFF_MS },
      ...(opts.delayMs !== undefined ? { delay: opts.delayMs } : {}),
      ...(opts.jobId !== undefined ? { jobId: opts.jobId } : {}),
    };
    await this.queue.add(name as never, data as never, jobOpts);
  }

  /** Attaches the worker. In a `web` process (DRIVER_ROLE) this is a no-op: the `worker` machines run the jobs. */
  process(handler: JobHandler<T>): void {
    if (this.worker) throw new Error(`queue ${this.name} already has a processor`);
    if (!runsJobs(this.role)) return;
    const worker = new BullWorker<T>(
      this.name,
      // Log lines of the job carry `job-<queue>-<name>-<id>` (ids name their subject: `jobKey('order', id, …)`).
      async (job) => runAsBackground(`job-${this.name}-${job.name}-${String(job.id ?? '')}`, () => handler({ id: String(job.id ?? ''), name: job.name, data: job.data })),
      { connection: this.host.workerConnection(), prefix: this.prefix },
    );
    worker.on('completed', (job) => this.host.jobFinished(this.name, job));
    worker.on('failed', (job, err) => this.host.jobFinished(this.name, job, err));
    worker.on('error', (err) => this.host.redisError(`worker ${this.name}`, err));
    this.worker = worker;
  }

  get hasWorker(): boolean {
    return this.worker !== undefined;
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}

/**
 * Creates BullMQ queues. Enqueueing shares one fail-fast ioredis connection (no offline queue: a
 * request never waits for Redis). Each worker gets its own connection with BullMQ's worker settings
 * (offline queue on, unlimited retries), so a Redis restart only pauses it: on the fail-fast
 * connection a worker under load errored in a loop and never took a job again. `status()` is what
 * `health.ping`/`ready` report; it never throws and never blocks boot when Redis is down. With
 * `role = 'web'` (DRIVER_ROLE, src/shared/process-role.ts) its queues only enqueue; no worker is attached.
 */
@Injectable()
export class BullMqQueueFactory implements QueueFactory, OnModuleDestroy, WorkerHost {
  private readonly logger = new Logger(BullMqQueueFactory.name);

  private connection: Redis | undefined;

  private readonly workerConnections: Redis[] = [];

  private readonly queues = new Map<string, BullMqQueue<unknown>>();

  private lastRedisErrorLog = 0;

  private redisErrorsSinceLog = 0;

  /** When a worker here last finished a job, completed or failed (the worker self-check reads it). */
  lastJobFinishedAt = Date.now();

  constructor(
    private readonly redisUrl: string | undefined = process.env['REDIS_URL'],
    private readonly prefix = 'driver',
    readonly role: ProcessRole = 'all',
  ) {}

  get configured(): boolean {
    return Boolean(this.redisUrl);
  }

  private redis(): Redis {
    if (!this.redisUrl) throw new Error('REDIS_URL is not configured');
    this.connection ??= new Redis(this.redisUrl, {
      maxRetriesPerRequest: null, // required by BullMQ workers, whose connections are duplicates of this one
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    if (this.connection.listenerCount('error') === 0) this.connection.on('error', (err: Error) => this.redisError('queue', err));
    return this.connection;
  }

  workerConnection(): Redis {
    const c = this.redis().duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null });
    this.workerConnections.push(c);
    return c;
  }

  jobFinished(queue: string, job: Job | undefined, err?: Error): void {
    this.lastJobFinishedAt = Date.now();
    if (!err) return;
    const attempts = job?.opts.attempts ?? 1;
    const made = job?.attemptsMade ?? attempts;
    const what = `job ${queue}/${job?.name ?? '?'} (${job?.id ?? '?'})`;
    if (made >= attempts) this.logger.error(`${what} failed after ${made} attempt(s): ${err.message}`, err.stack);
    else this.logger.warn(`${what} attempt ${made} of ${attempts} failed, retrying: ${err.message}`);
  }

  /** Connection errors repeat on every reconnect attempt: one line per 10 s, with how many were folded into it. */
  redisError(source: string, err: Error): void {
    const now = Date.now();
    if (now - this.lastRedisErrorLog < REDIS_ERROR_LOG_MS) {
      this.redisErrorsSinceLog += 1;
      return;
    }
    const more = this.redisErrorsSinceLog > 0 ? ` (+${this.redisErrorsSinceLog} more since the last line)` : '';
    this.lastRedisErrorLog = now;
    this.redisErrorsSinceLog = 0;
    this.logger.error(`redis error on ${source}: ${err.message}${more}`);
  }

  queue<T>(name: string): Queue<T> {
    const existing = this.queues.get(name);
    if (existing) return existing as unknown as Queue<T>;
    const q = new BullMqQueue<T>(name, this.redis(), this.prefix, this.role, this);
    this.queues.set(name, q as unknown as BullMqQueue<unknown>);
    return q;
  }

  /**
   * How late the most overdue job is across the queues this process works (0 when none). Throws when
   * Redis does not answer: the worker self-check then cannot tell, and waits.
   */
  async oldestOverdueJobMs(now = Date.now()): Promise<number> {
    let late = 0;
    for (const q of this.queues.values()) if (q.hasWorker) late = Math.max(late, await q.oldestOverdueMs(now));
    return late;
  }

  /**
   * A write, not a PING: a full Redis (maxmemory, noeviction) still answers PING while every enqueue
   * and sign-in fails, and must read as unavailable.
   */
  async status(): Promise<RedisStatus> {
    if (!this.redisUrl) return 'unavailable';
    try {
      const r = this.redis();
      if (r.status === 'wait') await r.connect();
      const ok = await r.set(`${this.prefix}:health`, String(Date.now()), 'EX', 30);
      return ok === 'OK' ? 'ok' : 'unavailable';
    } catch (err) {
      this.logger.warn(`redis unavailable: ${(err as Error).message}`);
      return 'unavailable';
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    for (const c of this.workerConnections) c.disconnect();
    this.connection?.disconnect();
  }
}

// ───────────────────────── In-memory ─────────────────────────

interface PendingJob<T> {
  id: string;
  name: string;
  data: T;
  readyAt: number;
  attemptsLeft: number;
  /** jobId to release when the job finishes (transient jobs only). */
  release?: string;
}

/**
 * Same contract, no Redis. Jobs sit in a list until `drain(now)` runs every job whose
 * delay has elapsed; a `FakeClock` drives the simulator and tests through it.
 */
export class InMemoryQueue<T = unknown> implements Queue<T> {
  private readonly jobs: PendingJob<T>[] = [];

  private readonly seen = new Set<string>();

  private handler: JobHandler<T> | undefined;

  private seq = 0;

  constructor(
    readonly name: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async add(name: string, data: T, opts: EnqueueOptions = {}): Promise<void> {
    if (opts.jobId) {
      assertJobId(opts.jobId);
      if (this.seen.has(opts.jobId)) return;
      this.seen.add(opts.jobId);
    }
    this.seq += 1;
    this.jobs.push({
      id: opts.jobId ?? `${this.name}:${this.seq}`,
      name,
      data,
      readyAt: this.now().getTime() + (opts.delayMs ?? 0),
      attemptsLeft: opts.attempts ?? DEFAULT_JOB_ATTEMPTS,
      ...(opts.transient && opts.jobId ? { release: opts.jobId } : {}),
    });
  }

  process(handler: JobHandler<T>): void {
    this.handler = handler;
  }

  /** Jobs waiting (ready or delayed). */
  get size(): number {
    return this.jobs.length;
  }

  pending(): ReadonlyArray<{ id: string; name: string; data: T; readyAt: Date }> {
    return this.jobs.map((j) => ({ id: j.id, name: j.name, data: j.data, readyAt: new Date(j.readyAt) }));
  }

  /** Runs every job due at `at` (default: the queue's clock) in order; returns how many ran. */
  async drain(at: Date = this.now()): Promise<number> {
    if (!this.handler) return 0;
    let ran = 0;
    const t = at.getTime();
    // Jobs may enqueue more jobs while draining; loop until nothing is due.
    for (;;) {
      const idx = this.jobs.findIndex((j) => j.readyAt <= t);
      if (idx < 0) break;
      const [job] = this.jobs.splice(idx, 1);
      if (!job) break;
      try {
        await this.handler({ id: job.id, name: job.name, data: job.data });
        ran += 1;
        if (job.release) this.seen.delete(job.release);
      } catch (err) {
        job.attemptsLeft -= 1;
        if (job.attemptsLeft > 0) this.jobs.push(job);
        else {
          if (job.release) this.seen.delete(job.release);
          throw err;
        }
      }
    }
    return ran;
  }

  async close(): Promise<void> {
    this.jobs.length = 0;
  }
}

export class InMemoryQueueFactory implements QueueFactory {
  private readonly queues = new Map<string, InMemoryQueue<unknown>>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  queue<T>(name: string): InMemoryQueue<T> {
    const existing = this.queues.get(name);
    if (existing) return existing as InMemoryQueue<T>;
    const q = new InMemoryQueue<T>(name, this.now);
    this.queues.set(name, q as InMemoryQueue<unknown>);
    return q;
  }

  /** Drains every queue; used by the simulator's tick. */
  async drainAll(at?: Date): Promise<number> {
    let n = 0;
    for (const q of this.queues.values()) n += await q.drain(at);
    return n;
  }
}
