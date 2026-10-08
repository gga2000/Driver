import { randomBytes } from 'node:crypto';
import { Prisma } from '@driver/db';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { OUTBOX_LEASE_MS } from './timestamps.js';
import { fromEnvelope, toEnvelope, type Aggregate, type OutboxPatch, type OutboxRecord, type OutboxStats, type OutboxStatus, type StoredEvent } from './events.types.js';

export interface EventFilter {
  actorId?: string;
  tripId?: string;
  orderId?: string;
  aggregate?: Aggregate;
  /** Only events recorded before this one, in recording order. */
  before?: StoredEvent;
}

/**
 * Storage for `events`, `outbox` and `subscriber_deliveries`. Only the events module touches these
 * tables. Writes take the caller's `tx` so the aggregate row, its event and its outbox row commit
 * (or roll back) together.
 */
export interface EventsRepository {
  findByIdempotencyKey(key: string, tx?: Tx): Promise<StoredEvent | null>;
  /**
   * Writes the event and its outbox row. A repeated idempotency key (including one committed by a
   * concurrent transaction) writes nothing and returns the stored event with `inserted: false`.
   */
  insert(event: StoredEvent, tx?: Tx): Promise<{ event: StoredEvent; inserted: boolean }>;
  /** Events in recording order. */
  find(filter: EventFilter, tx?: Tx): Promise<StoredEvent[]>;
  outboxStats(): Promise<OutboxStats>;
  /** Oldest first, unless `newestFirst`; `limit` caps the rows read. */
  outbox(filter?: OutboxFilter): Promise<OutboxRecord[]>;
  /**
   * Claims up to `limit` due pending rows (oldest first) that no other drain holds, then runs `fn`
   * with them. The claim is its own short transaction (`FOR NO KEY UPDATE SKIP LOCKED`, then the
   * rows' next attempt moved `OUTBOX_LEASE_MS` ahead) and commits before `fn` starts, so delivering a
   * batch holds no row lock and no extra connection; concurrent drains (any number of API instances)
   * still never see the same row. `fn` gets no transaction: its writes commit one by one.
   */
  claimDue<T>(now: Date, limit: number, fn: (rows: OutboxRecord[], tx: Tx | undefined) => Promise<T>, leaseMs?: number): Promise<T>;
  updateOutbox(id: string, patch: OutboxPatch, tx?: Tx): Promise<void>;
  /**
   * Inside a subscriber's transaction, before it checks `deliveredTo`: waits for any other transaction
   * delivering the same row to the same subscriber, so a row two drains hold (a lease ran out) still
   * runs each handler once. Postgres: a transaction-scoped advisory lock.
   */
  lockDelivery(outboxId: string, subscriber: string, tx: Tx): Promise<void>;
  /** Names of the subscribers that already have this row's effect committed. */
  deliveredTo(outboxId: string, tx?: Tx): Promise<Set<string>>;
  markDelivered(outboxId: string, subscriber: string, at: Date, tx?: Tx): Promise<void>;
  recordDeliveryFailure(outboxId: string, subscriber: string, error: string, tx?: Tx): Promise<void>;
  /**
   * Deletes up to `limit` delivery records of outbox rows published before `publishedBefore` and
   * returns how many went. A published row never drains again, so its records no longer guard
   * anything; pending and failed rows keep theirs (a retry still needs them). The outbox rows stay:
   * their payload is the event store's read.
   */
  purgeDeliveries(publishedBefore: Date, limit: number): Promise<number>;
}

export interface OutboxFilter {
  status?: OutboxStatus;
  eventId?: string;
  newestFirst?: boolean;
  limit?: number;
}

export const EVENTS_REPOSITORY = Symbol('EVENTS_REPOSITORY');

let idSeq = 0;

/**
 * Time-ordered ids (`ev_<ms36><seq36><rand>`): sortable within a process, so (recorded_at, id)
 * is a stable recording order even when one transaction records several events in the same ms.
 */
export function newId(prefix: string, at: Date = new Date()): string {
  idSeq = (idSeq + 1) % 36 ** 4;
  return `${prefix}_${at.getTime().toString(36).padStart(9, '0')}${idSeq.toString(36).padStart(4, '0')}${randomBytes(4).toString('hex')}`;
}

const INT4_MAX = 2_147_483_647;
const clampInt = (n: number) => Math.max(-INT4_MAX, Math.min(INT4_MAX, Math.round(n)));
/** `timestamp(3)` columns hold UTC wall time; bind ISO strings and convert explicitly. */
const ts = (d: Date) => Prisma.sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

interface ClaimRow {
  id: string;
  event_id: string | null;
  aggregate: string;
  aggregate_id: string;
  type: string;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  idempotency_key: string | null;
  last_error: string | null;
}

/**
 * Prisma/Postgres implementation. Events are written with raw SQL for `ON CONFLICT DO NOTHING`
 * and the geography column. `actor_id`/`trip_id`/`order_id` are foreign keys, so they are stored
 * only when they resolve (system actors such as `system:ledger` are not people); the outbox
 * `payload` always carries the full event, and reads come from it.
 */
export class PrismaEventsRepository implements EventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async findByIdempotencyKey(key: string, tx?: Tx): Promise<StoredEvent | null> {
    const rows = await this.db(tx).$queryRaw<Array<{ payload: unknown }>>`
      SELECT o."payload" FROM "public"."outbox" o JOIN "public"."events" e ON e."id" = o."event_id"
      WHERE e."idempotency_key" = ${key} LIMIT 1`;
    return rows[0] ? fromEnvelope(rows[0].payload) : null;
  }

  async insert(event: StoredEvent, tx?: Tx): Promise<{ event: StoredEvent; inserted: boolean }> {
    const db = this.db(tx);
    const location = event.location ? Prisma.sql`ST_SetSRID(ST_MakePoint(${event.location.lng}, ${event.location.lat}), 4326)::geography` : Prisma.sql`NULL`;
    const rows = await db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "public"."events" ("id", "actor_id", "type", "aggregate", "aggregate_id", "trip_id", "order_id", "location", "payload",
        "idempotency_key", "occurred_at", "recorded_at", "device_uptime_ms", "skew_ms", "flagged", "flag_reason", "quarantined",
        "quarantine_reason", "created_at", "updated_at")
      VALUES (${event.id}, (SELECT "id" FROM "public"."people" WHERE "id" = ${event.actorId}), ${event.type}, ${event.aggregate}, ${event.aggregateId},
        (SELECT "id" FROM "public"."trips" WHERE "id" = ${event.tripId ?? null}), (SELECT "id" FROM "public"."orders" WHERE "id" = ${event.orderId ?? null}),
        ${location}, ${JSON.stringify(event.payload)}::jsonb, ${event.idempotencyKey ?? null}, ${ts(event.occurredAt)}, ${ts(event.recordedAt)},
        ${event.deviceUptimeMs ?? null}::bigint, ${clampInt(event.skewMs)}::int, ${event.flagged}, ${event.flagReason ?? null}, ${event.quarantined},
        ${event.quarantineReason ?? null}, ${ts(event.recordedAt)}, ${ts(event.recordedAt)})
      ON CONFLICT ("idempotency_key") DO NOTHING
      RETURNING "id"`;
    if (rows.length === 0) {
      const existing = event.idempotencyKey ? await this.findByIdempotencyKey(event.idempotencyKey, tx) : null;
      if (!existing) throw new Error(`event ${event.id} conflicted but no event holds key ${event.idempotencyKey ?? '(none)'}`);
      return { event: existing, inserted: false };
    }
    await db.$executeRaw`
      INSERT INTO "public"."outbox" ("id", "event_id", "aggregate", "aggregate_id", "type", "payload", "status", "attempts", "idempotency_key",
        "next_attempt_at", "created_at", "updated_at")
      VALUES (${newId('ob', event.recordedAt)}, ${event.id}, ${event.aggregate}, ${event.aggregateId}, ${event.type}, ${JSON.stringify(toEnvelope(event))}::jsonb,
        'pending'::"public"."OutboxStatus", 0, ${event.idempotencyKey ?? null}, ${ts(event.recordedAt)}, ${ts(event.recordedAt)}, ${ts(event.recordedAt)})`;
    return { event, inserted: true };
  }

  async find(filter: EventFilter, tx?: Tx): Promise<StoredEvent[]> {
    const where: Prisma.Sql[] = [];
    // Indexed column when the id resolved to a row, envelope otherwise (system actors, unknown trips).
    const ref = (col: string, key: string, v: string) =>
      Prisma.sql`(e.${Prisma.raw(`"${col}"`)} = ${v} OR (e.${Prisma.raw(`"${col}"`)} IS NULL AND o."payload"->>${key} = ${v}))`;
    if (filter.actorId) where.push(ref('actor_id', 'actorId', filter.actorId));
    if (filter.tripId) where.push(ref('trip_id', 'tripId', filter.tripId));
    if (filter.orderId) where.push(ref('order_id', 'orderId', filter.orderId));
    if (filter.aggregate) where.push(Prisma.sql`e."aggregate" = ${filter.aggregate.name} AND e."aggregate_id" = ${filter.aggregate.id}`);
    if (filter.before) where.push(Prisma.sql`(e."recorded_at", e."id") < (${ts(filter.before.recordedAt)}, ${filter.before.id})`);
    const cond = where.length ? Prisma.sql`WHERE ${Prisma.join(where, ' AND ')}` : Prisma.empty;
    const rows = await this.db(tx).$queryRaw<Array<{ payload: unknown }>>`
      SELECT o."payload" FROM "public"."events" e JOIN "public"."outbox" o ON o."event_id" = e."id"
      ${cond} ORDER BY e."recorded_at", e."id"`;
    return rows.map((r) => fromEnvelope(r.payload));
  }

  async outboxStats(): Promise<OutboxStats> {
    const rows = await this.prisma.prisma.outbox.groupBy({ by: ['status'], _count: { _all: true } });
    const stats: OutboxStats = { pending: 0, published: 0, failed: 0 };
    for (const r of rows) stats[r.status] = r._count._all;
    return stats;
  }

  async outbox(filter: OutboxFilter = {}): Promise<OutboxRecord[]> {
    const dir = filter.newestFirst ? 'desc' : 'asc';
    const rows = await this.prisma.prisma.outbox.findMany({
      where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.eventId ? { eventId: filter.eventId } : {}) },
      orderBy: [{ createdAt: dir }, { id: dir }],
      ...(filter.limit !== undefined ? { take: filter.limit } : {}),
    });
    return rows.map((r) => ({
      id: r.id,
      eventId: r.eventId ?? '',
      aggregate: r.aggregate,
      aggregateId: r.aggregateId,
      type: r.type,
      event: fromEnvelope(r.payload),
      status: r.status,
      attempts: r.attempts,
      idempotencyKey: r.idempotencyKey ?? undefined,
      lastError: r.lastError ?? undefined,
      nextAttemptAt: r.nextAttemptAt,
      publishedAt: r.publishedAt ?? undefined,
      createdAt: r.createdAt,
    }));
  }

  async claimDue<T>(now: Date, limit: number, fn: (rows: OutboxRecord[], tx: Tx | undefined) => Promise<T>, leaseMs = OUTBOX_LEASE_MS): Promise<T> {
    // FOR NO KEY UPDATE (not FOR UPDATE): a subscriber transaction elsewhere may be inserting a
    // subscriber_deliveries row whose foreign key takes KEY SHARE on an outbox row; NO KEY UPDATE
    // does not wait for it, and still excludes other drains for the instant of the claim.
    const leaseUntil = new Date(now.getTime() + leaseMs);
    const records = await this.prisma.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimRow[]>`
        SELECT "id", "event_id", "aggregate", "aggregate_id", "type", "payload", "status"::text AS "status", "attempts", "idempotency_key", "last_error"
        FROM "public"."outbox"
        WHERE "status" = 'pending'::"public"."OutboxStatus" AND "next_attempt_at" <= ${ts(now)}
        ORDER BY "created_at", "id"
        LIMIT ${limit}::int
        FOR NO KEY UPDATE SKIP LOCKED`;
      if (rows.length > 0) {
        await tx.$executeRaw`UPDATE "public"."outbox" SET "next_attempt_at" = ${ts(leaseUntil)} WHERE "id" IN (${Prisma.join(rows.map((r) => r.id))})`;
      }
      return rows.map((r): OutboxRecord => {
        const event = fromEnvelope(r.payload);
        return {
          id: r.id,
          eventId: r.event_id ?? event.id,
          aggregate: r.aggregate,
          aggregateId: r.aggregate_id,
          type: r.type,
          event,
          status: r.status,
          attempts: Number(r.attempts),
          idempotencyKey: r.idempotency_key ?? undefined,
          lastError: r.last_error ?? undefined,
          nextAttemptAt: leaseUntil,
          createdAt: event.recordedAt,
        };
      });
    });
    return fn(records, undefined);
  }

  async updateOutbox(id: string, patch: OutboxPatch, tx?: Tx): Promise<void> {
    await this.db(tx).outbox.update({ where: { id }, data: patch });
  }

  async deliveredTo(outboxId: string, tx?: Tx): Promise<Set<string>> {
    const rows = await this.db(tx).subscriberDelivery.findMany({ where: { outboxId, deliveredAt: { not: null } }, select: { subscriber: true } });
    return new Set(rows.map((r) => r.subscriber));
  }

  async lockDelivery(outboxId: string, subscriber: string, tx: Tx): Promise<void> {
    await (tx as unknown as Tx).$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outbox:${outboxId}:${subscriber}`}))`;
  }

  async markDelivered(outboxId: string, subscriber: string, at: Date, tx?: Tx): Promise<void> {
    await this.db(tx).subscriberDelivery.upsert({
      where: { outboxId_subscriber: { outboxId, subscriber } },
      create: { outboxId, subscriber, deliveredAt: at, attempts: 1 },
      update: { deliveredAt: at, attempts: { increment: 1 }, lastError: null },
    });
  }

  async recordDeliveryFailure(outboxId: string, subscriber: string, error: string, tx?: Tx): Promise<void> {
    await this.db(tx).subscriberDelivery.upsert({
      where: { outboxId_subscriber: { outboxId, subscriber } },
      create: { outboxId, subscriber, attempts: 1, lastError: error },
      update: { attempts: { increment: 1 }, lastError: error },
    });
  }

  async purgeDeliveries(publishedBefore: Date, limit: number): Promise<number> {
    return this.prisma.prisma.$executeRaw`
      DELETE FROM "public"."subscriber_deliveries" WHERE "id" IN (
        SELECT sd."id" FROM "public"."subscriber_deliveries" sd
        JOIN "public"."outbox" o ON o."id" = sd."outbox_id"
        WHERE o."status" = 'published' AND o."published_at" < ${ts(publishedBefore)}
        LIMIT ${limit})`;
  }
}
