import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** `handover_notes` with its readers (`handover_acks`). */
export interface HandoverRecord {
  id: string;
  cityId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  /** Who tapped «وصلت». */
  ackedBy: string[];
}

export interface HandoverRepository {
  add(input: { cityId: string; authorId: string; body: string }, at: Date, tx?: Tx): Promise<HandoverRecord>;
  /** The city's newest note written at or after `since`, or null. */
  latest(cityId: string, since: Date): Promise<HandoverRecord | null>;
  find(id: string, tx?: Tx): Promise<HandoverRecord | null>;
  /** Marks it read by this person (a second tap changes nothing). */
  ack(id: string, personId: string, at: Date, tx?: Tx): Promise<void>;
}

export const HANDOVER_REPOSITORY = Symbol('HANDOVER_REPOSITORY');

const newId = () => `hnd_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

export class InMemoryHandoverRepository implements HandoverRepository {
  private readonly notes = new Map<string, HandoverRecord>();

  async add(input: { cityId: string; authorId: string; body: string }, at: Date): Promise<HandoverRecord> {
    const rec: HandoverRecord = { id: newId(), ...input, createdAt: at, ackedBy: [] };
    this.notes.set(rec.id, rec);
    return { ...rec, ackedBy: [] };
  }
  async latest(cityId: string, since: Date): Promise<HandoverRecord | null> {
    let best: HandoverRecord | null = null;
    for (const n of this.notes.values())
      if (n.cityId === cityId && n.createdAt.getTime() >= since.getTime() && (!best || n.createdAt.getTime() >= best.createdAt.getTime()))
        best = n;
    return best ? { ...best, ackedBy: [...best.ackedBy] } : null;
  }
  async find(id: string): Promise<HandoverRecord | null> {
    const n = this.notes.get(id);
    return n ? { ...n, ackedBy: [...n.ackedBy] } : null;
  }
  async ack(id: string, personId: string): Promise<void> {
    const n = this.notes.get(id);
    if (n && !n.ackedBy.includes(personId)) n.ackedBy.push(personId);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma row ↔ record mapping */
const recordFrom = (r: any): HandoverRecord => ({
  id: r.id,
  cityId: r.cityId,
  authorId: r.authorId,
  body: r.body,
  createdAt: r.createdAt,
  ackedBy: (r.acks ?? []).map((a: any) => a.personId as string),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export class PrismaHandoverRepository implements HandoverRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async add(input: { cityId: string; authorId: string; body: string }, at: Date, tx?: Tx): Promise<HandoverRecord> {
    const row = await this.db(tx).handoverNote.create({ data: { id: newId(), ...input, createdAt: at } });
    return recordFrom(row);
  }
  async latest(cityId: string, since: Date): Promise<HandoverRecord | null> {
    const row = await this.db().handoverNote.findFirst({
      where: { cityId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      include: { acks: { select: { personId: true } } },
    });
    return row ? recordFrom(row) : null;
  }
  async find(id: string, tx?: Tx): Promise<HandoverRecord | null> {
    const row = await this.db(tx).handoverNote.findUnique({
      where: { id },
      include: { acks: { select: { personId: true } } },
    });
    return row ? recordFrom(row) : null;
  }
  async ack(id: string, personId: string, at: Date, tx?: Tx): Promise<void> {
    // ON CONFLICT DO NOTHING: a second tap must not abort the caller's transaction.
    await this.db(tx).handoverAck.createMany({
      data: [{ noteId: id, personId, ackedAt: at }],
      skipDuplicates: true,
    });
  }
}
