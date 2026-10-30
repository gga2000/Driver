import type { PriceRequest, Quote, QuoteComponent } from '@driver/contracts';
import type { Prisma } from '@driver/db';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import { onRollback, type Tx } from '../../shared/db/unit-of-work.js';

/**
 * LOAD-01: the quotes `pricing.quote` hands out are kept, because `orders.quote_id` and
 * `trips.quote_id` are foreign keys to `quotes` (and unique: one quote, one order). A kept quote is
 * good until `expiresAt`; `claim` takes it for one order inside the order's transaction.
 */
export interface QuoteStore {
  save(quote: Quote, req: PriceRequest, expiresAt: Date): Promise<void>;
  /**
   * Takes the quote for one order at `at`: true once, while it exists and has not expired. Inside the
   * order's transaction, so a rolled-back placing gives it back. A second order on the same quote gets
   * false (a retry of the same order is answered earlier, by its `clientRequestId` replay).
   */
  claim(quoteId: string, at: Date, tx?: Tx): Promise<boolean>;
  /**
   * Perf z3: whether `quoteId` could still be booked at `until` — kept, not taken by an order, and not
   * expired by then. One primary-key read; lets `pricing.quote` hand back a quote it already kept.
   */
  isOpen(quoteId: string, until: Date): Promise<boolean>;
  /**
   * Deletes up to `limit` quotes (and their components) that expired before `before` and that no order
   * or trip took. Returns how many quotes went. Safe with several workers (SKIP LOCKED).
   */
  purgeExpired(before: Date, limit: number): Promise<number>;
}

export const QUOTE_STORE = Symbol('QUOTE_STORE');

/** How long a kept quote may be booked (the choose screen re-quotes on `price_changed` after that). */
export const QUOTE_TTL_MIN = 30;

/**
 * An expired quote nobody booked is deleted this long after it expired: past any order still being
 * placed at the deadline (`claim` already refuses it), short enough that `pricing.quote` (every choose
 * screen, every re-quote) does not grow the table without bound.
 */
export const QUOTE_PURGE_GRACE_MIN = 60;

/**
 * Perf z3: a kept quote is handed out again (no new rows) while it still has this many minutes to be
 * booked; below that, the next `pricing.quote` keeps a new one. Checkout re-quotes every minute, so a
 * shown quote always has at least this long, less a minute, left at booking.
 */
export const QUOTE_REUSE_MIN_LEFT_MIN = 15;

/** Without a database (demo API, unit tests): the same rules in memory, rollbacks included. */
export class InMemoryQuoteStore implements QuoteStore {
  readonly quotes = new Map<string, { expiresAt: Date; acceptedAt: Date | null; totalIqd: number }>();

  async purgeExpired(before: Date, limit: number): Promise<number> {
    let n = 0;
    for (const [id, q] of this.quotes) {
      if (n >= limit) break;
      // A taken quote is referenced by its order (and trip): it stays.
      if (q.acceptedAt || q.expiresAt.getTime() >= before.getTime()) continue;
      this.quotes.delete(id);
      n += 1;
    }
    return n;
  }

  async save(quote: Quote, _req: PriceRequest, expiresAt: Date): Promise<void> {
    this.quotes.set(quote.id, { expiresAt, acceptedAt: null, totalIqd: quote.total });
  }

  async isOpen(quoteId: string, until: Date): Promise<boolean> {
    const q = this.quotes.get(quoteId);
    return q !== undefined && q.acceptedAt === null && q.expiresAt.getTime() > until.getTime();
  }

  async claim(quoteId: string, at: Date, tx?: Tx): Promise<boolean> {
    const q = this.quotes.get(quoteId);
    if (!q || q.acceptedAt || q.expiresAt.getTime() <= at.getTime()) return false;
    q.acceptedAt = at;
    onRollback(tx, () => {
      q.acceptedAt = null;
    });
    return true;
  }
}

function componentRow(c: QuoteComponent): Prisma.QuoteComponentCreateWithoutQuoteInput {
  return {
    key: c.key,
    labelAr: c.label_ar,
    labelEn: c.label_en,
    amountIqd: c.amount,
    driverShareRule: c.driverShareRule,
    visibility: c.visibility,
    ...(c.leg !== undefined ? { leg: c.leg } : {}),
  };
}

/** Bound when DATABASE_URL is set: `quotes` + `quote_components`. */
export class PrismaQuoteStore implements QuoteStore {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async save(quote: Quote, req: PriceRequest, expiresAt: Date): Promise<void> {
    await this.db().quote.create({
      data: {
        id: quote.id,
        cityId: quote.cityId,
        vertical: quote.vertical,
        currency: quote.currency,
        subtotalIqd: quote.subtotal,
        totalIqd: quote.total,
        shadowTotalIqd: quote.shadowTotal,
        request: JSON.parse(JSON.stringify(req)) as Prisma.InputJsonValue,
        expiresAt,
        components: { create: [...quote.components, ...quote.shadowComponents].map(componentRow) },
      },
    });
  }

  async purgeExpired(before: Date, limit: number): Promise<number> {
    // Candidates are locked (SKIP LOCKED: two workers split the work) and must not be referenced by an
    // order or a trip (both foreign keys are ON DELETE SET NULL, so a delete would silently cut the
    // link). Components first: their foreign key to quotes is RESTRICT.
    return this.prisma.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT q."id" FROM "public"."quotes" q
        WHERE q."expires_at" < (${before.toISOString()}::timestamptz AT TIME ZONE 'UTC')
          AND NOT EXISTS (SELECT 1 FROM "public"."orders" o WHERE o."quote_id" = q."id")
          AND NOT EXISTS (SELECT 1 FROM "public"."trips" t WHERE t."quote_id" = q."id")
        ORDER BY q."expires_at"
        LIMIT ${limit}::int
        FOR UPDATE OF q SKIP LOCKED`;
      if (rows.length === 0) return 0;
      const ids = rows.map((r) => r.id);
      await tx.$executeRaw`DELETE FROM "public"."quote_components" WHERE "quote_id" = ANY(${ids}::text[])`;
      return tx.$executeRaw`DELETE FROM "public"."quotes" WHERE "id" = ANY(${ids}::text[])`;
    });
  }

  async isOpen(quoteId: string, until: Date): Promise<boolean> {
    const row = await this.db().quote.findFirst({
      where: { id: quoteId, acceptedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: until } }] },
      select: { id: true },
    });
    return row !== null;
  }

  async claim(quoteId: string, at: Date, tx?: Tx): Promise<boolean> {
    // One conditional update: a second order racing for the same quote waits on the row lock, then
    // sees accepted_at set and takes nothing.
    const { count } = await this.db(tx).quote.updateMany({
      where: { id: quoteId, acceptedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: at } }] },
      data: { acceptedAt: at, lockedAt: at },
    });
    return count === 1;
  }
}
