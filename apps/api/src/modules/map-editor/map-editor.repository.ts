import type { LandmarkCategory, LatLng, MapEditAction, MapPinKind, MapReportKind, MapReportSource } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** The fields a map edit can change, as they were before it and as they became. */
export interface MapEditFields {
  name?: string;
  localNames?: string[];
  category?: LandmarkCategory | null;
  pin?: LatLng | null;
  state?: 'approved' | 'hidden';
}

export interface MapEditRecord {
  id: string;
  cityId: string;
  targetKind: MapPinKind;
  targetId: string;
  action: MapEditAction;
  summaryAr: string;
  before: MapEditFields;
  after: MapEditFields;
  mergedId: string | null;
  actorId: string;
  undoneAt: Date | null;
  undoneById: string | null;
  createdAt: Date;
}

export type NewMapEdit = Omit<MapEditRecord, 'id' | 'undoneAt' | 'undoneById'>;

export interface MapReportRecord {
  id: string;
  cityId: string;
  source: MapReportSource;
  kind: MapReportKind;
  targetKind: MapPinKind | null;
  targetId: string | null;
  pin: LatLng | null;
  nameAr: string | null;
  note: string | null;
  reporterId: string;
  state: 'open' | 'accepted' | 'rejected';
  decidedAt: Date | null;
  decidedById: string | null;
  createdAt: Date;
}

export type NewMapReport = Omit<MapReportRecord, 'id' | 'state' | 'decidedAt' | 'decidedById'>;

export interface MapEditorRepository {
  addEdit(input: NewMapEdit, tx?: Tx): Promise<MapEditRecord>;
  edit(id: string, tx?: Tx): Promise<MapEditRecord | null>;
  /** Newest first. */
  edits(cityId: string, limit: number, tx?: Tx): Promise<MapEditRecord[]>;
  /** The newest edit of one target that is not undone. */
  latestFor(targetKind: MapPinKind, targetId: string, tx?: Tx): Promise<MapEditRecord | null>;
  markUndone(id: string, by: string, at: Date, tx?: Tx): Promise<void>;
  addReport(input: NewMapReport, tx?: Tx): Promise<MapReportRecord>;
  /** Open reports, oldest first. */
  openReports(cityId: string, tx?: Tx): Promise<MapReportRecord[]>;
  reports(ids: readonly string[], tx?: Tx): Promise<MapReportRecord[]>;
  openCountBy(reporterId: string, tx?: Tx): Promise<number>;
  decide(ids: readonly string[], state: 'accepted' | 'rejected', by: string, at: Date, tx?: Tx): Promise<void>;
}

export const MAP_EDITOR_REPOSITORY = Symbol('MAP_EDITOR_REPOSITORY');

export class InMemoryMapEditorRepository implements MapEditorRepository {
  private readonly editRows: MapEditRecord[] = [];
  private readonly reportRows: MapReportRecord[] = [];
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async addEdit(input: NewMapEdit): Promise<MapEditRecord> {
    const row: MapEditRecord = structuredClone({ ...input, id: this.nextId('me'), undoneAt: null, undoneById: null });
    this.editRows.push(row);
    return structuredClone(row);
  }

  async edit(id: string): Promise<MapEditRecord | null> {
    const r = this.editRows.find((e) => e.id === id);
    return r ? structuredClone(r) : null;
  }

  async edits(cityId: string, limit: number): Promise<MapEditRecord[]> {
    return this.editRows.filter((e) => e.cityId === cityId).reverse().slice(0, limit).map((e) => structuredClone(e));
  }

  async latestFor(targetKind: MapPinKind, targetId: string): Promise<MapEditRecord | null> {
    const r = [...this.editRows].reverse().find((e) => e.targetKind === targetKind && e.targetId === targetId && e.undoneAt === null);
    return r ? structuredClone(r) : null;
  }

  async markUndone(id: string, by: string, at: Date): Promise<void> {
    const r = this.editRows.find((e) => e.id === id);
    if (r && r.undoneAt === null) Object.assign(r, { undoneAt: at, undoneById: by });
  }

  async addReport(input: NewMapReport): Promise<MapReportRecord> {
    const row: MapReportRecord = structuredClone({ ...input, id: this.nextId('mr'), state: 'open' as const, decidedAt: null, decidedById: null });
    this.reportRows.push(row);
    return structuredClone(row);
  }

  async openReports(cityId: string): Promise<MapReportRecord[]> {
    return this.reportRows.filter((r) => r.cityId === cityId && r.state === 'open').map((r) => structuredClone(r));
  }

  async reports(ids: readonly string[]): Promise<MapReportRecord[]> {
    return this.reportRows.filter((r) => ids.includes(r.id)).map((r) => structuredClone(r));
  }

  async openCountBy(reporterId: string): Promise<number> {
    return this.reportRows.filter((r) => r.reporterId === reporterId && r.state === 'open').length;
  }

  async decide(ids: readonly string[], state: 'accepted' | 'rejected', by: string, at: Date): Promise<void> {
    for (const r of this.reportRows) if (ids.includes(r.id) && r.state === 'open') Object.assign(r, { state, decidedAt: at, decidedById: by });
  }
}

// ───────────────────────── Prisma ─────────────────────────

interface EditRow {
  id: string;
  cityId: string;
  targetKind: string;
  targetId: string;
  action: string;
  summaryAr: string;
  before: unknown;
  after: unknown;
  mergedId: string | null;
  actorId: string;
  undoneAt: Date | null;
  undoneById: string | null;
  createdAt: Date;
}

interface ReportRow {
  id: string;
  cityId: string;
  source: string;
  kind: string;
  targetKind: string | null;
  targetId: string | null;
  pin: unknown;
  nameAr: string | null;
  note: string | null;
  reporterId: string;
  state: string;
  decidedAt: Date | null;
  decidedById: string | null;
  createdAt: Date;
}

function editOf(r: EditRow): MapEditRecord {
  return {
    id: r.id,
    cityId: r.cityId,
    targetKind: r.targetKind as MapPinKind,
    targetId: r.targetId,
    action: r.action as MapEditAction,
    summaryAr: r.summaryAr,
    before: (r.before ?? {}) as MapEditFields,
    after: (r.after ?? {}) as MapEditFields,
    mergedId: r.mergedId,
    actorId: r.actorId,
    undoneAt: r.undoneAt,
    undoneById: r.undoneById,
    createdAt: r.createdAt,
  };
}

function pinOf(raw: unknown): LatLng | null {
  if (!raw || typeof raw !== 'object') return null;
  const { lat, lng } = raw as { lat?: unknown; lng?: unknown };
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null;
}

function reportOf(r: ReportRow): MapReportRecord {
  return {
    id: r.id,
    cityId: r.cityId,
    source: r.source as MapReportSource,
    kind: r.kind as MapReportKind,
    targetKind: (r.targetKind as MapPinKind | null) ?? null,
    targetId: r.targetId,
    pin: pinOf(r.pin),
    nameAr: r.nameAr,
    note: r.note,
    reporterId: r.reporterId,
    state: r.state as MapReportRecord['state'],
    decidedAt: r.decidedAt,
    decidedById: r.decidedById,
    createdAt: r.createdAt,
  };
}

/** JSON columns hold plain values only (no undefined keys). */
const json = (v: object) => JSON.parse(JSON.stringify(v)) as object;

export class PrismaMapEditorRepository implements MapEditorRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async addEdit(input: NewMapEdit, tx?: Tx): Promise<MapEditRecord> {
    return editOf(await this.db(tx).mapEdit.create({ data: { ...input, before: json(input.before), after: json(input.after) } }));
  }

  async edit(id: string, tx?: Tx): Promise<MapEditRecord | null> {
    const r = await this.db(tx).mapEdit.findUnique({ where: { id } });
    return r ? editOf(r) : null;
  }

  async edits(cityId: string, limit: number, tx?: Tx): Promise<MapEditRecord[]> {
    return (await this.db(tx).mapEdit.findMany({ where: { cityId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit })).map(editOf);
  }

  async latestFor(targetKind: MapPinKind, targetId: string, tx?: Tx): Promise<MapEditRecord | null> {
    const r = await this.db(tx).mapEdit.findFirst({ where: { targetKind, targetId, undoneAt: null }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return r ? editOf(r) : null;
  }

  async markUndone(id: string, by: string, at: Date, tx?: Tx): Promise<void> {
    await this.db(tx).mapEdit.updateMany({ where: { id, undoneAt: null }, data: { undoneAt: at, undoneById: by } });
  }

  async addReport(input: NewMapReport, tx?: Tx): Promise<MapReportRecord> {
    const { pin, ...rest } = input;
    return reportOf(await this.db(tx).mapReport.create({ data: { ...rest, ...(pin ? { pin: { lat: pin.lat, lng: pin.lng } } : {}) } }));
  }

  async openReports(cityId: string, tx?: Tx): Promise<MapReportRecord[]> {
    return (await this.db(tx).mapReport.findMany({ where: { cityId, state: 'open' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 500 })).map(reportOf);
  }

  async reports(ids: readonly string[], tx?: Tx): Promise<MapReportRecord[]> {
    return (await this.db(tx).mapReport.findMany({ where: { id: { in: [...ids] } } })).map(reportOf);
  }

  async openCountBy(reporterId: string, tx?: Tx): Promise<number> {
    return this.db(tx).mapReport.count({ where: { reporterId, state: 'open' } });
  }

  async decide(ids: readonly string[], state: 'accepted' | 'rejected', by: string, at: Date, tx?: Tx): Promise<void> {
    await this.db(tx).mapReport.updateMany({ where: { id: { in: [...ids] }, state: 'open' }, data: { state, decidedAt: at, decidedById: by } });
  }
}
