import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

export type AccessState = 'waiting' | 'admitted';
/** open: no wave in the zone · wave: let in by the zone's wave · existing: ordered before waves · staff. */
export type AccessReason = 'open' | 'wave' | 'existing' | 'staff';

/** `customer_access`: one row per customer once their place in line is decided. */
export interface AccessRecord {
  personId: string;
  cityId: string;
  zoneKey: string | null;
  state: AccessState;
  reason: AccessReason;
  joinedAt: Date;
  admittedAt: Date | null;
}

/** `ops_zone_waves`: how many customers a zone lets in; `openSlots` null = open to everyone. */
export interface WaveRecord {
  cityId: string;
  zoneKey: string;
  openSlots: number | null;
  setById: string;
  setAt: Date;
}

export interface AccessRepository {
  get(personId: string, tx?: Tx): Promise<AccessRecord | null>;
  /** Writes the whole row (insert or replace). */
  put(rec: AccessRecord, tx?: Tx): Promise<void>;
  waves(cityId: string, tx?: Tx): Promise<WaveRecord[]>;
  upsertWave(rec: WaveRecord, tx?: Tx): Promise<WaveRecord>;
  /** People let in, per zone (null = no zone). */
  admittedByZone(cityId: string, tx?: Tx): Promise<Map<string | null, number>>;
  /** People waiting, per zone (null = no zone). */
  waitingByZone(cityId: string, tx?: Tx): Promise<Map<string | null, number>>;
  /** Waiting in the same city and zone who joined before `joinedAt` (ties: smaller person id first). */
  waitingAhead(
    cityId: string,
    zoneKey: string | null,
    joinedAt: Date,
    personId: string,
    tx?: Tx,
  ): Promise<number>;
  /** The longest-waiting in a zone, oldest first. */
  oldestWaiting(
    cityId: string,
    zoneKey: string | null,
    limit: number,
    tx?: Tx,
  ): Promise<AccessRecord[]>;
  /** Every city and zone with someone waiting. */
  waitingZones(): Promise<Array<{ cityId: string; zoneKey: string | null }>>;
}

export const ACCESS_REPOSITORY = Symbol('ACCESS_REPOSITORY');

const before = (
  a: { joinedAt: Date; personId: string },
  joinedAt: Date,
  personId: string,
): boolean =>
  a.joinedAt.getTime() < joinedAt.getTime() ||
  (a.joinedAt.getTime() === joinedAt.getTime() && a.personId < personId);

export class InMemoryAccessRepository implements AccessRepository {
  readonly rows = new Map<string, AccessRecord>();
  readonly waveRows = new Map<string, WaveRecord>();

  async get(personId: string): Promise<AccessRecord | null> {
    const r = this.rows.get(personId);
    return r ? { ...r } : null;
  }

  async put(rec: AccessRecord): Promise<void> {
    this.rows.set(rec.personId, { ...rec });
  }

  async waves(cityId: string): Promise<WaveRecord[]> {
    return [...this.waveRows.values()].filter((w) => w.cityId === cityId).map((w) => ({ ...w }));
  }

  async upsertWave(rec: WaveRecord): Promise<WaveRecord> {
    this.waveRows.set(`${rec.cityId}:${rec.zoneKey}`, { ...rec });
    return { ...rec };
  }

  async admittedByZone(cityId: string): Promise<Map<string | null, number>> {
    return this.countBy(cityId, 'admitted');
  }

  async waitingByZone(cityId: string): Promise<Map<string | null, number>> {
    return this.countBy(cityId, 'waiting');
  }

  async waitingAhead(
    cityId: string,
    zoneKey: string | null,
    joinedAt: Date,
    personId: string,
  ): Promise<number> {
    return [...this.rows.values()].filter(
      (r) =>
        r.cityId === cityId &&
        r.zoneKey === zoneKey &&
        r.state === 'waiting' &&
        before(r, joinedAt, personId),
    ).length;
  }

  async oldestWaiting(
    cityId: string,
    zoneKey: string | null,
    limit: number,
  ): Promise<AccessRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.cityId === cityId && r.zoneKey === zoneKey && r.state === 'waiting')
      .sort(
        (a, b) =>
          a.joinedAt.getTime() - b.joinedAt.getTime() || a.personId.localeCompare(b.personId),
      )
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async waitingZones(): Promise<Array<{ cityId: string; zoneKey: string | null }>> {
    const seen = new Map<string, { cityId: string; zoneKey: string | null }>();
    for (const r of this.rows.values())
      if (r.state === 'waiting')
        seen.set(`${r.cityId}:${r.zoneKey ?? ''}`, { cityId: r.cityId, zoneKey: r.zoneKey });
    return [...seen.values()];
  }

  private countBy(cityId: string, state: AccessState): Map<string | null, number> {
    const out = new Map<string | null, number>();
    for (const r of this.rows.values())
      if (r.cityId === cityId && r.state === state)
        out.set(r.zoneKey, (out.get(r.zoneKey) ?? 0) + 1);
    return out;
  }
}

type AccessRow = {
  personId: string;
  cityId: string;
  zoneKey: string | null;
  state: string;
  reason: string;
  joinedAt: Date;
  admittedAt: Date | null;
};
const accessFrom = (r: AccessRow): AccessRecord => ({
  personId: r.personId,
  cityId: r.cityId,
  zoneKey: r.zoneKey,
  state: r.state as AccessState,
  reason: r.reason as AccessReason,
  joinedAt: r.joinedAt,
  admittedAt: r.admittedAt,
});
const waveFrom = (r: WaveRecord): WaveRecord => ({
  cityId: r.cityId,
  zoneKey: r.zoneKey,
  openSlots: r.openSlots,
  setById: r.setById,
  setAt: r.setAt,
});

export class PrismaAccessRepository implements AccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async get(personId: string, tx?: Tx): Promise<AccessRecord | null> {
    const r = await this.db(tx).customerAccess.findUnique({ where: { personId } });
    return r ? accessFrom(r) : null;
  }

  async put(rec: AccessRecord, tx?: Tx): Promise<void> {
    const { personId, ...rest } = rec;
    await this.db(tx).customerAccess.upsert({ where: { personId }, create: rec, update: rest });
  }

  async waves(cityId: string, tx?: Tx): Promise<WaveRecord[]> {
    return (await this.db(tx).opsZoneWave.findMany({ where: { cityId } })).map(waveFrom);
  }

  async upsertWave(rec: WaveRecord, tx?: Tx): Promise<WaveRecord> {
    const { cityId, zoneKey, ...rest } = rec;
    return waveFrom(
      await this.db(tx).opsZoneWave.upsert({
        where: { cityId_zoneKey: { cityId, zoneKey } },
        create: rec,
        update: rest,
      }),
    );
  }

  async admittedByZone(cityId: string, tx?: Tx): Promise<Map<string | null, number>> {
    return this.countBy(cityId, 'admitted', tx);
  }

  async waitingByZone(cityId: string, tx?: Tx): Promise<Map<string | null, number>> {
    return this.countBy(cityId, 'waiting', tx);
  }

  async waitingAhead(
    cityId: string,
    zoneKey: string | null,
    joinedAt: Date,
    personId: string,
    tx?: Tx,
  ): Promise<number> {
    return this.db(tx).customerAccess.count({
      where: {
        cityId,
        zoneKey,
        state: 'waiting',
        OR: [{ joinedAt: { lt: joinedAt } }, { joinedAt, personId: { lt: personId } }],
      },
    });
  }

  async oldestWaiting(
    cityId: string,
    zoneKey: string | null,
    limit: number,
    tx?: Tx,
  ): Promise<AccessRecord[]> {
    return (
      await this.db(tx).customerAccess.findMany({
        where: { cityId, zoneKey, state: 'waiting' },
        orderBy: [{ joinedAt: 'asc' }, { personId: 'asc' }],
        take: limit,
      })
    ).map(accessFrom);
  }

  async waitingZones(): Promise<Array<{ cityId: string; zoneKey: string | null }>> {
    return (
      await this.db().customerAccess.groupBy({
        by: ['cityId', 'zoneKey'],
        where: { state: 'waiting' },
      })
    ).map((g) => ({ cityId: g.cityId, zoneKey: g.zoneKey }));
  }

  private async countBy(
    cityId: string,
    state: AccessState,
    tx?: Tx,
  ): Promise<Map<string | null, number>> {
    const rows = await this.db(tx).customerAccess.groupBy({
      by: ['zoneKey'],
      where: { cityId, state },
      _count: { _all: true },
    });
    return new Map(rows.map((g) => [g.zoneKey, g._count._all]));
  }
}
