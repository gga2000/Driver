import { randomUUID } from 'node:crypto';
import { EtaBasis, VehicleClass } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { cellId, nextEwma, type EtaCell, type EtaCellKey } from './eta-learning.js';

/** One finished leg as learned (`eta_samples`): zones and minutes, no positions. */
export interface EtaSampleRecord {
  stopId: string;
  tripId: string;
  cityId: string;
  fromZone: string;
  toZone: string;
  hourBucket: number;
  vehicleClass: VehicleClass;
  basis: EtaBasis;
  predictedMin: number;
  actualMin: number;
  startedAt: Date;
  arrivedAt: Date;
}

/** actual ÷ predicted: what one leg says about its streets. */
export const ratioOf = (s: Pick<EtaSampleRecord, 'actualMin' | 'predictedMin'>): number => s.actualMin / s.predictedMin;

export interface EtaCorrectionsRepository {
  /**
   * Records the leg (once per stop) and folds its ratio into each of `cells` by EWMA, in one
   * transaction. False — and nothing written — when this stop was already learned: an outbox
   * redelivery never counts a leg twice.
   */
  learn(sample: EtaSampleRecord, cells: readonly EtaCellKey[], alpha: number, tx?: Tx): Promise<boolean>;
  /** Every cell of a city: zone pairs × buckets × vehicles, a few thousand rows at most. */
  cells(cityId: string): Promise<EtaCell[]>;
}

export const ETA_CORRECTIONS_REPOSITORY = Symbol('ETA_CORRECTIONS_REPOSITORY');

/** Tests, the simulator and the studio's demo API: learning starts again on restart. */
export class InMemoryEtaCorrectionsRepository implements EtaCorrectionsRepository {
  private readonly learned = new Set<string>();
  private readonly byCell = new Map<string, EtaCell>();

  async learn(sample: EtaSampleRecord, cells: readonly EtaCellKey[], alpha: number): Promise<boolean> {
    if (this.learned.has(sample.stopId)) return false;
    this.learned.add(sample.stopId);
    const ratio = ratioOf(sample);
    for (const key of cells) {
      const id = cellId(key);
      const prev = this.byCell.get(id) ?? null;
      const next = nextEwma(prev, ratio, alpha);
      const last = prev && prev.lastSampleAt.getTime() > sample.arrivedAt.getTime() ? prev.lastSampleAt : sample.arrivedAt;
      this.byCell.set(id, { ...key, ...next, lastSampleAt: last });
    }
    return true;
  }

  async cells(cityId: string): Promise<EtaCell[]> {
    return [...this.byCell.values()].filter((c) => c.cityId === cityId).map((c) => ({ ...c }));
  }
}

/** Postgres (`eta_corrections`, `eta_samples`; migration 20261007105000_eta_corrections). */
export class PrismaEtaCorrectionsRepository implements EtaCorrectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async learn(sample: EtaSampleRecord, cells: readonly EtaCellKey[], alpha: number, tx?: Tx): Promise<boolean> {
    if (tx) return this.learnIn(tx, sample, cells, alpha);
    return this.prisma.prisma.$transaction((t) => this.learnIn(t, sample, cells, alpha));
  }

  private async learnIn(db: Tx, sample: EtaSampleRecord, cells: readonly EtaCellKey[], alpha: number): Promise<boolean> {
    const now = new Date();
    // skipDuplicates (ON CONFLICT DO NOTHING) instead of catching a unique violation: inside the
    // subscriber's transaction a failed INSERT would abort everything else it wrote.
    const { count } = await db.etaSample.createMany({ data: [{ ...sample, updatedAt: now }], skipDuplicates: true });
    if (count === 0) return false;
    const ratio = ratioOf(sample);
    for (const k of cells) {
      // The same step as `nextEwma`, done by the row itself so two legs landing at once both count.
      await db.$executeRaw`
        INSERT INTO "public"."eta_corrections" (id, city_id, from_zone, to_zone, hour_bucket, vehicle_class, basis, factor, samples, last_sample_at, created_at, updated_at)
        VALUES (${randomUUID()}, ${k.cityId}, ${k.fromZone}, ${k.toZone}, ${k.hourBucket}, ${k.vehicleClass}, ${k.basis}, ${ratio}, 1, ${sample.arrivedAt}, ${now}, ${now})
        ON CONFLICT (city_id, from_zone, to_zone, hour_bucket, vehicle_class, basis) DO UPDATE SET
          factor = "eta_corrections".factor + ${alpha} * (EXCLUDED.factor - "eta_corrections".factor),
          samples = "eta_corrections".samples + 1,
          last_sample_at = GREATEST("eta_corrections".last_sample_at, EXCLUDED.last_sample_at),
          updated_at = EXCLUDED.updated_at`;
    }
    return true;
  }

  async cells(cityId: string): Promise<EtaCell[]> {
    const rows = await this.db().etaCorrection.findMany({ where: { cityId } });
    // Rows are only written by `learn`; a value outside the enums would be a hand edit, and is skipped.
    return rows.flatMap((r) => {
      const vehicle = VehicleClass.safeParse(r.vehicleClass);
      const basis = EtaBasis.safeParse(r.basis);
      if (!vehicle.success || !basis.success) return [];
      return [{ cityId: r.cityId, fromZone: r.fromZone, toZone: r.toZone, hourBucket: r.hourBucket, vehicleClass: vehicle.data, basis: basis.data, factor: r.factor, samples: r.samples, lastSampleAt: r.lastSampleAt }];
    });
  }
}
