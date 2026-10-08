import type { FaultParty, TicketChannel, TicketEntryKind, TicketKind, TicketStatus } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** `support_tickets` */
export interface TicketRecord {
  id: string;
  cityId: string;
  kind: TicketKind;
  status: TicketStatus;
  channel: TicketChannel;
  subject: string;
  orderId: string | null;
  tripId: string | null;
  customerId: string | null;
  openedById: string;
  openedAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  slaDueAt: Date;
  assigneeId: string | null;
  faultParty: FaultParty;
  refundedIqd: number;
  escalatedTo: string | null;
  escalatedAt: Date | null;
  resolution: string | null;
  sourceKey: string | null;
  reopenCount: number;
  lastActivityAt: Date;
}

/** `support_ticket_entries` */
export interface EntryRecord {
  id: string;
  ticketId: string;
  actorId: string;
  kind: TicketEntryKind;
  text: string;
  amountIqd: number | null;
  meta: Record<string, unknown>;
  idempotencyKey: string | null;
  at: Date;
}

export type TicketPatch = Partial<Omit<TicketRecord, 'id' | 'cityId' | 'openedAt' | 'openedById' | 'sourceKey'>>;

export interface SupportRepository {
  create(input: Omit<TicketRecord, 'id'>, tx?: Tx): Promise<TicketRecord>;
  get(id: string, tx?: Tx): Promise<TicketRecord | null>;
  bySourceKey(key: string, tx?: Tx): Promise<TicketRecord | null>;
  update(id: string, patch: TicketPatch, tx?: Tx): Promise<TicketRecord>;
  /** Unresolved tickets, plus resolved ones since `resolvedSince` when given; oldest first. */
  list(filter: { cityId: string; statuses?: readonly TicketStatus[] | undefined; resolvedSince?: Date | undefined; limit: number }, tx?: Tx): Promise<TicketRecord[]>;
  /** Tickets of an order / of a trip (incidents keep a trip's safety data). */
  forOrder(orderId: string, tx?: Tx): Promise<TicketRecord[]>;
  forTrip(tripId: string, tx?: Tx): Promise<TicketRecord[]>;
  /** A customer's tickets opened since `since` (dispute count, monthly credit). */
  forCustomer(customerId: string, since: Date, tx?: Tx): Promise<TicketRecord[]>;
  addEntry(input: Omit<EntryRecord, 'id'>, tx?: Tx): Promise<EntryRecord>;
  entries(ticketId: string, tx?: Tx): Promise<EntryRecord[]>;
  entryByKey(idempotencyKey: string, tx?: Tx): Promise<EntryRecord | null>;
  /** Refund entries written by `actorId` since `since` (per-agent daily cap). */
  refundsBy(actorId: string, since: Date, tx?: Tx): Promise<EntryRecord[]>;
  /** Refund entries on these tickets since `since` (per-customer monthly cap). */
  refundsOn(ticketIds: readonly string[], since: Date, tx?: Tx): Promise<EntryRecord[]>;
  /** Serialises refunds per customer across instances until `tx` ends (no-op in memory). */
  lockCustomer(customerId: string, tx?: Tx): Promise<void>;
  /**
   * W7 account deletion: what he wrote to support is blanked (the ticket, its refunds and the team's
   * replies stay as the record of what was decided). Idempotent.
   */
  blankWrittenBy(actorId: string): Promise<void>;
}

export const SUPPORT_REPOSITORY = Symbol('SUPPORT_REPOSITORY');

export class InMemorySupportRepository implements SupportRepository {
  readonly tickets = new Map<string, TicketRecord>();
  readonly entryRows: EntryRecord[] = [];
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async create(input: Omit<TicketRecord, 'id'>): Promise<TicketRecord> {
    if (input.sourceKey && [...this.tickets.values()].some((t) => t.sourceKey === input.sourceKey)) throw new Error('unique violation: support_tickets.source_key');
    const row = { ...input, id: this.id('tk') };
    this.tickets.set(row.id, row);
    return { ...row };
  }

  async get(id: string): Promise<TicketRecord | null> {
    const t = this.tickets.get(id);
    return t ? { ...t } : null;
  }

  async bySourceKey(key: string): Promise<TicketRecord | null> {
    const t = [...this.tickets.values()].find((x) => x.sourceKey === key);
    return t ? { ...t } : null;
  }

  async update(id: string, patch: TicketPatch): Promise<TicketRecord> {
    const t = this.tickets.get(id);
    if (!t) throw new Error(`ticket ${id} not found`);
    Object.assign(t, patch);
    return { ...t };
  }

  async list(filter: { cityId: string; statuses?: readonly TicketStatus[] | undefined; resolvedSince?: Date | undefined; limit: number }): Promise<TicketRecord[]> {
    return [...this.tickets.values()]
      .filter((t) => t.cityId === filter.cityId)
      .filter((t) => (!filter.statuses || filter.statuses.includes(t.status)) || (filter.resolvedSince !== undefined && t.status === 'resolved' && t.resolvedAt !== null && t.resolvedAt >= filter.resolvedSince))
      .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, filter.limit)
      .map((t) => ({ ...t }));
  }

  async forOrder(orderId: string): Promise<TicketRecord[]> {
    return [...this.tickets.values()].filter((t) => t.orderId === orderId).map((t) => ({ ...t }));
  }

  async forTrip(tripId: string): Promise<TicketRecord[]> {
    return [...this.tickets.values()].filter((t) => t.tripId === tripId).map((t) => ({ ...t }));
  }

  async forCustomer(customerId: string, since: Date): Promise<TicketRecord[]> {
    return [...this.tickets.values()].filter((t) => t.customerId === customerId && t.openedAt >= since).map((t) => ({ ...t }));
  }

  async addEntry(input: Omit<EntryRecord, 'id'>): Promise<EntryRecord> {
    if (input.idempotencyKey && this.entryRows.some((e) => e.idempotencyKey === input.idempotencyKey)) throw new Error('unique violation: support_ticket_entries.idempotency_key');
    const row = { ...input, id: this.id('te') };
    this.entryRows.push(row);
    return { ...row };
  }

  async entries(ticketId: string): Promise<EntryRecord[]> {
    return this.entryRows.filter((e) => e.ticketId === ticketId).map((e) => ({ ...e }));
  }

  async entryByKey(idempotencyKey: string): Promise<EntryRecord | null> {
    const e = this.entryRows.find((x) => x.idempotencyKey === idempotencyKey);
    return e ? { ...e } : null;
  }

  async refundsBy(actorId: string, since: Date): Promise<EntryRecord[]> {
    return this.entryRows.filter((e) => e.kind === 'refund' && e.actorId === actorId && e.at >= since).map((e) => ({ ...e }));
  }

  async refundsOn(ticketIds: readonly string[], since: Date): Promise<EntryRecord[]> {
    const ids = new Set(ticketIds);
    return this.entryRows.filter((e) => e.kind === 'refund' && ids.has(e.ticketId) && e.at >= since).map((e) => ({ ...e }));
  }

  async lockCustomer(): Promise<void> {}

  async blankWrittenBy(actorId: string): Promise<void> {
    for (const e of this.entryRows) if (e.actorId === actorId) e.text = '';
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma row ↔ record mapping */
const ticketFrom = (r: any): TicketRecord => ({
  id: r.id,
  cityId: r.cityId,
  kind: r.kind,
  status: r.status,
  channel: r.channel,
  subject: r.subject,
  orderId: r.orderId,
  tripId: r.tripId,
  customerId: r.customerId,
  openedById: r.openedById,
  openedAt: r.openedAt,
  firstResponseAt: r.firstResponseAt,
  resolvedAt: r.resolvedAt,
  slaDueAt: r.slaDueAt,
  assigneeId: r.assigneeId,
  faultParty: r.faultParty,
  refundedIqd: r.refundedIqd,
  escalatedTo: r.escalatedTo,
  escalatedAt: r.escalatedAt,
  resolution: r.resolution,
  sourceKey: r.sourceKey,
  reopenCount: r.reopenCount,
  lastActivityAt: r.lastActivityAt,
});
const entryFrom = (r: any): EntryRecord => ({
  id: r.id,
  ticketId: r.ticketId,
  actorId: r.actorId,
  kind: r.kind,
  text: r.text,
  amountIqd: r.amountIqd,
  meta: r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? r.meta : {},
  idempotencyKey: r.idempotencyKey,
  at: r.at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export class PrismaSupportRepository implements SupportRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async create(input: Omit<TicketRecord, 'id'>, tx?: Tx): Promise<TicketRecord> {
    return ticketFrom(await this.db(tx).supportTicket.create({ data: input }));
  }

  async get(id: string, tx?: Tx): Promise<TicketRecord | null> {
    const r = await this.db(tx).supportTicket.findUnique({ where: { id } });
    return r ? ticketFrom(r) : null;
  }

  async bySourceKey(key: string, tx?: Tx): Promise<TicketRecord | null> {
    const r = await this.db(tx).supportTicket.findUnique({ where: { sourceKey: key } });
    return r ? ticketFrom(r) : null;
  }

  async update(id: string, patch: TicketPatch, tx?: Tx): Promise<TicketRecord> {
    return ticketFrom(await this.db(tx).supportTicket.update({ where: { id }, data: patch }));
  }

  async list(filter: { cityId: string; statuses?: readonly TicketStatus[] | undefined; resolvedSince?: Date | undefined; limit: number }, tx?: Tx): Promise<TicketRecord[]> {
    const or: object[] = [];
    if (filter.statuses) or.push({ status: { in: [...filter.statuses] } });
    if (filter.resolvedSince) or.push({ status: 'resolved', resolvedAt: { gte: filter.resolvedSince } });
    const rows = await this.db(tx).supportTicket.findMany({
      where: { cityId: filter.cityId, ...(or.length > 0 ? { OR: or } : {}) },
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
      take: filter.limit,
    });
    return rows.map(ticketFrom);
  }

  async forOrder(orderId: string, tx?: Tx): Promise<TicketRecord[]> {
    return (await this.db(tx).supportTicket.findMany({ where: { orderId } })).map(ticketFrom);
  }

  async forTrip(tripId: string, tx?: Tx): Promise<TicketRecord[]> {
    return (await this.db(tx).supportTicket.findMany({ where: { tripId } })).map(ticketFrom);
  }

  async forCustomer(customerId: string, since: Date, tx?: Tx): Promise<TicketRecord[]> {
    return (await this.db(tx).supportTicket.findMany({ where: { customerId, openedAt: { gte: since } } })).map(ticketFrom);
  }

  async addEntry(input: Omit<EntryRecord, 'id'>, tx?: Tx): Promise<EntryRecord> {
    return entryFrom(await this.db(tx).supportTicketEntry.create({ data: { ...input, meta: input.meta as never } }));
  }

  async entries(ticketId: string, tx?: Tx): Promise<EntryRecord[]> {
    return (await this.db(tx).supportTicketEntry.findMany({ where: { ticketId }, orderBy: [{ at: 'asc' }, { createdAt: 'asc' }] })).map(entryFrom);
  }

  async entryByKey(idempotencyKey: string, tx?: Tx): Promise<EntryRecord | null> {
    const r = await this.db(tx).supportTicketEntry.findUnique({ where: { idempotencyKey } });
    return r ? entryFrom(r) : null;
  }

  async refundsBy(actorId: string, since: Date, tx?: Tx): Promise<EntryRecord[]> {
    return (await this.db(tx).supportTicketEntry.findMany({ where: { actorId, kind: 'refund', at: { gte: since } } })).map(entryFrom);
  }

  async refundsOn(ticketIds: readonly string[], since: Date, tx?: Tx): Promise<EntryRecord[]> {
    if (ticketIds.length === 0) return [];
    return (await this.db(tx).supportTicketEntry.findMany({ where: { ticketId: { in: [...ticketIds] }, kind: 'refund', at: { gte: since } } })).map(entryFrom);
  }

  async lockCustomer(customerId: string, tx?: Tx): Promise<void> {
    if (!tx) throw new Error('lockCustomer needs a transaction');
    const key = `support.refund:${customerId}`;
    await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS l`;
  }

  async blankWrittenBy(actorId: string): Promise<void> {
    await this.db().supportTicketEntry.updateMany({ where: { actorId }, data: { text: '' } });
  }
}
