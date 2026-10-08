import { randomUUID } from 'node:crypto';
import {
  TIMER_DEFAULT_MAX_ATTEMPTS,
  TIMER_KEEP_FAILED_MS,
  TIMER_KEEP_FIRED_MS,
  type ClaimOptions,
  type ClaimedTimer,
  type TimerSpec,
  type TimerStats,
  type TimerStore,
} from './timer.store.js';

interface Row {
  id: string;
  queue: string;
  name: string;
  jobId: string | null;
  data: unknown;
  status: 'pending' | 'fired' | 'failed';
  dueAt: Date;
  attempts: number;
  maxAttempts: number;
  claimedUntil: Date | null;
  claimedBy: string | null;
  firedAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
}

/**
 * Same contract as the Postgres store, in process. The transaction argument is ignored: the in-memory
 * unit of work has nothing to roll back. Used where there is no DATABASE_URL (unit tests, the
 * simulator, the demo APIs).
 */
export class InMemoryTimerStore implements TimerStore {
  readonly rows: Row[] = [];

  async schedule(spec: TimerSpec): Promise<boolean> {
    const existing = spec.jobId !== undefined ? this.rows.find((r) => r.queue === spec.queue && r.jobId === spec.jobId) : undefined;
    if (existing?.status === 'pending') return false;
    const fresh = {
      name: spec.name,
      data: structuredClone(spec.data),
      status: 'pending' as const,
      dueAt: spec.dueAt,
      attempts: 0,
      maxAttempts: spec.maxAttempts ?? TIMER_DEFAULT_MAX_ATTEMPTS,
      claimedUntil: null,
      claimedBy: null,
      firedAt: null,
      lastError: null,
      updatedAt: new Date(),
    };
    if (existing) Object.assign(existing, fresh);
    else this.rows.push({ id: randomUUID(), queue: spec.queue, jobId: spec.jobId ?? null, ...fresh });
    return true;
  }

  async claimDue(opts: ClaimOptions): Promise<ClaimedTimer[]> {
    const now = opts.now.getTime();
    const due = this.rows
      .filter((r) => r.status === 'pending' && opts.queues.includes(r.queue) && r.dueAt.getTime() <= now && (!r.claimedUntil || r.claimedUntil.getTime() <= now))
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, opts.limit);
    return due.map((r) => {
      r.attempts += 1;
      r.claimedUntil = new Date(now + opts.leaseMs);
      r.claimedBy = opts.worker;
      return { id: r.id, queue: r.queue, name: r.name, jobId: r.jobId, data: structuredClone(r.data), dueAt: r.dueAt, attempts: r.attempts, maxAttempts: r.maxAttempts };
    });
  }

  async complete(id: string, now: Date): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.status !== 'pending') return;
    Object.assign(r, { status: 'fired', firedAt: now, claimedUntil: null, updatedAt: now });
  }

  async fail(id: string, error: string, retryAt: Date | null): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (!r || r.status !== 'pending') return;
    r.lastError = error;
    r.claimedUntil = null;
    if (retryAt) r.dueAt = retryAt;
    else r.status = 'failed';
  }

  async markFired(queue: string, jobId: string, now: Date): Promise<void> {
    const r = this.rows.find((x) => x.queue === queue && x.jobId === jobId && x.status === 'pending');
    if (r) Object.assign(r, { status: 'fired', firedAt: now, claimedUntil: null, updatedAt: now });
  }

  async prune(now: Date, limit = 5_000): Promise<number> {
    const t = now.getTime();
    let n = 0;
    for (let i = this.rows.length - 1; i >= 0 && n < limit; i--) {
      const r = this.rows[i];
      if (!r) continue;
      const old = (r.status === 'fired' && r.firedAt && r.firedAt.getTime() < t - TIMER_KEEP_FIRED_MS) || (r.status === 'failed' && r.updatedAt.getTime() < t - TIMER_KEEP_FAILED_MS);
      if (old) {
        this.rows.splice(i, 1);
        n += 1;
      }
    }
    return n;
  }

  async stats(now: Date): Promise<TimerStats> {
    const t = now.getTime();
    const pending = this.rows.filter((r) => r.status === 'pending');
    const overdue = pending.filter((r) => r.dueAt.getTime() <= t);
    const oldest = overdue.reduce((m, r) => Math.min(m, r.dueAt.getTime()), t);
    return { pending: pending.length, overdue: overdue.length, oldestOverdueMs: t - oldest, failed: this.rows.filter((r) => r.status === 'failed').length };
  }
}
