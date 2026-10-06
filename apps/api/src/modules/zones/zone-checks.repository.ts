import { ZoneCheckAnswer } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** One «انت بمنطقة X؟» question as stored (pseudonymous: person ids only). */
export interface ZoneCheckRecord {
  id: string;
  cityId: string;
  zoneKey: string;
  /** The zone's `placedAt` when asked: answers count only for the outline the driver was asked about. */
  outlineAt: Date;
  driverId: string;
  tripId: string;
  stopId: string;
  askedAt: Date;
  answer: ZoneCheckAnswer | null;
  answeredAt: Date | null;
}

/** A zone's outline version: its key and when it was last placed. */
export interface ZoneOutline {
  zoneKey: string;
  outlineAt: Date;
}

export type NewZoneCheck = Omit<ZoneCheckRecord, 'answer' | 'answeredAt'>;

/** One answered check, reduced to what the tally needs. */
export interface ZoneCheckAnswerRow {
  zoneKey: string;
  outlineAt: Date;
  driverId: string;
  answer: ZoneCheckAnswer;
  answeredAt: Date;
}

export interface ZoneChecksRepository {
  /** False when the stop already has its question (the unique stop id): one question per drop-off. */
  create(input: NewZoneCheck, tx?: Tx): Promise<boolean>;
  get(id: string, tx?: Tx): Promise<ZoneCheckRecord | null>;
  /** How many questions this driver was asked since `since` (the per-day rule). */
  askedSince(driverId: string, since: Date, tx?: Tx): Promise<number>;
  /** His newest unanswered question asked after `since`, or null. */
  openFor(driverId: string, since: Date, tx?: Tx): Promise<ZoneCheckRecord | null>;
  /** Records the answer only if there is none yet (first answer wins); false otherwise. */
  answer(id: string, answer: ZoneCheckAnswer, at: Date, tx?: Tx): Promise<boolean>;
  /** The answered checks about these outlines (zone + `placedAt`): older outlines' answers no longer count. */
  answers(cityId: string, outlines: readonly ZoneOutline[], tx?: Tx): Promise<ZoneCheckAnswerRow[]>;
}

export const ZONE_CHECKS_REPOSITORY = Symbol('ZONE_CHECKS_REPOSITORY');

const copy = (r: ZoneCheckRecord): ZoneCheckRecord => ({ ...r });

/** Tests, the simulator and the studio's demo API: questions forgotten on restart. */
export class InMemoryZoneChecksRepository implements ZoneChecksRepository {
  private readonly rows = new Map<string, ZoneCheckRecord>();

  async create(input: NewZoneCheck): Promise<boolean> {
    if ([...this.rows.values()].some((r) => r.stopId === input.stopId)) return false;
    this.rows.set(input.id, { ...input, answer: null, answeredAt: null });
    return true;
  }

  async get(id: string): Promise<ZoneCheckRecord | null> {
    const r = this.rows.get(id);
    return r ? copy(r) : null;
  }

  async askedSince(driverId: string, since: Date): Promise<number> {
    return [...this.rows.values()].filter((r) => r.driverId === driverId && r.askedAt.getTime() >= since.getTime()).length;
  }

  async openFor(driverId: string, since: Date): Promise<ZoneCheckRecord | null> {
    const open = [...this.rows.values()]
      .filter((r) => r.driverId === driverId && r.answer === null && r.askedAt.getTime() > since.getTime())
      .sort((a, b) => b.askedAt.getTime() - a.askedAt.getTime());
    return open[0] ? copy(open[0]) : null;
  }

  async answer(id: string, answer: ZoneCheckAnswer, at: Date): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.answer !== null) return false;
    this.rows.set(id, { ...r, answer, answeredAt: at });
    return true;
  }

  async answers(cityId: string, outlines: readonly ZoneOutline[]): Promise<ZoneCheckAnswerRow[]> {
    const wanted = new Set(outlines.map((o) => `${o.zoneKey}|${o.outlineAt.getTime()}`));
    return [...this.rows.values()].flatMap((r) =>
      r.cityId === cityId && wanted.has(`${r.zoneKey}|${r.outlineAt.getTime()}`) && r.answer !== null && r.answeredAt !== null
        ? [{ zoneKey: r.zoneKey, outlineAt: r.outlineAt, driverId: r.driverId, answer: r.answer, answeredAt: r.answeredAt }]
        : [],
    );
  }
}

const FIELDS = { id: true, cityId: true, zoneKey: true, outlineAt: true, driverId: true, tripId: true, stopId: true, askedAt: true, answer: true, answeredAt: true } as const;

function fromRow(r: Omit<ZoneCheckRecord, 'answer'> & { answer: string | null }): ZoneCheckRecord {
  return { ...r, answer: r.answer === null ? null : ZoneCheckAnswer.parse(r.answer) };
}

/** Postgres (`zone_checks`, migration 20261006181000_zone_checks). */
export class PrismaZoneChecksRepository implements ZoneChecksRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async create(input: NewZoneCheck, tx?: Tx): Promise<boolean> {
    // skipDuplicates (ON CONFLICT DO NOTHING) instead of catching a unique violation: inside the
    // subscriber's transaction a failed INSERT would abort everything else it wrote.
    const { count } = await this.db(tx).zoneCheck.createMany({ data: [{ ...input, updatedAt: input.askedAt }], skipDuplicates: true });
    return count > 0;
  }

  async get(id: string, tx?: Tx): Promise<ZoneCheckRecord | null> {
    const r = await this.db(tx).zoneCheck.findUnique({ where: { id }, select: FIELDS });
    return r ? fromRow(r) : null;
  }

  async askedSince(driverId: string, since: Date, tx?: Tx): Promise<number> {
    return this.db(tx).zoneCheck.count({ where: { driverId, askedAt: { gte: since } } });
  }

  async openFor(driverId: string, since: Date, tx?: Tx): Promise<ZoneCheckRecord | null> {
    const r = await this.db(tx).zoneCheck.findFirst({ where: { driverId, answer: null, askedAt: { gt: since } }, orderBy: { askedAt: 'desc' }, select: FIELDS });
    return r ? fromRow(r) : null;
  }

  async answer(id: string, answer: ZoneCheckAnswer, at: Date, tx?: Tx): Promise<boolean> {
    // Conditional update: two racing taps keep the first answer.
    const { count } = await this.db(tx).zoneCheck.updateMany({ where: { id, answer: null }, data: { answer, answeredAt: at, updatedAt: at } });
    return count > 0;
  }

  async answers(cityId: string, outlines: readonly ZoneOutline[], tx?: Tx): Promise<ZoneCheckAnswerRow[]> {
    if (outlines.length === 0) return [];
    const rows = await this.db(tx).zoneCheck.findMany({
      where: { cityId, OR: outlines.map((o) => ({ zoneKey: o.zoneKey, outlineAt: o.outlineAt })), answer: { not: null }, answeredAt: { not: null } },
      select: { zoneKey: true, outlineAt: true, driverId: true, answer: true, answeredAt: true },
    });
    return rows.flatMap((r) => (r.answer !== null && r.answeredAt !== null ? [{ zoneKey: r.zoneKey, outlineAt: r.outlineAt, driverId: r.driverId, answer: ZoneCheckAnswer.parse(r.answer), answeredAt: r.answeredAt }] : []));
  }
}
