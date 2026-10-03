import type { TopUpChannel } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import { onRollback, type Tx } from '../../shared/db/unit-of-work.js';

/** A cash top-up request (`wallet_topups`). `expired` is derived from `expiresAt`, never stored. */
export interface TopUpRecord {
  id: string;
  customerId: string;
  amountIqd: number;
  code: string;
  state: 'pending' | 'confirmed' | 'cancelled';
  expiresAt: Date;
  confirmedAt: Date | null;
  confirmedById: string | null;
  channel: TopUpChannel | null;
  reference: string | null;
  idempotencyKey: string | null;
  createdAt: Date;
}

export type NewTopUp = Pick<TopUpRecord, 'customerId' | 'amountIqd' | 'code' | 'expiresAt' | 'createdAt'>;

export interface TopUpConfirmPatch {
  confirmedAt: Date;
  confirmedById: string;
  channel: TopUpChannel;
  reference: string;
  idempotencyKey: string | null;
}

export interface TopUpsRepository {
  create(row: NewTopUp, tx?: Tx): Promise<TopUpRecord>;
  get(id: string, tx?: Tx): Promise<TopUpRecord | null>;
  /** Rows carrying this code, newest first (codes are unique among pending rows only). */
  byCode(code: string, tx?: Tx): Promise<TopUpRecord[]>;
  /** The customer's rows created at or after `since`, newest first. */
  ofCustomer(customerId: string, since: Date, tx?: Tx): Promise<TopUpRecord[]>;
  latestOf(customerId: string, tx?: Tx): Promise<TopUpRecord | null>;
  cancel(id: string, tx?: Tx): Promise<void>;
  /** pending → confirmed, only if still pending (single use); false when someone else got there first. */
  confirm(id: string, patch: TopUpConfirmPatch, tx?: Tx): Promise<boolean>;
}

export const TOPUPS_REPOSITORY = Symbol('TOPUPS_REPOSITORY');

export class InMemoryTopUpsRepository implements TopUpsRepository {
  readonly rows = new Map<string, TopUpRecord>();
  private seq = 0;

  async create(row: NewTopUp): Promise<TopUpRecord> {
    this.seq += 1;
    const rec: TopUpRecord = { ...row, id: `tu_${this.seq}`, state: 'pending', confirmedAt: null, confirmedById: null, channel: null, reference: null, idempotencyKey: null };
    this.rows.set(rec.id, rec);
    return { ...rec };
  }

  async get(id: string): Promise<TopUpRecord | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  private sorted(rows: Iterable<TopUpRecord>): TopUpRecord[] {
    return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id, 'en', { numeric: true })).map((r) => ({ ...r }));
  }

  async byCode(code: string): Promise<TopUpRecord[]> {
    return this.sorted([...this.rows.values()].filter((r) => r.code === code));
  }

  async ofCustomer(customerId: string, since: Date): Promise<TopUpRecord[]> {
    return this.sorted([...this.rows.values()].filter((r) => r.customerId === customerId && r.createdAt >= since));
  }

  async latestOf(customerId: string): Promise<TopUpRecord | null> {
    return this.sorted([...this.rows.values()].filter((r) => r.customerId === customerId))[0] ?? null;
  }

  async cancel(id: string, tx?: Tx): Promise<void> {
    const r = this.rows.get(id);
    if (!r || r.state !== 'pending') return;
    r.state = 'cancelled';
    onRollback(tx, () => {
      r.state = 'pending';
    });
  }

  /** Check and set with no await in between: two confirmations of one code cannot both pass. */
  async confirm(id: string, patch: TopUpConfirmPatch, tx?: Tx): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.state !== 'pending') return false;
    const before = { ...r };
    Object.assign(r, patch, { state: 'confirmed' as const });
    onRollback(tx, () => {
      Object.assign(r, before);
    });
    return true;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma row mapping */
function fromRow(r: any): TopUpRecord {
  return {
    id: r.id,
    customerId: r.customerId,
    amountIqd: r.amountIqd,
    code: r.code,
    state: r.state === 'confirmed' || r.state === 'cancelled' ? r.state : 'pending',
    expiresAt: r.expiresAt,
    confirmedAt: r.confirmedAt,
    confirmedById: r.confirmedById,
    channel: r.channel ?? null,
    reference: r.reference,
    idempotencyKey: r.idempotencyKey,
    createdAt: r.createdAt,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export class PrismaTopUpsRepository implements TopUpsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async create(row: NewTopUp, tx?: Tx): Promise<TopUpRecord> {
    return fromRow(await this.db(tx).walletTopUp.create({ data: row }));
  }

  async get(id: string, tx?: Tx): Promise<TopUpRecord | null> {
    const r = await this.db(tx).walletTopUp.findUnique({ where: { id } });
    return r ? fromRow(r) : null;
  }

  async byCode(code: string, tx?: Tx): Promise<TopUpRecord[]> {
    return (await this.db(tx).walletTopUp.findMany({ where: { code }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 })).map(fromRow);
  }

  async ofCustomer(customerId: string, since: Date, tx?: Tx): Promise<TopUpRecord[]> {
    return (await this.db(tx).walletTopUp.findMany({ where: { customerId, createdAt: { gte: since } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })).map(fromRow);
  }

  async latestOf(customerId: string, tx?: Tx): Promise<TopUpRecord | null> {
    const r = await this.db(tx).walletTopUp.findFirst({ where: { customerId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return r ? fromRow(r) : null;
  }

  async cancel(id: string, tx?: Tx): Promise<void> {
    await this.db(tx).walletTopUp.updateMany({ where: { id, state: 'pending' }, data: { state: 'cancelled' } });
  }

  async confirm(id: string, patch: TopUpConfirmPatch, tx?: Tx): Promise<boolean> {
    const res = await this.db(tx).walletTopUp.updateMany({ where: { id, state: 'pending' }, data: { ...patch, state: 'confirmed' } });
    return res.count === 1;
  }
}
