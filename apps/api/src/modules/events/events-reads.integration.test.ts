import { Prisma } from '@driver/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { PrismaEventsRepository, type EventFilter } from './events.repository.js';

/**
 * Event-history reads stay index lookups as the log grows (the customer's tracking, checkout's
 * idempotency check and every courier's cash-cap tier pay them). Seeds a history, then EXPLAINs the
 * exact SQL the repository sends and fails on a sequential scan of `events` or `outbox`.
 * Needs DATABASE_URL with the migrations deployed. Skipped otherwise.
 */
const url = process.env['DATABASE_URL'];
const PEOPLE = 200;
const EACH = 100;

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  Plans?: PlanNode[];
}

const scans = (n: PlanNode): string[] => [...(n['Node Type'] === 'Seq Scan' ? [n['Relation Name'] ?? '?'] : []), ...(n.Plans ?? []).flatMap(scans)];

describe.skipIf(!url)('event-history reads on Postgres use indexes (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const repo = new PrismaEventsRepository(prisma);
  const tag = `er_${Date.now().toString(36)}`;

  /** Runs `read` with a transaction stand-in that records the repository's SQL, then EXPLAINs it. */
  async function seqScans(read: (tx: Tx) => Promise<unknown>): Promise<string[]> {
    let sql: Prisma.Sql | undefined;
    const tx = {
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        sql = Prisma.sql(strings, ...values);
        return Promise.resolve([]);
      },
    } as unknown as Tx;
    await read(tx);
    if (!sql) throw new Error('the read sent no SQL');
    const [row] = await prisma.prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': Array<{ Plan: PlanNode }> }>>(`EXPLAIN (FORMAT JSON) ${sql.text}`, ...sql.values);
    return scans(row!['QUERY PLAN'][0]!.Plan).filter((r) => r === 'events' || r === 'outbox');
  }

  beforeAll(async () => {
    const db = prisma.prisma;
    await db.$executeRawUnsafe(`INSERT INTO "public"."people" ("id", "updated_at") SELECT '${tag}_p' || i, now() FROM generate_series(1, ${PEOPLE}) i`);
    await db.$executeRawUnsafe(`
      INSERT INTO "public"."events" ("id", "actor_id", "type", "aggregate", "aggregate_id", "payload", "idempotency_key", "occurred_at", "recorded_at", "updated_at")
      SELECT '${tag}_e' || n, '${tag}_p' || (1 + n % ${PEOPLE}), 'trip.accepted', 'trip', '${tag}_t' || n, '{}', '${tag}_k' || n,
        now() - make_interval(mins => n), now() - make_interval(mins => n), now()
      FROM generate_series(1, ${PEOPLE * EACH}) n`);
    await db.$executeRawUnsafe(`
      INSERT INTO "public"."outbox" ("id", "event_id", "aggregate", "aggregate_id", "type", "payload", "status", "idempotency_key", "updated_at")
      SELECT '${tag}_o' || n, '${tag}_e' || n, 'trip', '${tag}_t' || n, 'trip.accepted', jsonb_build_object('actorId', '${tag}_p' || (1 + n % ${PEOPLE})),
        'published', '${tag}_k' || n, now()
      FROM generate_series(1, ${PEOPLE * EACH}) n`);
    await db.$executeRawUnsafe(`ANALYZE "public"."events"`);
    await db.$executeRawUnsafe(`ANALYZE "public"."outbox"`);
  }, 60_000);

  afterAll(async () => {
    const db = prisma.prisma;
    await db.$executeRawUnsafe(`DELETE FROM "public"."outbox" WHERE "id" LIKE '${tag}\\_%'`);
    await db.$executeRawUnsafe(`DELETE FROM "public"."events" WHERE "id" LIKE '${tag}\\_%'`);
    await db.$executeRawUnsafe(`DELETE FROM "public"."people" WHERE "id" LIKE '${tag}\\_%'`);
    await prisma.onModuleDestroy();
  });

  it.each<[string, EventFilter]>([
    ['a person (courier history)', { actorId: `${tag}_p7` }],
    ['a person in a window, some types (cash-cap tier)', { actorId: `${tag}_p7`, from: new Date(Date.now() - 14 * 86_400_000), types: ['offer.sent', 'offer.declined'] }],
    ['an order (tracking, support timeline)', { orderId: `${tag}_order` }],
    ['a trip (Console trip log)', { tripId: `${tag}_trip` }],
    ['several orders', { orderIds: [`${tag}_a`, `${tag}_b`] }],
  ])('reads the events of %s without a sequential scan', async (_what, filter) => {
    expect(await seqScans((tx) => repo.find(filter, tx))).toEqual([]);
  });

  it('checks an idempotency key without a sequential scan (every keyed write)', async () => {
    expect(await seqScans((tx) => repo.findByIdempotencyKey(`${tag}_k350`, tx))).toEqual([]);
  });

  it('finds a person by the indexed column, and his first event and capped count', async () => {
    expect(await repo.find({ actorId: `${tag}_p7` })).toHaveLength(EACH);
    const first = await prisma.prisma.event.aggregate({ where: { actorId: `${tag}_p7` }, _min: { occurredAt: true } });
    expect(await repo.firstOccurredAt(`${tag}_p7`)).toEqual(first._min.occurredAt);
    expect(await repo.firstOccurredAt(`${tag}_nobody`)).toBeNull();
    expect(await repo.countUpTo(`${tag}_p7`, ['trip.accepted'], 30)).toBe(30);
    expect(await repo.countUpTo(`${tag}_p7`, ['trip.accepted'], 1_000)).toBe(EACH);
    expect(await repo.countUpTo(`${tag}_p7`, ['trip.completed'], 30)).toBe(0);
  });
});
