import { MenuPhotoRequestState, MenuShotState } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

export interface MenuPhotoRequestRecord {
  id: string;
  orgId: string;
  cityId: string;
  requestedById: string;
  note: string | null;
  /** Empty = the whole menu. */
  itemIds: string[];
  state: MenuPhotoRequestState;
  assignedOpsId: string | null;
  scheduledFor: Date | null;
  shotAt: Date | null;
  closedAt: Date | null;
  closedById: string | null;
  createdAt: Date;
}

export interface MenuPhotoShotRecord {
  id: string;
  requestId: string;
  itemId: string;
  uploadId: string;
  state: MenuShotState;
  takenById: string;
  decidedById: string | null;
  decidedAt: Date | null;
  /** When the current photo was taken (a re-shoot moves it). */
  createdAt: Date;
}

export type MenuPhotoRequestPatch = Partial<Pick<MenuPhotoRequestRecord, 'state' | 'assignedOpsId' | 'scheduledFor' | 'shotAt' | 'closedAt' | 'closedById'>>;

/**
 * The condition an update needs to still hold when it lands (another phone may have moved the request
 * meanwhile): the request is in one of `states`, and — when given — held by one of `assignedOpsIds`
 * (`null` = nobody has it).
 */
export interface MenuPhotoRequestGuard {
  states: readonly MenuPhotoRequestState[];
  assignedOpsIds?: readonly (string | null)[];
}

/** `menu_photo_requests` and `menu_photo_shots` (maps program k3). */
export interface MenuPhotosRepository {
  create(input: Omit<MenuPhotoRequestRecord, 'id'>, tx?: Tx): Promise<MenuPhotoRequestRecord>;
  get(id: string, tx?: Tx): Promise<MenuPhotoRequestRecord | null>;
  /** The store's requests, newest first. */
  forOrg(orgId: string, limit: number, tx?: Tx): Promise<MenuPhotoRequestRecord[]>;
  /** Requests in a city (in `states` when given), oldest first. */
  inCity(cityId: string, states: readonly MenuPhotoRequestState[] | null, limit: number, tx?: Tx): Promise<MenuPhotoRequestRecord[]>;
  /** Applies `patch` only while `guard` holds; null when it no longer does. */
  update(id: string, guard: MenuPhotoRequestGuard, patch: MenuPhotoRequestPatch, tx?: Tx): Promise<MenuPhotoRequestRecord | null>;
  shotsOf(requestIds: readonly string[], tx?: Tx): Promise<MenuPhotoShotRecord[]>;
  shot(id: string, tx?: Tx): Promise<MenuPhotoShotRecord | null>;
  /**
   * The dish's photo for this request: a new row, or the existing one with the new upload (a
   * re-shoot); `replacedUploadId` is the upload it replaced, for the caller to delete.
   */
  putShot(input: { requestId: string; itemId: string; uploadId: string; takenById: string; at: Date }, tx?: Tx): Promise<{ shot: MenuPhotoShotRecord; replacedUploadId: string | null }>;
  /** Applies the owner's decision only while the photo is still `proposed`; null when it was decided already. */
  decideShot(id: string, patch: { state: 'accepted' | 'rejected'; decidedById: string; decidedAt: Date }, tx?: Tx): Promise<MenuPhotoShotRecord | null>;
}

export const MENU_PHOTOS_REPOSITORY = Symbol('MENU_PHOTOS_REPOSITORY');

function guardHolds(r: MenuPhotoRequestRecord, guard: MenuPhotoRequestGuard): boolean {
  if (!guard.states.includes(r.state)) return false;
  return !guard.assignedOpsIds || guard.assignedOpsIds.includes(r.assignedOpsId);
}

const copyRequest = (r: MenuPhotoRequestRecord): MenuPhotoRequestRecord => ({ ...r, itemIds: [...r.itemIds] });

export class InMemoryMenuPhotosRepository implements MenuPhotosRepository {
  readonly requests: MenuPhotoRequestRecord[] = [];
  readonly shots: MenuPhotoShotRecord[] = [];
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async create(input: Omit<MenuPhotoRequestRecord, 'id'>): Promise<MenuPhotoRequestRecord> {
    const row = { id: this.id('mpr'), ...input, itemIds: [...input.itemIds] };
    this.requests.push(row);
    return copyRequest(row);
  }

  async get(id: string): Promise<MenuPhotoRequestRecord | null> {
    const r = this.requests.find((x) => x.id === id);
    return r ? copyRequest(r) : null;
  }

  async forOrg(orgId: string, limit: number): Promise<MenuPhotoRequestRecord[]> {
    return this.requests
      .filter((r) => r.orgId === orgId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map(copyRequest);
  }

  async inCity(cityId: string, states: readonly MenuPhotoRequestState[] | null, limit: number): Promise<MenuPhotoRequestRecord[]> {
    return this.requests
      .filter((r) => r.cityId === cityId && (!states || states.includes(r.state)))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map(copyRequest);
  }

  async update(id: string, guard: MenuPhotoRequestGuard, patch: MenuPhotoRequestPatch): Promise<MenuPhotoRequestRecord | null> {
    const r = this.requests.find((x) => x.id === id);
    if (!r || !guardHolds(r, guard)) return null;
    Object.assign(r, patch);
    return copyRequest(r);
  }

  async shotsOf(requestIds: readonly string[]): Promise<MenuPhotoShotRecord[]> {
    const ids = new Set(requestIds);
    return this.shots.filter((s) => ids.has(s.requestId)).map((s) => ({ ...s }));
  }

  async shot(id: string): Promise<MenuPhotoShotRecord | null> {
    const s = this.shots.find((x) => x.id === id);
    return s ? { ...s } : null;
  }

  async putShot(input: { requestId: string; itemId: string; uploadId: string; takenById: string; at: Date }): Promise<{ shot: MenuPhotoShotRecord; replacedUploadId: string | null }> {
    const existing = this.shots.find((s) => s.requestId === input.requestId && s.itemId === input.itemId);
    if (existing) {
      const replacedUploadId = existing.uploadId;
      Object.assign(existing, { uploadId: input.uploadId, takenById: input.takenById, createdAt: input.at, state: 'proposed', decidedById: null, decidedAt: null });
      return { shot: { ...existing }, replacedUploadId };
    }
    const row: MenuPhotoShotRecord = { id: this.id('mps'), requestId: input.requestId, itemId: input.itemId, uploadId: input.uploadId, state: 'proposed', takenById: input.takenById, decidedById: null, decidedAt: null, createdAt: input.at };
    this.shots.push(row);
    return { shot: { ...row }, replacedUploadId: null };
  }

  async decideShot(id: string, patch: { state: 'accepted' | 'rejected'; decidedById: string; decidedAt: Date }): Promise<MenuPhotoShotRecord | null> {
    const s = this.shots.find((x) => x.id === id);
    if (!s || s.state !== 'proposed') return null;
    Object.assign(s, patch);
    return { ...s };
  }
}

type RequestRow = Awaited<ReturnType<Tx['menuPhotoRequest']['findUniqueOrThrow']>>;
type ShotRow = Awaited<ReturnType<Tx['menuPhotoShot']['findUniqueOrThrow']>>;

function requestFrom(r: RequestRow): MenuPhotoRequestRecord {
  return {
    id: r.id,
    orgId: r.orgId,
    cityId: r.cityId,
    requestedById: r.requestedById,
    note: r.note,
    itemIds: [...r.itemIds],
    state: MenuPhotoRequestState.parse(r.state),
    assignedOpsId: r.assignedOpsId,
    scheduledFor: r.scheduledFor,
    shotAt: r.shotAt,
    closedAt: r.closedAt,
    closedById: r.closedById,
    createdAt: r.createdAt,
  };
}

function shotFrom(r: ShotRow): MenuPhotoShotRecord {
  return {
    id: r.id,
    requestId: r.requestId,
    itemId: r.itemId,
    uploadId: r.uploadId,
    state: MenuShotState.parse(r.state),
    takenById: r.takenById,
    decidedById: r.decidedById,
    decidedAt: r.decidedAt,
    createdAt: r.createdAt,
  };
}

/** `assignedOpsId IN (…)` that also matches "nobody" when the guard lists null. */
function assignedWhere(ids: readonly (string | null)[]) {
  const people = ids.filter((x): x is string => x !== null);
  const anyone = ids.includes(null);
  return { OR: [...(anyone ? [{ assignedOpsId: null }] : []), ...(people.length > 0 ? [{ assignedOpsId: { in: people } }] : [])] };
}

export class PrismaMenuPhotosRepository implements MenuPhotosRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? this.prisma.prisma;
  }

  async create(input: Omit<MenuPhotoRequestRecord, 'id'>, tx?: Tx): Promise<MenuPhotoRequestRecord> {
    return requestFrom(await this.db(tx).menuPhotoRequest.create({ data: { ...input, itemIds: [...input.itemIds] } }));
  }

  async get(id: string, tx?: Tx): Promise<MenuPhotoRequestRecord | null> {
    const r = await this.db(tx).menuPhotoRequest.findUnique({ where: { id } });
    return r ? requestFrom(r) : null;
  }

  async forOrg(orgId: string, limit: number, tx?: Tx): Promise<MenuPhotoRequestRecord[]> {
    const rows = await this.db(tx).menuPhotoRequest.findMany({ where: { orgId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
    return rows.map(requestFrom);
  }

  async inCity(cityId: string, states: readonly MenuPhotoRequestState[] | null, limit: number, tx?: Tx): Promise<MenuPhotoRequestRecord[]> {
    const rows = await this.db(tx).menuPhotoRequest.findMany({
      where: { cityId, ...(states ? { state: { in: [...states] } } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(requestFrom);
  }

  async update(id: string, guard: MenuPhotoRequestGuard, patch: MenuPhotoRequestPatch, tx?: Tx): Promise<MenuPhotoRequestRecord | null> {
    const res = await this.db(tx).menuPhotoRequest.updateMany({
      where: { id, state: { in: [...guard.states] }, ...(guard.assignedOpsIds ? assignedWhere(guard.assignedOpsIds) : {}) },
      data: patch,
    });
    return res.count === 1 ? this.get(id, tx) : null;
  }

  async shotsOf(requestIds: readonly string[], tx?: Tx): Promise<MenuPhotoShotRecord[]> {
    if (requestIds.length === 0) return [];
    const rows = await this.db(tx).menuPhotoShot.findMany({ where: { requestId: { in: [...requestIds] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return rows.map(shotFrom);
  }

  async shot(id: string, tx?: Tx): Promise<MenuPhotoShotRecord | null> {
    const r = await this.db(tx).menuPhotoShot.findUnique({ where: { id } });
    return r ? shotFrom(r) : null;
  }

  async putShot(input: { requestId: string; itemId: string; uploadId: string; takenById: string; at: Date }, tx?: Tx): Promise<{ shot: MenuPhotoShotRecord; replacedUploadId: string | null }> {
    const key = { requestId_itemId: { requestId: input.requestId, itemId: input.itemId } };
    const before = await this.db(tx).menuPhotoShot.findUnique({ where: key });
    const fresh = { uploadId: input.uploadId, takenById: input.takenById, createdAt: input.at, state: 'proposed', decidedById: null, decidedAt: null };
    const row = await this.db(tx).menuPhotoShot.upsert({ where: key, create: { requestId: input.requestId, itemId: input.itemId, ...fresh }, update: fresh });
    return { shot: shotFrom(row), replacedUploadId: before?.uploadId ?? null };
  }

  async decideShot(id: string, patch: { state: 'accepted' | 'rejected'; decidedById: string; decidedAt: Date }, tx?: Tx): Promise<MenuPhotoShotRecord | null> {
    const res = await this.db(tx).menuPhotoShot.updateMany({ where: { id, state: 'proposed' }, data: patch });
    return res.count === 1 ? this.shot(id, tx) : null;
  }
}
