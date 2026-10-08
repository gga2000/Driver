import { afterAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../shared/db/prisma.service.js';

/**
 * An order's or a trip's money lines come from indexes, not a scan of the whole ledger (speed audit
 * v1). Needs DATABASE_URL with the migrations deployed; skipped otherwise.
 */
const url = process.env['DATABASE_URL'];

describe.skipIf(!url)('ledger_events reads by order and by trip (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  afterAll(() => prisma.onModuleDestroy());

  const plan = (column: 'order_id' | 'trip_id') =>
    prisma.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
      const rows = await tx.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
        `EXPLAIN SELECT * FROM "public"."ledger_events" WHERE "${column}" = 'x' ORDER BY "occurred_at"`,
      );
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    });

  it('byOrder uses ledger_events_order_id_occurred_at_idx, already in time order', async () => {
    const text = await plan('order_id');
    expect(text).toContain('ledger_events_order_id_occurred_at_idx');
    expect(text).not.toMatch(/Seq Scan|Sort/);
  });

  it('byTrip uses ledger_events_trip_id_occurred_at_idx, already in time order', async () => {
    const text = await plan('trip_id');
    expect(text).toContain('ledger_events_trip_id_occurred_at_idx');
    expect(text).not.toMatch(/Seq Scan|Sort/);
  });
});
