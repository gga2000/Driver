import type { AbsenceReason } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

export interface AbsenceRecord {
  id: string;
  tripId: string;
  childRef: string;
  localDate: string;
  reportedById: string;
  reason: AbsenceReason;
  note: string | null;
  skippedStopIds: string[];
  createdAt: Date;
}

/** `khat_absences`: one row per child per run. */
export interface KhatRepository {
  createAbsence(input: Omit<AbsenceRecord, 'id'>, tx?: Tx): Promise<AbsenceRecord>;
  absence(tripId: string, childRef: string, tx?: Tx): Promise<AbsenceRecord | null>;
  absencesForTrips(tripIds: readonly string[], tx?: Tx): Promise<AbsenceRecord[]>;
}

export const KHAT_REPOSITORY = Symbol('KHAT_REPOSITORY');

export class InMemoryKhatRepository implements KhatRepository {
  readonly rows: AbsenceRecord[] = [];
  private seq = 0;

  async createAbsence(input: Omit<AbsenceRecord, 'id'>): Promise<AbsenceRecord> {
    if (this.rows.some((r) => r.tripId === input.tripId && r.childRef === input.childRef)) throw new Error('unique violation: khat_absences(trip_id, child_ref)');
    this.seq += 1;
    const row = { id: `kabs_${this.seq}`, ...input, skippedStopIds: [...input.skippedStopIds] };
    this.rows.push(row);
    return { ...row };
  }

  async absence(tripId: string, childRef: string): Promise<AbsenceRecord | null> {
    const r = this.rows.find((x) => x.tripId === tripId && x.childRef === childRef);
    return r ? { ...r } : null;
  }

  async absencesForTrips(tripIds: readonly string[]): Promise<AbsenceRecord[]> {
    return this.rows.filter((r) => tripIds.includes(r.tripId)).map((r) => ({ ...r }));
  }
}

function fromRow(r: { id: string; tripId: string; childRef: string; localDate: string; reportedById: string; reason: string; note: string | null; skippedStopIds: string[]; createdAt: Date }): AbsenceRecord {
  return { ...r, reason: r.reason as AbsenceReason, skippedStopIds: [...r.skippedStopIds] };
}

export class PrismaKhatRepository implements KhatRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async createAbsence(input: Omit<AbsenceRecord, 'id'>, tx?: Tx): Promise<AbsenceRecord> {
    return fromRow(await this.db(tx).khatAbsence.create({ data: input }));
  }

  async absence(tripId: string, childRef: string, tx?: Tx): Promise<AbsenceRecord | null> {
    const r = await this.db(tx).khatAbsence.findUnique({ where: { tripId_childRef: { tripId, childRef } } });
    return r ? fromRow(r) : null;
  }

  async absencesForTrips(tripIds: readonly string[], tx?: Tx): Promise<AbsenceRecord[]> {
    if (tripIds.length === 0) return [];
    return (await this.db(tx).khatAbsence.findMany({ where: { tripId: { in: [...tripIds] } }, orderBy: { createdAt: 'asc' } })).map(fromRow);
  }
}
