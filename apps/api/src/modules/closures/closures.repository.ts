import type { ClosureReason, ClosureSource, LatLng } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** `street_closures`: one closed stretch of street for one day (N20). */
export interface ClosureRecord {
  id: string;
  cityId: string;
  path: LatLng[];
  reason: ClosureReason;
  nameAr: string | null;
  lengthM: number;
  startsAt: Date;
  endsAt: Date;
  closedById: string;
  openedAt: Date | null;
  openedById: string | null;
  /** ops = closed on the Console; courier = reported from the road (routes nothing until confirmed). */
  source: ClosureSource;
  confirmedAt: Date | null;
  confirmedById: string | null;
}

export type NewClosure = Omit<ClosureRecord, 'id' | 'openedAt' | 'openedById' | 'confirmedAt' | 'confirmedById'>;

export interface ClosuresRepository {
  create(input: NewClosure, tx?: Tx): Promise<ClosureRecord>;
  get(id: string, tx?: Tx): Promise<ClosureRecord | null>;
  /** Closed now in every city and routed around: not opened early, not past its end, ops or confirmed. */
  live(now: Date, tx?: Tx): Promise<ClosureRecord[]>;
  /** Couriers' reports still waiting in a city (not confirmed, not opened, not past their end). */
  waiting(cityId: string, now: Date, tx?: Tx): Promise<ClosureRecord[]>;
  /** One person's reports since `since` (the day's cap). */
  reportsBy(personId: string, since: Date, tx?: Tx): Promise<ClosureRecord[]>;
  /** Confirm a waiting report until `endsAt`; a second confirm keeps the first. */
  confirm(id: string, by: string, at: Date, endsAt: Date, tx?: Tx): Promise<ClosureRecord>;
  /** A city's closures that end after `since` (today's list in the Console), newest first. */
  endingAfter(cityId: string, since: Date, tx?: Tx): Promise<ClosureRecord[]>;
  open(id: string, by: string, at: Date, tx?: Tx): Promise<ClosureRecord>;
}

export const CLOSURES_REPOSITORY = Symbol('CLOSURES_REPOSITORY');

const isOpenNow = (c: ClosureRecord, now: Date) => c.openedAt === null && c.startsAt.getTime() <= now.getTime() && c.endsAt.getTime() > now.getTime();
const isLive = (c: ClosureRecord, now: Date) => isOpenNow(c, now) && (c.source === 'ops' || c.confirmedAt !== null);

export class InMemoryClosuresRepository implements ClosuresRepository {
  private readonly rows = new Map<string, ClosureRecord>();
  private seq = 0;

  async create(input: NewClosure): Promise<ClosureRecord> {
    const row: ClosureRecord = { ...input, path: [...input.path], id: `cls_${++this.seq}`, openedAt: null, openedById: null, confirmedAt: null, confirmedById: null };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async get(id: string): Promise<ClosureRecord | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  async live(now: Date): Promise<ClosureRecord[]> {
    return [...this.rows.values()].filter((c) => isLive(c, now)).map((c) => ({ ...c }));
  }

  async waiting(cityId: string, now: Date): Promise<ClosureRecord[]> {
    return [...this.rows.values()].filter((c) => c.cityId === cityId && c.source === 'courier' && c.confirmedAt === null && isOpenNow(c, now)).map((c) => ({ ...c }));
  }

  async reportsBy(personId: string, since: Date): Promise<ClosureRecord[]> {
    return [...this.rows.values()].filter((c) => c.source === 'courier' && c.closedById === personId && c.startsAt.getTime() >= since.getTime()).map((c) => ({ ...c }));
  }

  async confirm(id: string, by: string, at: Date, endsAt: Date): Promise<ClosureRecord> {
    const r = this.rows.get(id);
    if (!r) throw new Error(`closure ${id} not found`);
    if (r.confirmedAt === null) {
      r.confirmedAt = at;
      r.confirmedById = by;
      r.endsAt = endsAt;
    }
    return { ...r };
  }

  async endingAfter(cityId: string, since: Date): Promise<ClosureRecord[]> {
    return [...this.rows.values()]
      .filter((c) => c.cityId === cityId && c.endsAt.getTime() > since.getTime())
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
      .map((c) => ({ ...c }));
  }

  async open(id: string, by: string, at: Date): Promise<ClosureRecord> {
    const r = this.rows.get(id);
    if (!r) throw new Error(`closure ${id} not found`);
    if (r.openedAt === null) {
      r.openedAt = at;
      r.openedById = by;
    }
    return { ...r };
  }
}

type Row = {
  id: string;
  cityId: string;
  path: unknown;
  reason: string;
  nameAr: string | null;
  lengthM: number;
  startsAt: Date;
  endsAt: Date;
  closedById: string;
  openedAt: Date | null;
  openedById: string | null;
  source: string;
  confirmedAt: Date | null;
  confirmedById: string | null;
};

function fromRow(r: Row): ClosureRecord {
  const path = Array.isArray(r.path) ? (r.path as Array<{ lat: number; lng: number }>).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })) : [];
  return { id: r.id, cityId: r.cityId, path, reason: r.reason as ClosureReason, nameAr: r.nameAr, lengthM: r.lengthM, startsAt: r.startsAt, endsAt: r.endsAt, closedById: r.closedById, openedAt: r.openedAt, openedById: r.openedById, source: r.source === 'courier' ? 'courier' : 'ops', confirmedAt: r.confirmedAt, confirmedById: r.confirmedById };
}

export class PrismaClosuresRepository implements ClosuresRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async create(input: NewClosure, tx?: Tx): Promise<ClosureRecord> {
    return fromRow(await this.db(tx).streetClosure.create({ data: { ...input, path: input.path.map((p) => ({ lat: p.lat, lng: p.lng })) } }));
  }

  async get(id: string, tx?: Tx): Promise<ClosureRecord | null> {
    const r = await this.db(tx).streetClosure.findUnique({ where: { id } });
    return r ? fromRow(r) : null;
  }

  async live(now: Date, tx?: Tx): Promise<ClosureRecord[]> {
    return (await this.db(tx).streetClosure.findMany({ where: { openedAt: null, startsAt: { lte: now }, endsAt: { gt: now }, OR: [{ source: 'ops' }, { confirmedAt: { not: null } }] }, orderBy: { startsAt: 'asc' }, take: 500 })).map(fromRow);
  }

  async waiting(cityId: string, now: Date, tx?: Tx): Promise<ClosureRecord[]> {
    return (await this.db(tx).streetClosure.findMany({ where: { cityId, source: 'courier', confirmedAt: null, openedAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, take: 200 })).map(fromRow);
  }

  async reportsBy(personId: string, since: Date, tx?: Tx): Promise<ClosureRecord[]> {
    return (await this.db(tx).streetClosure.findMany({ where: { source: 'courier', closedById: personId, startsAt: { gte: since } }, take: 50 })).map(fromRow);
  }

  async confirm(id: string, by: string, at: Date, endsAt: Date, tx?: Tx): Promise<ClosureRecord> {
    // Confirming twice keeps the first (who, when, until when).
    await this.db(tx).streetClosure.updateMany({ where: { id, confirmedAt: null }, data: { confirmedAt: at, confirmedById: by, endsAt } });
    return fromRow(await this.db(tx).streetClosure.findUniqueOrThrow({ where: { id } }));
  }

  async endingAfter(cityId: string, since: Date, tx?: Tx): Promise<ClosureRecord[]> {
    return (await this.db(tx).streetClosure.findMany({ where: { cityId, endsAt: { gt: since } }, orderBy: { startsAt: 'desc' }, take: 200 })).map(fromRow);
  }

  async open(id: string, by: string, at: Date, tx?: Tx): Promise<ClosureRecord> {
    // Opening twice keeps the first opening (who and when).
    await this.db(tx).streetClosure.updateMany({ where: { id, openedAt: null }, data: { openedAt: at, openedById: by } });
    return fromRow(await this.db(tx).streetClosure.findUniqueOrThrow({ where: { id } }));
  }
}
