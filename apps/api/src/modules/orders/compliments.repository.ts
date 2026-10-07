import { randomUUID } from 'node:crypto';
import { ComplimentKey } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** One customer's kind words for the courier/driver of one order (joy l4). Ids and keys only. */
export interface ComplimentRecord {
  id: string;
  orderId: string;
  courierId: string;
  customerId: string;
  orderType: string;
  keys: ComplimentKey[];
  createdAt: Date;
}

export type NewCompliment = Omit<ComplimentRecord, 'id'>;

/** `order_compliments`: Prisma when DATABASE_URL is set, in-memory otherwise. One row per order. */
export interface OrderComplimentsRepository {
  forOrder(orderId: string, tx?: Tx): Promise<ComplimentRecord | null>;
  create(c: NewCompliment, tx?: Tx): Promise<ComplimentRecord>;
  /** A courier's compliments, newest first, optionally within [from, to). */
  forCourier(courierId: string, range?: { from?: Date | undefined; to?: Date | undefined }): Promise<ComplimentRecord[]>;
}

export const ORDER_COMPLIMENTS_REPOSITORY = Symbol('ORDER_COMPLIMENTS_REPOSITORY');

const inRange = (at: Date, range: { from?: Date | undefined; to?: Date | undefined } = {}) => (!range.from || at.getTime() >= range.from.getTime()) && (!range.to || at.getTime() < range.to.getTime());

/** Stored keys back as `ComplimentKey`s; a key this build doesn't know is skipped, never shown raw. */
function knownKeys(keys: readonly string[]): ComplimentKey[] {
  return keys.filter((k): k is ComplimentKey => ComplimentKey.safeParse(k).success);
}

export class InMemoryOrderComplimentsRepository implements OrderComplimentsRepository {
  private readonly rows = new Map<string, ComplimentRecord>();

  async forOrder(orderId: string): Promise<ComplimentRecord | null> {
    return this.rows.get(orderId) ?? null;
  }

  async create(c: NewCompliment): Promise<ComplimentRecord> {
    const existing = this.rows.get(c.orderId);
    if (existing) return existing;
    const row = { ...c, id: `cmp_${randomUUID()}`, keys: [...c.keys] };
    this.rows.set(c.orderId, row);
    return row;
  }

  async forCourier(courierId: string, range?: { from?: Date | undefined; to?: Date | undefined }): Promise<ComplimentRecord[]> {
    return [...this.rows.values()].filter((r) => r.courierId === courierId && inRange(r.createdAt, range)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
}

type Row = { id: string; orderId: string; courierId: string; customerId: string; orderType: string; keys: string[]; createdAt: Date };

const fromRow = (r: Row): ComplimentRecord => ({ id: r.id, orderId: r.orderId, courierId: r.courierId, customerId: r.customerId, orderType: r.orderType, keys: knownKeys(r.keys), createdAt: r.createdAt });

export class PrismaOrderComplimentsRepository implements OrderComplimentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async forOrder(orderId: string, tx?: Tx): Promise<ComplimentRecord | null> {
    const row = await this.db(tx).orderCompliment.findUnique({ where: { orderId } });
    return row ? fromRow(row) : null;
  }

  async create(c: NewCompliment, tx?: Tx): Promise<ComplimentRecord> {
    // One row per order: a racing second send gets the first one back.
    const row = await this.db(tx).orderCompliment.upsert({
      where: { orderId: c.orderId },
      create: { orderId: c.orderId, courierId: c.courierId, customerId: c.customerId, orderType: c.orderType, keys: [...c.keys], createdAt: c.createdAt, updatedAt: c.createdAt },
      update: {},
    });
    return fromRow(row);
  }

  async forCourier(courierId: string, range: { from?: Date | undefined; to?: Date | undefined } = {}): Promise<ComplimentRecord[]> {
    const createdAt = { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) };
    const rows = await this.prisma.prisma.orderCompliment.findMany({ where: { courierId, ...(range.from || range.to ? { createdAt } : {}) }, orderBy: { createdAt: 'desc' } });
    return rows.map(fromRow);
  }
}
