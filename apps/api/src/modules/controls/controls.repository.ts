import type { BannerAudience, BannerSeverity, KillScope, ThrottleMode, Vertical } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** `ops_kill_switches`: one row per `<scope>:<key>:<vertical|*>` target in a city. */
export interface KillSwitchRecord {
  id: string;
  cityId: string;
  scope: KillScope;
  key: string;
  vertical: Vertical | null;
  target: string;
  active: boolean;
  holdDispatch: boolean;
  messageAr: string | null;
  reason: string;
  setById: string;
  setAt: Date;
  expiresAt: Date | null;
}

/** `ops_zone_capacities` */
export interface ZoneCapacityRecord {
  id: string;
  cityId: string;
  zoneKey: string;
  maxActive: number | null;
  mode: ThrottleMode;
  etaMin: number;
  setById: string;
  setAt: Date;
}

/** `system_banners` */
export interface BannerRecord {
  id: string;
  cityId: string | null;
  severity: BannerSeverity;
  audiences: BannerAudience[];
  messageAr: string;
  messageEn: string | null;
  startsAt: Date;
  expiresAt: Date;
  setById: string;
  setAt: Date;
  clearedAt: Date | null;
  clearedById: string | null;
}

/** `console_audit_log` */
export interface AuditRecord {
  id: string;
  cityId: string | null;
  actorId: string;
  action: string;
  subjectKind: string;
  subjectId: string;
  summaryAr: string;
  detail: Record<string, unknown>;
  at: Date;
}

export function targetOf(scope: KillScope, key: string, vertical: Vertical | null): string {
  return `${scope}:${key}:${vertical ?? '*'}`;
}

export interface ControlsRepository {
  switches(cityId: string, tx?: Tx): Promise<KillSwitchRecord[]>;
  upsertSwitch(input: Omit<KillSwitchRecord, 'id'>, tx?: Tx): Promise<KillSwitchRecord>;
  capacities(cityId: string, tx?: Tx): Promise<ZoneCapacityRecord[]>;
  upsertCapacity(input: Omit<ZoneCapacityRecord, 'id'>, tx?: Tx): Promise<ZoneCapacityRecord>;
  /** Banners not cleared whose window ends after `now` (current and scheduled). */
  liveBanners(now: Date, tx?: Tx): Promise<BannerRecord[]>;
  /** The most recent banners (any state), newest first. */
  recentBanners(limit: number, tx?: Tx): Promise<BannerRecord[]>;
  banner(id: string, tx?: Tx): Promise<BannerRecord | null>;
  createBanner(input: Omit<BannerRecord, 'id'>, tx?: Tx): Promise<BannerRecord>;
  clearBanner(id: string, by: string, at: Date, tx?: Tx): Promise<BannerRecord>;
  addAudit(input: Omit<AuditRecord, 'id'>, tx?: Tx): Promise<AuditRecord>;
  audit(filter: { cityId?: string | undefined; subjectKind?: string | undefined; limit: number }, tx?: Tx): Promise<AuditRecord[]>;
}

export const CONTROLS_REPOSITORY = Symbol('CONTROLS_REPOSITORY');

export class InMemoryControlsRepository implements ControlsRepository {
  readonly switchRows = new Map<string, KillSwitchRecord>();
  readonly capacityRows = new Map<string, ZoneCapacityRecord>();
  readonly bannerRows = new Map<string, BannerRecord>();
  readonly auditRows: AuditRecord[] = [];
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async switches(cityId: string): Promise<KillSwitchRecord[]> {
    return [...this.switchRows.values()].filter((s) => s.cityId === cityId).map((s) => ({ ...s }));
  }

  async upsertSwitch(input: Omit<KillSwitchRecord, 'id'>): Promise<KillSwitchRecord> {
    const k = `${input.cityId}|${input.target}`;
    const row = { ...input, id: this.switchRows.get(k)?.id ?? this.id('ks') };
    this.switchRows.set(k, row);
    return { ...row };
  }

  async capacities(cityId: string): Promise<ZoneCapacityRecord[]> {
    return [...this.capacityRows.values()].filter((c) => c.cityId === cityId).map((c) => ({ ...c }));
  }

  async upsertCapacity(input: Omit<ZoneCapacityRecord, 'id'>): Promise<ZoneCapacityRecord> {
    const k = `${input.cityId}|${input.zoneKey}`;
    const row = { ...input, id: this.capacityRows.get(k)?.id ?? this.id('zc') };
    this.capacityRows.set(k, row);
    return { ...row };
  }

  async liveBanners(now: Date): Promise<BannerRecord[]> {
    return [...this.bannerRows.values()].filter((b) => !b.clearedAt && b.expiresAt.getTime() > now.getTime()).map((b) => ({ ...b, audiences: [...b.audiences] }));
  }

  async recentBanners(limit: number): Promise<BannerRecord[]> {
    return [...this.bannerRows.values()]
      .sort((a, b) => b.setAt.getTime() - a.setAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((b) => ({ ...b, audiences: [...b.audiences] }));
  }

  async banner(id: string): Promise<BannerRecord | null> {
    const b = this.bannerRows.get(id);
    return b ? { ...b, audiences: [...b.audiences] } : null;
  }

  async createBanner(input: Omit<BannerRecord, 'id'>): Promise<BannerRecord> {
    const row = { ...input, id: this.id('bn'), audiences: [...input.audiences] };
    this.bannerRows.set(row.id, row);
    return { ...row };
  }

  async clearBanner(id: string, by: string, at: Date): Promise<BannerRecord> {
    const b = this.bannerRows.get(id);
    if (!b) throw new Error(`banner ${id} not found`);
    b.clearedAt = at;
    b.clearedById = by;
    return { ...b, audiences: [...b.audiences] };
  }

  async addAudit(input: Omit<AuditRecord, 'id'>): Promise<AuditRecord> {
    const row = { ...input, id: this.id('au') };
    this.auditRows.push(row);
    return { ...row };
  }

  async audit(filter: { cityId?: string | undefined; subjectKind?: string | undefined; limit: number }): Promise<AuditRecord[]> {
    return this.auditRows
      .filter((a) => (!filter.cityId || a.cityId === null || a.cityId === filter.cityId) && (!filter.subjectKind || a.subjectKind === filter.subjectKind))
      .sort((a, b) => b.at.getTime() - a.at.getTime() || Number(b.id.slice(3)) - Number(a.id.slice(3)))
      .slice(0, filter.limit)
      .map((a) => ({ ...a }));
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma row ↔ record mapping */
const switchFrom = (r: any): KillSwitchRecord => ({
  id: r.id,
  cityId: r.cityId,
  scope: r.scope,
  key: r.key,
  vertical: r.vertical ?? null,
  target: r.target,
  active: r.active,
  holdDispatch: r.holdDispatch,
  messageAr: r.messageAr,
  reason: r.reason,
  setById: r.setById,
  setAt: r.setAt,
  expiresAt: r.expiresAt,
});
const capacityFrom = (r: any): ZoneCapacityRecord => ({ id: r.id, cityId: r.cityId, zoneKey: r.zoneKey, maxActive: r.maxActive, mode: r.mode === 'queue' ? 'queue' : 'refuse', etaMin: r.etaMin, setById: r.setById, setAt: r.setAt });
const bannerFrom = (r: any): BannerRecord => ({
  id: r.id,
  cityId: r.cityId,
  severity: r.severity,
  audiences: r.audiences,
  messageAr: r.messageAr,
  messageEn: r.messageEn,
  startsAt: r.startsAt,
  expiresAt: r.expiresAt,
  setById: r.setById,
  setAt: r.createdAt,
  clearedAt: r.clearedAt,
  clearedById: r.clearedById,
});
const auditFrom = (r: any): AuditRecord => ({
  id: r.id,
  cityId: r.cityId,
  actorId: r.actorId,
  action: r.action,
  subjectKind: r.subjectKind,
  subjectId: r.subjectId,
  summaryAr: r.summaryAr,
  detail: r.detail && typeof r.detail === 'object' && !Array.isArray(r.detail) ? r.detail : {},
  at: r.at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export class PrismaControlsRepository implements ControlsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async switches(cityId: string, tx?: Tx): Promise<KillSwitchRecord[]> {
    return (await this.db(tx).opsKillSwitch.findMany({ where: { cityId }, orderBy: { setAt: 'desc' } })).map(switchFrom);
  }

  async upsertSwitch(input: Omit<KillSwitchRecord, 'id'>, tx?: Tx): Promise<KillSwitchRecord> {
    const { cityId, target, ...rest } = input;
    const r = await this.db(tx).opsKillSwitch.upsert({ where: { cityId_target: { cityId, target } }, create: { cityId, target, ...rest }, update: rest });
    return switchFrom(r);
  }

  async capacities(cityId: string, tx?: Tx): Promise<ZoneCapacityRecord[]> {
    return (await this.db(tx).opsZoneCapacity.findMany({ where: { cityId } })).map(capacityFrom);
  }

  async upsertCapacity(input: Omit<ZoneCapacityRecord, 'id'>, tx?: Tx): Promise<ZoneCapacityRecord> {
    const { cityId, zoneKey, ...rest } = input;
    const r = await this.db(tx).opsZoneCapacity.upsert({ where: { cityId_zoneKey: { cityId, zoneKey } }, create: { cityId, zoneKey, ...rest }, update: rest });
    return capacityFrom(r);
  }

  async liveBanners(now: Date, tx?: Tx): Promise<BannerRecord[]> {
    return (await this.db(tx).systemBanner.findMany({ where: { clearedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: 'desc' } })).map(bannerFrom);
  }

  async recentBanners(limit: number, tx?: Tx): Promise<BannerRecord[]> {
    return (await this.db(tx).systemBanner.findMany({ orderBy: { createdAt: 'desc' }, take: limit })).map(bannerFrom);
  }

  async banner(id: string, tx?: Tx): Promise<BannerRecord | null> {
    const r = await this.db(tx).systemBanner.findUnique({ where: { id } });
    return r ? bannerFrom(r) : null;
  }

  async createBanner(input: Omit<BannerRecord, 'id'>, tx?: Tx): Promise<BannerRecord> {
    const { setAt, ...rest } = input;
    return bannerFrom(await this.db(tx).systemBanner.create({ data: { ...rest, createdAt: setAt } }));
  }

  async clearBanner(id: string, by: string, at: Date, tx?: Tx): Promise<BannerRecord> {
    return bannerFrom(await this.db(tx).systemBanner.update({ where: { id }, data: { clearedAt: at, clearedById: by } }));
  }

  async addAudit(input: Omit<AuditRecord, 'id'>, tx?: Tx): Promise<AuditRecord> {
    return auditFrom(await this.db(tx).consoleAuditLog.create({ data: { ...input, detail: input.detail as never } }));
  }

  async audit(filter: { cityId?: string | undefined; subjectKind?: string | undefined; limit: number }, tx?: Tx): Promise<AuditRecord[]> {
    const rows = await this.db(tx).consoleAuditLog.findMany({
      where: {
        ...(filter.cityId ? { OR: [{ cityId: filter.cityId }, { cityId: null }] } : {}),
        ...(filter.subjectKind ? { subjectKind: filter.subjectKind } : {}),
      },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: filter.limit,
    });
    return rows.map(auditFrom);
  }
}
