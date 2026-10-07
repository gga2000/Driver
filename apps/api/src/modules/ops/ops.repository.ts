import type { DeliveryPoint, LandmarkTarget, OpsTaskKind } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

export interface LandmarkPhotoRecord {
  id: string;
  targetKind: LandmarkTarget['kind'];
  targetId: string;
  uploadId: string;
  caption: string | null;
  localNames: string[];
  state: 'proposed' | 'approved' | 'rejected';
  addedById: string;
  createdAt: Date;
  reviewedById?: string | null;
  reviewedAt?: Date | null;
  rejectReason?: string | null;
}

export interface CashReceiptRecord {
  id: string;
  courierId: string;
  receivedById: string;
  amountIqd: number;
  reference: string;
  idempotencyKey: string | null;
  note: string | null;
  courierCashAfterIqd: number;
  createdAt: Date;
}

export interface OnboardingRecord {
  id: string;
  orgId: string;
  cityId: string;
  name: string;
  type: 'restaurant' | 'grocer';
  contactPersonId: string;
  location: DeliveryPoint;
  menuPhotoRefs: string[];
  shopPhotoRef: string | null;
  notes: string | null;
  state: 'draft' | 'submitted' | 'active' | 'rejected';
  createdById: string;
  createdAt: Date;
  reviewedById?: string | null;
  reviewedAt?: Date | null;
  rejectReason?: string | null;
}

export interface TaskRecord {
  id: string;
  cityId: string | null;
  kind: OpsTaskKind;
  refId: string | null;
  title: string;
  state: 'open' | 'done';
  assigneeId: string | null;
  dueAt: Date | null;
  payload: Record<string, unknown>;
  completedAt: Date | null;
  completedById: string | null;
  createdAt: Date;
}

/** Field ops tables: `landmark_photos`, `ops_cash_receipts`, `merchant_onboardings`, `ops_tasks`. */
export interface OpsRepository {
  addLandmarkPhoto(input: Omit<LandmarkPhotoRecord, 'id'>, tx?: Tx): Promise<LandmarkPhotoRecord>;
  addCashReceipt(input: Omit<CashReceiptRecord, 'id'>, tx?: Tx): Promise<CashReceiptRecord>;
  cashReceiptByKey(idempotencyKey: string, tx?: Tx): Promise<CashReceiptRecord | null>;
  countCashReceipts(courierId: string, tx?: Tx): Promise<number>;
  /**
   * Serialises cash receipts for one courier across API instances until `tx` ends (Postgres advisory
   * lock); a no-op in memory, where the service's in-process lock already serialises them.
   */
  lockCourierCash(courierId: string, tx?: Tx): Promise<void>;
  addOnboarding(input: Omit<OnboardingRecord, 'id'>, tx?: Tx): Promise<OnboardingRecord>;
  addTask(input: Omit<TaskRecord, 'id'>, tx?: Tx): Promise<TaskRecord>;
  task(id: string, tx?: Tx): Promise<TaskRecord | null>;
  updateTask(id: string, patch: Partial<Pick<TaskRecord, 'state' | 'completedAt' | 'completedById' | 'payload'>>, tx?: Tx): Promise<TaskRecord>;
  /** Open tasks assigned to `assigneeId` or to nobody. */
  openTasks(assigneeId: string, tx?: Tx): Promise<TaskRecord[]>;
  /** Photos still `proposed` per target id (landmark picker counts). */
  proposedPhotoCounts(targetIds: readonly string[], tx?: Tx): Promise<Map<string, number>>;
  /** Console approvals queue: photos in `state`, oldest first. */
  photosIn(state: LandmarkPhotoRecord['state'], limit: number, tx?: Tx): Promise<LandmarkPhotoRecord[]>;
  /** Approved photos of one target (the "compare" pane). */
  approvedPhotosOf(targetId: string, tx?: Tx): Promise<LandmarkPhotoRecord[]>;
  /** The newest approved photo's upload id per target that has one (the map's landmark feed, maps program b3). */
  latestApprovedUploads(targetIds: readonly string[], tx?: Tx): Promise<Map<string, string>>;
  photo(id: string, tx?: Tx): Promise<LandmarkPhotoRecord | null>;
  /** Applies the decision only while the photo is still `proposed`; null when it was decided already. */
  decidePhoto(id: string, patch: { state: 'approved' | 'rejected'; reviewedById: string; reviewedAt: Date; rejectReason: string | null }, tx?: Tx): Promise<LandmarkPhotoRecord | null>;
  onboardingsIn(states: readonly OnboardingRecord['state'][], limit: number, tx?: Tx): Promise<OnboardingRecord[]>;
  onboarding(id: string, tx?: Tx): Promise<OnboardingRecord | null>;
  /** Applies the decision only while the draft is `draft` / `submitted`; null when it was decided already. */
  decideOnboarding(id: string, patch: { state: 'active' | 'rejected'; reviewedById: string; reviewedAt: Date; rejectReason: string | null }, tx?: Tx): Promise<OnboardingRecord | null>;
  /** Open tasks pointing at `refId` (an onboarding's follow-up). */
  openTasksFor(refId: string, tx?: Tx): Promise<TaskRecord[]>;
}

export const OPS_REPOSITORY = Symbol('OPS_REPOSITORY');

export class InMemoryOpsRepository implements OpsRepository {
  readonly photos: LandmarkPhotoRecord[] = [];
  readonly receipts: CashReceiptRecord[] = [];
  readonly onboardings: OnboardingRecord[] = [];
  readonly tasks: TaskRecord[] = [];
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async addLandmarkPhoto(input: Omit<LandmarkPhotoRecord, 'id'>): Promise<LandmarkPhotoRecord> {
    const row = { id: this.id('lmp'), ...input, localNames: [...input.localNames] };
    this.photos.push(row);
    return { ...row };
  }

  async addCashReceipt(input: Omit<CashReceiptRecord, 'id'>): Promise<CashReceiptRecord> {
    if (this.receipts.some((r) => r.reference === input.reference || (input.idempotencyKey && r.idempotencyKey === input.idempotencyKey))) throw new Error('unique violation: ops_cash_receipts');
    const row = { id: this.id('ocr'), ...input };
    this.receipts.push(row);
    return { ...row };
  }

  async cashReceiptByKey(idempotencyKey: string): Promise<CashReceiptRecord | null> {
    const r = this.receipts.find((x) => x.idempotencyKey === idempotencyKey);
    return r ? { ...r } : null;
  }

  async countCashReceipts(courierId: string): Promise<number> {
    return this.receipts.filter((r) => r.courierId === courierId).length;
  }

  async lockCourierCash(): Promise<void> {}

  async addOnboarding(input: Omit<OnboardingRecord, 'id'>): Promise<OnboardingRecord> {
    const row = { id: this.id('mob'), ...input, menuPhotoRefs: [...input.menuPhotoRefs] };
    this.onboardings.push(row);
    return { ...row };
  }

  async addTask(input: Omit<TaskRecord, 'id'>): Promise<TaskRecord> {
    const row = { id: this.id('otk'), ...input };
    this.tasks.push(row);
    return { ...row };
  }

  async task(id: string): Promise<TaskRecord | null> {
    const t = this.tasks.find((x) => x.id === id);
    return t ? { ...t } : null;
  }

  async updateTask(id: string, patch: Partial<Pick<TaskRecord, 'state' | 'completedAt' | 'completedById' | 'payload'>>): Promise<TaskRecord> {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new Error(`task ${id} not found`);
    Object.assign(t, patch);
    return { ...t };
  }

  async openTasks(assigneeId: string): Promise<TaskRecord[]> {
    return this.tasks.filter((t) => t.state === 'open' && (t.assigneeId === null || t.assigneeId === assigneeId)).map((t) => ({ ...t }));
  }

  async proposedPhotoCounts(targetIds: readonly string[]): Promise<Map<string, number>> {
    const ids = new Set(targetIds);
    const out = new Map<string, number>();
    for (const p of this.photos) if (p.state === 'proposed' && ids.has(p.targetId)) out.set(p.targetId, (out.get(p.targetId) ?? 0) + 1);
    return out;
  }

  async photosIn(state: LandmarkPhotoRecord['state'], limit: number): Promise<LandmarkPhotoRecord[]> {
    return this.photos.filter((p) => p.state === state).slice(0, limit).map((p) => ({ ...p, localNames: [...p.localNames] }));
  }

  async approvedPhotosOf(targetId: string): Promise<LandmarkPhotoRecord[]> {
    return this.photos.filter((p) => p.state === 'approved' && p.targetId === targetId).map((p) => ({ ...p, localNames: [...p.localNames] }));
  }

  async latestApprovedUploads(targetIds: readonly string[]): Promise<Map<string, string>> {
    const ids = new Set(targetIds);
    const newest = this.photos.filter((p) => p.state === 'approved' && ids.has(p.targetId)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    const out = new Map<string, string>();
    for (const p of newest) if (!out.has(p.targetId)) out.set(p.targetId, p.uploadId);
    return out;
  }

  async photo(id: string): Promise<LandmarkPhotoRecord | null> {
    const p = this.photos.find((x) => x.id === id);
    return p ? { ...p, localNames: [...p.localNames] } : null;
  }

  async decidePhoto(id: string, patch: { state: 'approved' | 'rejected'; reviewedById: string; reviewedAt: Date; rejectReason: string | null }): Promise<LandmarkPhotoRecord | null> {
    const p = this.photos.find((x) => x.id === id);
    if (!p || p.state !== 'proposed') return null;
    Object.assign(p, patch);
    return { ...p, localNames: [...p.localNames] };
  }

  async onboardingsIn(states: readonly OnboardingRecord['state'][], limit: number): Promise<OnboardingRecord[]> {
    return this.onboardings.filter((o) => states.includes(o.state)).slice(0, limit).map((o) => ({ ...o, menuPhotoRefs: [...o.menuPhotoRefs] }));
  }

  async onboarding(id: string): Promise<OnboardingRecord | null> {
    const o = this.onboardings.find((x) => x.id === id);
    return o ? { ...o, menuPhotoRefs: [...o.menuPhotoRefs] } : null;
  }

  async decideOnboarding(id: string, patch: { state: 'active' | 'rejected'; reviewedById: string; reviewedAt: Date; rejectReason: string | null }): Promise<OnboardingRecord | null> {
    const o = this.onboardings.find((x) => x.id === id);
    if (!o || (o.state !== 'draft' && o.state !== 'submitted')) return null;
    Object.assign(o, patch);
    return { ...o, menuPhotoRefs: [...o.menuPhotoRefs] };
  }

  async openTasksFor(refId: string): Promise<TaskRecord[]> {
    return this.tasks.filter((t) => t.state === 'open' && t.refId === refId).map((t) => ({ ...t }));
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function taskFromRow(r: {
  id: string;
  cityId: string | null;
  kind: string;
  refId: string | null;
  title: string;
  state: string;
  assigneeId: string | null;
  dueAt: Date | null;
  payload: unknown;
  completedAt: Date | null;
  completedById: string | null;
  createdAt: Date;
}): TaskRecord {
  return { ...r, kind: r.kind as OpsTaskKind, state: r.state === 'done' ? 'done' : 'open', payload: obj(r.payload) };
}

export class PrismaOpsRepository implements OpsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async addLandmarkPhoto(input: Omit<LandmarkPhotoRecord, 'id'>, tx?: Tx): Promise<LandmarkPhotoRecord> {
    const r = await this.db(tx).landmarkPhoto.create({ data: input });
    return { id: r.id, targetKind: r.targetKind as LandmarkTarget['kind'], targetId: r.targetId, uploadId: r.uploadId, caption: r.caption, localNames: r.localNames, state: r.state as LandmarkPhotoRecord['state'], addedById: r.addedById, createdAt: r.createdAt };
  }

  async addCashReceipt(input: Omit<CashReceiptRecord, 'id'>, tx?: Tx): Promise<CashReceiptRecord> {
    const r = await this.db(tx).opsCashReceipt.create({ data: input });
    return { id: r.id, courierId: r.courierId, receivedById: r.receivedById, amountIqd: r.amountIqd, reference: r.reference, idempotencyKey: r.idempotencyKey, note: r.note, courierCashAfterIqd: r.courierCashAfterIqd, createdAt: r.createdAt };
  }

  async cashReceiptByKey(idempotencyKey: string, tx?: Tx): Promise<CashReceiptRecord | null> {
    const r = await this.db(tx).opsCashReceipt.findUnique({ where: { idempotencyKey } });
    return r ? { id: r.id, courierId: r.courierId, receivedById: r.receivedById, amountIqd: r.amountIqd, reference: r.reference, idempotencyKey: r.idempotencyKey, note: r.note, courierCashAfterIqd: r.courierCashAfterIqd, createdAt: r.createdAt } : null;
  }

  async countCashReceipts(courierId: string, tx?: Tx): Promise<number> {
    return this.db(tx).opsCashReceipt.count({ where: { courierId } });
  }

  async lockCourierCash(courierId: string, tx?: Tx): Promise<void> {
    if (!tx) throw new Error('lockCourierCash needs a transaction');
    const key = `ops.cash:${courierId}`;
    await tx.$queryRaw`SELECT 1 AS ok FROM (SELECT pg_advisory_xact_lock(hashtext(${key}))) AS l`;
  }

  async addOnboarding(input: Omit<OnboardingRecord, 'id'>, tx?: Tx): Promise<OnboardingRecord> {
    const r = await this.db(tx).merchantOnboarding.create({ data: { ...input, location: input.location as never } });
    return { ...input, id: r.id, createdAt: r.createdAt };
  }

  async addTask(input: Omit<TaskRecord, 'id'>, tx?: Tx): Promise<TaskRecord> {
    return taskFromRow(await this.db(tx).opsTask.create({ data: { ...input, payload: input.payload as never } }));
  }

  async task(id: string, tx?: Tx): Promise<TaskRecord | null> {
    const r = await this.db(tx).opsTask.findUnique({ where: { id } });
    return r ? taskFromRow(r) : null;
  }

  async updateTask(id: string, patch: Partial<Pick<TaskRecord, 'state' | 'completedAt' | 'completedById' | 'payload'>>, tx?: Tx): Promise<TaskRecord> {
    const { payload, ...rest } = patch;
    return taskFromRow(await this.db(tx).opsTask.update({ where: { id }, data: { ...rest, ...(payload ? { payload: payload as never } : {}) } }));
  }

  async openTasks(assigneeId: string, tx?: Tx): Promise<TaskRecord[]> {
    const rows = await this.db(tx).opsTask.findMany({ where: { state: 'open', OR: [{ assigneeId: null }, { assigneeId }] }, orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(taskFromRow);
  }

  async proposedPhotoCounts(targetIds: readonly string[], tx?: Tx): Promise<Map<string, number>> {
    if (targetIds.length === 0) return new Map();
    const rows = await this.db(tx).landmarkPhoto.groupBy({ by: ['targetId'], where: { state: 'proposed', targetId: { in: [...targetIds] } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.targetId, r._count._all]));
  }

  async photosIn(state: LandmarkPhotoRecord['state'], limit: number, tx?: Tx): Promise<LandmarkPhotoRecord[]> {
    return (await this.db(tx).landmarkPhoto.findMany({ where: { state }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit })).map(photoFrom);
  }

  async approvedPhotosOf(targetId: string, tx?: Tx): Promise<LandmarkPhotoRecord[]> {
    return (await this.db(tx).landmarkPhoto.findMany({ where: { state: 'approved', targetId }, orderBy: { createdAt: 'desc' }, take: 6 })).map(photoFrom);
  }

  async latestApprovedUploads(targetIds: readonly string[], tx?: Tx): Promise<Map<string, string>> {
    if (targetIds.length === 0) return new Map();
    const rows = await this.db(tx).landmarkPhoto.findMany({
      where: { state: 'approved', targetId: { in: [...targetIds] } },
      orderBy: [{ targetId: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      distinct: ['targetId'],
      select: { targetId: true, uploadId: true },
    });
    return new Map(rows.map((r) => [r.targetId, r.uploadId]));
  }

  async photo(id: string, tx?: Tx): Promise<LandmarkPhotoRecord | null> {
    const r = await this.db(tx).landmarkPhoto.findUnique({ where: { id } });
    return r ? photoFrom(r) : null;
  }

  async decidePhoto(id: string, patch: { state: 'approved' | 'rejected'; reviewedById: string; reviewedAt: Date; rejectReason: string | null }, tx?: Tx): Promise<LandmarkPhotoRecord | null> {
    const res = await this.db(tx).landmarkPhoto.updateMany({ where: { id, state: 'proposed' }, data: patch });
    return res.count === 1 ? this.photo(id, tx) : null;
  }

  async onboardingsIn(states: readonly OnboardingRecord['state'][], limit: number, tx?: Tx): Promise<OnboardingRecord[]> {
    return (await this.db(tx).merchantOnboarding.findMany({ where: { state: { in: [...states] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit })).map(onboardingFrom);
  }

  async onboarding(id: string, tx?: Tx): Promise<OnboardingRecord | null> {
    const r = await this.db(tx).merchantOnboarding.findUnique({ where: { id } });
    return r ? onboardingFrom(r) : null;
  }

  async decideOnboarding(id: string, patch: { state: 'active' | 'rejected'; reviewedById: string; reviewedAt: Date; rejectReason: string | null }, tx?: Tx): Promise<OnboardingRecord | null> {
    const res = await this.db(tx).merchantOnboarding.updateMany({ where: { id, state: { in: ['draft', 'submitted'] } }, data: patch });
    return res.count === 1 ? this.onboarding(id, tx) : null;
  }

  async openTasksFor(refId: string, tx?: Tx): Promise<TaskRecord[]> {
    return (await this.db(tx).opsTask.findMany({ where: { state: 'open', refId } })).map(taskFromRow);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma row ↔ record mapping */
function photoFrom(r: any): LandmarkPhotoRecord {
  return {
    id: r.id,
    targetKind: r.targetKind,
    targetId: r.targetId,
    uploadId: r.uploadId,
    caption: r.caption,
    localNames: r.localNames,
    state: r.state,
    addedById: r.addedById,
    createdAt: r.createdAt,
    reviewedById: r.reviewedById,
    reviewedAt: r.reviewedAt,
    rejectReason: r.rejectReason,
  };
}

function onboardingFrom(r: any): OnboardingRecord {
  return {
    id: r.id,
    orgId: r.orgId,
    cityId: r.cityId,
    name: r.name,
    type: r.type === 'grocer' ? 'grocer' : 'restaurant',
    contactPersonId: r.contactPersonId,
    location: r.location,
    menuPhotoRefs: r.menuPhotoRefs,
    shopPhotoRef: r.shopPhotoRef,
    notes: r.notes,
    state: r.state,
    createdById: r.createdById,
    createdAt: r.createdAt,
    reviewedById: r.reviewedById,
    reviewedAt: r.reviewedAt,
    rejectReason: r.rejectReason,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
