import type { Tx } from '@driver/db';

/** A delayed job as the caller schedules it (plan W4: one row per timer, in the caller's transaction). */
export interface TimerSpec {
  /** The queue whose handler runs it (`orders.timers`, `dispatch`, …). */
  queue: string;
  /** Job name inside the queue. */
  name: string;
  /** The BullMQ job id. Scheduling the same id again while it is pending is a no-op; once fired, it re-arms. */
  jobId?: string;
  /** Ids only, never personal data. */
  data: unknown;
  dueAt: Date;
  /** Default 5. */
  maxAttempts?: number;
}

/** A due timer a sweeper holds until `leaseMs` after its claim. */
export interface ClaimedTimer {
  id: string;
  queue: string;
  name: string;
  jobId: string | null;
  data: unknown;
  dueAt: Date;
  /** Including this one. */
  attempts: number;
  maxAttempts: number;
}

export interface ClaimOptions {
  now: Date;
  /** Only timers of these queues: a process claims what it has handlers for. */
  queues: readonly string[];
  limit: number;
  leaseMs: number;
  /** Who holds the claim (machine and process), for the Console and the logs. */
  worker: string;
}

/** What `health.ready` and the alerts read (plan 7.2 "timer sweep lag"). */
export interface TimerStats {
  pending: number;
  /** Pending and already due. */
  overdue: number;
  /** How late the oldest due timer is; 0 when none is due. */
  oldestOverdueMs: number;
  /** Gave up after `max_attempts`: a person must look. */
  failed: number;
}

/** Fired rows are kept this long (for "did the timer run?" questions), failed ones longer. */
export const TIMER_KEEP_FIRED_MS = 7 * 86_400_000;
export const TIMER_KEEP_FAILED_MS = 30 * 86_400_000;
export const TIMER_DEFAULT_MAX_ATTEMPTS = 5;

/**
 * The durable timer table (`public.scheduled_timers`). Postgres in production, an in-memory twin for
 * unit tests, the simulator and the demo APIs. Every method is safe with any number of sweepers.
 */
export interface TimerStore {
  /** Writes the timer (in `tx` when given). Returns false when a pending timer with the same job id already exists. */
  schedule(spec: TimerSpec, tx?: Tx): Promise<boolean>;
  /** Claims up to `limit` due, unclaimed (or lease-expired) timers, oldest first, counting an attempt on each. */
  claimDue(opts: ClaimOptions): Promise<ClaimedTimer[]>;
  /** The handler succeeded. */
  complete(id: string, now: Date): Promise<void>;
  /** The handler failed: due again at `retryAt`, or failed for good when `retryAt` is null. */
  fail(id: string, error: string, retryAt: Date | null): Promise<void>;
  /** BullMQ ran the job first: the sweeper must not run it again. */
  markFired(queue: string, jobId: string, now: Date, tx?: Tx): Promise<void>;
  /** Deletes fired rows past `TIMER_KEEP_FIRED_MS` and failed rows past `TIMER_KEEP_FAILED_MS`. */
  prune(now: Date, limit?: number): Promise<number>;
  stats(now: Date): Promise<TimerStats>;
}

export const TIMER_STORE = Symbol('TIMER_STORE');
