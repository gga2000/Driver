import { randomUUID } from 'node:crypto';
import { Prisma, type Tx } from '@driver/db';
import type { PrismaService } from '../db/prisma.service.js';
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

/** Timestamps are TIMESTAMP(3) holding UTC, like every table here. */
const ts = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

interface ClaimRow {
  id: string;
  queue: string;
  name: string;
  job_id: string | null;
  data: unknown;
  due_at: Date;
  attempts: number;
  max_attempts: number;
}

/** `public.scheduled_timers` on Postgres (migration 20261009090000_scheduled_timers). */
export class PrismaTimerStore implements TimerStore {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async schedule(spec: TimerSpec, tx?: Tx): Promise<boolean> {
    // A pending timer with the same job id wins (BullMQ's jobId dedupe); a fired or failed one is re-armed.
    const rows = await this.db(tx).$queryRaw<Array<{ id: string }>>`
      INSERT INTO "public"."scheduled_timers" ("id", "queue", "name", "job_id", "data", "status", "due_at", "attempts", "max_attempts", "created_at", "updated_at")
      VALUES (${`tmr_${randomUUID()}`}, ${spec.queue}, ${spec.name}, ${spec.jobId ?? null}, ${JSON.stringify(spec.data ?? null)}::jsonb,
        'pending', ${ts(spec.dueAt)}, 0, ${spec.maxAttempts ?? TIMER_DEFAULT_MAX_ATTEMPTS}::int, now() AT TIME ZONE 'UTC', now() AT TIME ZONE 'UTC')
      ON CONFLICT ("queue", "job_id") DO UPDATE SET
        "name" = EXCLUDED."name", "data" = EXCLUDED."data", "status" = 'pending', "due_at" = EXCLUDED."due_at",
        "attempts" = 0, "max_attempts" = EXCLUDED."max_attempts", "claimed_until" = NULL, "claimed_by" = NULL,
        "fired_at" = NULL, "last_error" = NULL, "updated_at" = EXCLUDED."updated_at"
      WHERE "scheduled_timers"."status" <> 'pending'
      RETURNING "id"`;
    return rows.length > 0;
  }

  async claimDue(opts: ClaimOptions): Promise<ClaimedTimer[]> {
    if (opts.queues.length === 0 || opts.limit <= 0) return [];
    // One statement: the inner SELECT locks due rows no other sweeper holds (SKIP LOCKED); the UPDATE
    // takes a lease on them, so the handler runs outside any transaction and a crashed worker's rows
    // come back when the lease ends.
    const rows = await this.prisma.prisma.$queryRaw<ClaimRow[]>`
      UPDATE "public"."scheduled_timers" t
      SET "attempts" = t."attempts" + 1, "claimed_until" = ${ts(new Date(opts.now.getTime() + opts.leaseMs))},
          "claimed_by" = ${opts.worker}, "updated_at" = ${ts(opts.now)}
      WHERE t."id" IN (
        SELECT "id" FROM "public"."scheduled_timers"
        WHERE "status" = 'pending' AND "due_at" <= ${ts(opts.now)} AND "queue" = ANY(${[...opts.queues]}::text[])
          AND ("claimed_until" IS NULL OR "claimed_until" <= ${ts(opts.now)})
        ORDER BY "due_at", "id"
        LIMIT ${opts.limit}::int
        FOR UPDATE SKIP LOCKED)
      RETURNING t."id", t."queue", t."name", t."job_id", t."data", t."due_at", t."attempts", t."max_attempts"`;
    return rows
      .map((r) => ({ id: r.id, queue: r.queue, name: r.name, jobId: r.job_id, data: r.data, dueAt: r.due_at, attempts: Number(r.attempts), maxAttempts: Number(r.max_attempts) }))
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id));
  }

  async complete(id: string, now: Date): Promise<void> {
    await this.prisma.prisma.$executeRaw`
      UPDATE "public"."scheduled_timers" SET "status" = 'fired', "fired_at" = ${ts(now)}, "claimed_until" = NULL, "updated_at" = ${ts(now)}
      WHERE "id" = ${id} AND "status" = 'pending'`;
  }

  async fail(id: string, error: string, retryAt: Date | null): Promise<void> {
    const message = error.slice(0, 2_000);
    if (retryAt) {
      await this.prisma.prisma.$executeRaw`
        UPDATE "public"."scheduled_timers" SET "due_at" = ${ts(retryAt)}, "claimed_until" = NULL, "last_error" = ${message}, "updated_at" = now() AT TIME ZONE 'UTC'
        WHERE "id" = ${id} AND "status" = 'pending'`;
    } else {
      await this.prisma.prisma.$executeRaw`
        UPDATE "public"."scheduled_timers" SET "status" = 'failed', "claimed_until" = NULL, "last_error" = ${message}, "updated_at" = now() AT TIME ZONE 'UTC'
        WHERE "id" = ${id} AND "status" = 'pending'`;
    }
  }

  async markFired(queue: string, jobId: string, now: Date, tx?: Tx): Promise<void> {
    await this.db(tx).$executeRaw`
      UPDATE "public"."scheduled_timers" SET "status" = 'fired', "fired_at" = ${ts(now)}, "claimed_until" = NULL, "updated_at" = ${ts(now)}
      WHERE "queue" = ${queue} AND "job_id" = ${jobId} AND "status" = 'pending'`;
  }

  async settlePending(queue: string, jobIdPrefix: string, now: Date, tx?: Tx): Promise<number> {
    return this.db(tx).$executeRaw`
      UPDATE "public"."scheduled_timers" SET "status" = 'fired', "fired_at" = ${ts(now)}, "claimed_until" = NULL, "updated_at" = ${ts(now)}
      WHERE "queue" = ${queue} AND "status" = 'pending' AND starts_with("job_id", ${jobIdPrefix})`;
  }

  async prune(now: Date, limit = 5_000): Promise<number> {
    return this.prisma.prisma.$executeRaw`
      DELETE FROM "public"."scheduled_timers" WHERE "id" IN (
        SELECT "id" FROM "public"."scheduled_timers"
        WHERE ("status" = 'fired' AND "fired_at" < ${ts(new Date(now.getTime() - TIMER_KEEP_FIRED_MS))})
           OR ("status" = 'failed' AND "updated_at" < ${ts(new Date(now.getTime() - TIMER_KEEP_FAILED_MS))})
        LIMIT ${limit}::int)`;
  }

  async stats(now: Date): Promise<TimerStats> {
    const [row] = await this.prisma.prisma.$queryRaw<Array<{ pending: bigint; overdue: bigint; oldest: Date | null; failed: bigint }>>`
      SELECT count(*) FILTER (WHERE "status" = 'pending') AS "pending",
             count(*) FILTER (WHERE "status" = 'pending' AND "due_at" <= ${ts(now)}) AS "overdue",
             min("due_at") FILTER (WHERE "status" = 'pending' AND "due_at" <= ${ts(now)}) AS "oldest",
             count(*) FILTER (WHERE "status" = 'failed') AS "failed"
      FROM "public"."scheduled_timers" WHERE "status" IN ('pending', 'failed')`;
    return {
      pending: Number(row?.pending ?? 0),
      overdue: Number(row?.overdue ?? 0),
      oldestOverdueMs: row?.oldest ? Math.max(0, now.getTime() - row.oldest.getTime()) : 0,
      failed: Number(row?.failed ?? 0),
    };
  }
}
