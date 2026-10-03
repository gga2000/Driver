import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue as BullQueue, Worker as BullWorker, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';

export type RedisStatus = 'ok' | 'unavailable';

export interface EnqueueOptions {
  /** Milliseconds to wait before the job becomes available (timers: offer waves, auto-reject…). */
  delayMs?: number;
  /** Stable id: enqueueing the same id twice is a no-op (idempotent pokes and timers). */
  jobId?: string;
  attempts?: number;
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

class BullMqQueue<T> implements Queue<T> {
  private readonly queue: BullQueue<T>;

  private worker: BullWorker<T> | undefined;

  constructor(
    readonly name: string,
    private readonly connection: Redis,
    private readonly prefix: string,
  ) {
    this.queue = new BullQueue<T>(name, { connection, prefix });
  }

  async add(name: string, data: T, opts: EnqueueOptions = {}): Promise<void> {
    if (opts.jobId !== undefined) assertJobId(opts.jobId);
    const jobOpts: JobsOptions = {
      removeOnComplete: opts.transient ? true : 1000,
      removeOnFail: opts.transient ? true : 5000,
      attempts: opts.attempts ?? 1,
      ...(opts.delayMs !== undefined ? { delay: opts.delayMs } : {}),
      ...(opts.jobId !== undefined ? { jobId: opts.jobId } : {}),
      ...(opts.backoffMs !== undefined ? { backoff: { type: 'exponential', delay: opts.backoffMs } } : {}),
    };
    await this.queue.add(name as never, data as never, jobOpts);
  }

  process(handler: JobHandler<T>): void {
    if (this.worker) throw new Error(`queue ${this.name} already has a processor`);
    this.worker = new BullWorker<T>(
      this.name,
      async (job) => handler({ id: String(job.id ?? ''), name: job.name, data: job.data }),
      { connection: this.connection, prefix: this.prefix },
    );
  }

  async close(): Promise<void> {
    await this.worker?.close();
    await this.queue.close();
  }
}

/**
 * Creates BullMQ queues on one shared ioredis connection. `status()` is what `health.ping`
 * reports; it never throws and never blocks boot when Redis is down.
 */
@Injectable()
export class BullMqQueueFactory implements QueueFactory, OnModuleDestroy {
  private readonly logger = new Logger(BullMqQueueFactory.name);

  private connection: Redis | undefined;

  private readonly queues = new Map<string, Queue<unknown>>();

  constructor(
    private readonly redisUrl: string | undefined = process.env['REDIS_URL'],
    private readonly prefix = 'driver',
  ) {}

  get configured(): boolean {
    return Boolean(this.redisUrl);
  }

  private redis(): Redis {
    if (!this.redisUrl) throw new Error('REDIS_URL is not configured');
    this.connection ??= new Redis(this.redisUrl, {
      maxRetriesPerRequest: null, // required by BullMQ workers
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    return this.connection;
  }

  queue<T>(name: string): Queue<T> {
    const existing = this.queues.get(name);
    if (existing) return existing as Queue<T>;
    const q = new BullMqQueue<T>(name, this.redis(), this.prefix);
    this.queues.set(name, q as Queue<unknown>);
    return q;
  }

  async status(): Promise<RedisStatus> {
    if (!this.redisUrl) return 'unavailable';
    try {
      const r = this.redis();
      if (r.status === 'wait') await r.connect();
      const pong = await r.ping();
      return pong === 'PONG' ? 'ok' : 'unavailable';
    } catch (err) {
      this.logger.warn(`redis unavailable: ${(err as Error).message}`);
      return 'unavailable';
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
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
      attemptsLeft: opts.attempts ?? 1,
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
