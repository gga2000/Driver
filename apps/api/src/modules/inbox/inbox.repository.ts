import { randomUUID } from 'node:crypto';
import type {
  InboxFacts,
  InboxItem,
  InboxKind,
  InboxOutcome,
  InboxSubjectKind,
} from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** What an event says about a problem it starts (or brings back). */
export interface InboxSighting {
  cityId: string;
  kind: InboxKind;
  subjectKind: InboxSubjectKind;
  subjectId: string;
  orderId: string | null;
  tripId: string | null;
  facts: InboxFacts;
  at: Date;
}

/** What a person (or the server) changes on a row. */
export type InboxPatch = Partial<
  Pick<
    InboxItem,
    'assigneeId' | 'assignedAt' | 'snoozedUntil' | 'doneAt' | 'doneById' | 'outcome' | 'note'
  >
>;

export interface InboxRepository {
  /**
   * Opens the row for (kind, subject) the first time; a later sighting of the same problem refreshes
   * it, and brings a closed row back only when it was closed before this sighting (a replayed event
   * never reopens what someone closed after it). `created` / `reopened` say what happened.
   */
  sight(
    input: InboxSighting,
    tx?: Tx,
  ): Promise<{ item: InboxItem; created: boolean; reopened: boolean }>;
  get(id: string, tx?: Tx): Promise<InboxItem | null>;
  bySubject(kind: InboxKind, subjectId: string, tx?: Tx): Promise<InboxItem | null>;
  /** Open rows touching this order or trip (kinds optional). */
  openFor(
    match: { orderId?: string | null; tripId?: string | null; kinds?: readonly InboxKind[] },
    tx?: Tx,
  ): Promise<InboxItem[]>;
  /** Open rows of the city (snoozed included), and rows closed at or after `doneSince`. */
  forCity(cityId: string, doneSince: Date, limit: number, tx?: Tx): Promise<InboxItem[]>;
  /** Changes a row only while it is still open (`doneAt` null): the changed row, or null. */
  updateOpen(id: string, patch: InboxPatch, tx?: Tx): Promise<InboxItem | null>;
}

export const INBOX_REPOSITORY = Symbol('INBOX_REPOSITORY');

const newId = () => `inb_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

function reopenPatch(input: InboxSighting, prev: InboxItem): Partial<InboxItem> {
  return {
    lastSeenAt: input.at,
    times: prev.times + 1,
    facts: { ...prev.facts, ...input.facts },
    orderId: prev.orderId ?? input.orderId,
    tripId: prev.tripId ?? input.tripId,
    doneAt: null,
    doneById: null,
    outcome: null,
    snoozedUntil: null,
    assigneeId: null,
    assignedAt: null,
  };
}

export class InMemoryInboxRepository implements InboxRepository {
  private readonly rows = new Map<string, InboxItem>();
  private key = (kind: string, subjectId: string) => `${kind}:${subjectId}`;
  private readonly byKey = new Map<string, string>();

  async sight(
    input: InboxSighting,
  ): Promise<{ item: InboxItem; created: boolean; reopened: boolean }> {
    const id = this.byKey.get(this.key(input.kind, input.subjectId));
    const prev = id ? this.rows.get(id) : undefined;
    if (!prev) {
      const item: InboxItem = {
        id: newId(),
        cityId: input.cityId,
        kind: input.kind,
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        orderId: input.orderId,
        tripId: input.tripId,
        facts: { ...input.facts },
        openedAt: input.at,
        lastSeenAt: input.at,
        times: 1,
        assigneeId: null,
        assignedAt: null,
        snoozedUntil: null,
        doneAt: null,
        doneById: null,
        outcome: null,
        note: null,
      };
      this.rows.set(item.id, item);
      this.byKey.set(this.key(input.kind, input.subjectId), item.id);
      return { item: structuredClone(item), created: true, reopened: false };
    }
    if (prev.doneAt && prev.doneAt.getTime() < input.at.getTime()) {
      Object.assign(prev, reopenPatch(input, prev));
      return { item: structuredClone(prev), created: false, reopened: true };
    }
    if (!prev.doneAt && input.at.getTime() > prev.lastSeenAt.getTime()) {
      prev.lastSeenAt = input.at;
      prev.facts = { ...prev.facts, ...input.facts };
    }
    return { item: structuredClone(prev), created: false, reopened: false };
  }
  async get(id: string): Promise<InboxItem | null> {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }
  async bySubject(kind: InboxKind, subjectId: string): Promise<InboxItem | null> {
    const id = this.byKey.get(this.key(kind, subjectId));
    return id ? this.get(id) : null;
  }
  async openFor(match: {
    orderId?: string | null;
    tripId?: string | null;
    kinds?: readonly InboxKind[];
  }): Promise<InboxItem[]> {
    return [...this.rows.values()]
      .filter(
        (r) =>
          r.doneAt === null &&
          (!match.kinds || match.kinds.includes(r.kind)) &&
          ((match.orderId && r.orderId === match.orderId) ||
            (match.tripId && r.tripId === match.tripId)),
      )
      .map((r) => structuredClone(r));
  }
  async forCity(cityId: string, doneSince: Date, limit: number): Promise<InboxItem[]> {
    return [...this.rows.values()]
      .filter(
        (r) =>
          r.cityId === cityId && (r.doneAt === null || r.doneAt.getTime() >= doneSince.getTime()),
      )
      .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())
      .slice(0, limit)
      .map((r) => structuredClone(r));
  }
  async updateOpen(id: string, patch: InboxPatch): Promise<InboxItem | null> {
    const r = this.rows.get(id);
    if (!r || r.doneAt) return null;
    Object.assign(r, patch);
    return structuredClone(r);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma row ↔ record mapping */
const itemFrom = (r: any): InboxItem => ({
  id: r.id,
  cityId: r.cityId,
  kind: r.kind,
  subjectKind: r.subjectKind,
  subjectId: r.subjectId,
  orderId: r.orderId,
  tripId: r.tripId,
  facts: r.facts && typeof r.facts === 'object' ? r.facts : {},
  openedAt: r.openedAt,
  lastSeenAt: r.lastSeenAt,
  times: r.times,
  assigneeId: r.assigneeId,
  assignedAt: r.assignedAt,
  snoozedUntil: r.snoozedUntil,
  doneAt: r.doneAt,
  doneById: r.doneById,
  outcome: (r.outcome as InboxOutcome | null) ?? null,
  note: r.note,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export class PrismaInboxRepository implements InboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async sight(
    input: InboxSighting,
    tx?: Tx,
  ): Promise<{ item: InboxItem; created: boolean; reopened: boolean }> {
    const db = this.db(tx);
    const where = { kind_subjectId: { kind: input.kind, subjectId: input.subjectId } };
    // First sighting: insert, and let a racing twin lose quietly (unique kind + subject).
    const made = await db.inboxItem.createMany({
      data: [
        {
          id: newId(),
          cityId: input.cityId,
          kind: input.kind,
          subjectKind: input.subjectKind,
          subjectId: input.subjectId,
          orderId: input.orderId,
          tripId: input.tripId,
          facts: input.facts,
          openedAt: input.at,
          lastSeenAt: input.at,
        },
      ],
      skipDuplicates: true,
    });
    if (made.count === 1)
      return {
        item: itemFrom(await db.inboxItem.findUniqueOrThrow({ where })),
        created: true,
        reopened: false,
      };
    const prev = itemFrom(await db.inboxItem.findUniqueOrThrow({ where }));
    if (prev.doneAt && prev.doneAt.getTime() < input.at.getTime()) {
      const res = await db.inboxItem.updateMany({
        where: { id: prev.id, doneAt: prev.doneAt },
        data: reopenPatch(input, prev),
      });
      return {
        item: itemFrom(await db.inboxItem.findUniqueOrThrow({ where })),
        created: false,
        reopened: res.count === 1,
      };
    }
    if (!prev.doneAt && input.at.getTime() > prev.lastSeenAt.getTime()) {
      await db.inboxItem.updateMany({
        where: { id: prev.id, lastSeenAt: { lt: input.at } },
        data: { lastSeenAt: input.at, facts: { ...prev.facts, ...input.facts } },
      });
      return {
        item: itemFrom(await db.inboxItem.findUniqueOrThrow({ where })),
        created: false,
        reopened: false,
      };
    }
    return { item: prev, created: false, reopened: false };
  }
  async get(id: string, tx?: Tx): Promise<InboxItem | null> {
    const r = await this.db(tx).inboxItem.findUnique({ where: { id } });
    return r ? itemFrom(r) : null;
  }
  async bySubject(kind: InboxKind, subjectId: string, tx?: Tx): Promise<InboxItem | null> {
    const r = await this.db(tx).inboxItem.findUnique({
      where: { kind_subjectId: { kind, subjectId } },
    });
    return r ? itemFrom(r) : null;
  }
  async openFor(
    match: { orderId?: string | null; tripId?: string | null; kinds?: readonly InboxKind[] },
    tx?: Tx,
  ): Promise<InboxItem[]> {
    const or = [
      ...(match.orderId ? [{ orderId: match.orderId }] : []),
      ...(match.tripId ? [{ tripId: match.tripId }] : []),
    ];
    if (or.length === 0) return [];
    const rows = await this.db(tx).inboxItem.findMany({
      where: { doneAt: null, OR: or, ...(match.kinds ? { kind: { in: [...match.kinds] } } : {}) },
    });
    return rows.map(itemFrom);
  }
  async forCity(cityId: string, doneSince: Date, limit: number, tx?: Tx): Promise<InboxItem[]> {
    const rows = await this.db(tx).inboxItem.findMany({
      where: { cityId, OR: [{ doneAt: null }, { doneAt: { gte: doneSince } }] },
      orderBy: { openedAt: 'asc' },
      take: limit,
    });
    return rows.map(itemFrom);
  }
  async updateOpen(id: string, patch: InboxPatch, tx?: Tx): Promise<InboxItem | null> {
    const db = this.db(tx);
    const res = await db.inboxItem.updateMany({ where: { id, doneAt: null }, data: patch });
    if (res.count !== 1) return null;
    return itemFrom(await db.inboxItem.findUniqueOrThrow({ where: { id } }));
  }
}
