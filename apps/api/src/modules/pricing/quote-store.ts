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
}

export const QUOTE_STORE = Symbol('QUOTE_STORE');

/** How long a kept quote may be booked (the choose screen re-quotes on `price_changed` after that). */
export const QUOTE_TTL_MIN = 30;

/** Without a database (demo API, unit tests): the same rules in memory, rollbacks included. */
export class InMemoryQuoteStore implements QuoteStore {
  readonly quotes = new Map<string, { expiresAt: Date; acceptedAt: Date | null; totalIqd: number }>();

  async save(quote: Quote, _req: PriceRequest, expiresAt: Date): Promise<void> {
    this.quotes.set(quote.id, { expiresAt, acceptedAt: null, totalIqd: quote.total });
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
