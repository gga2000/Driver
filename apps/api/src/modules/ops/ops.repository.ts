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
  addOnboarding(input: Omit<OnboardingRecord, 'id'>, tx?: Tx): Promise<OnboardingRecord>;
  addTask(input: Omit<TaskRecord, 'id'>, tx?: Tx): Promise<TaskRecord>;
  task(id: string, tx?: Tx): Promise<TaskRecord | null>;
  updateTask(id: string, patch: Partial<Pick<TaskRecord, 'state' | 'completedAt' | 'completedById' | 'payload'>>, tx?: Tx): Promise<TaskRecord>;
  /** Open tasks assigned to `assigneeId` or to nobody. */
  openTasks(assigneeId: string, tx?: Tx): Promise<TaskRecord[]>;
  /** Photos still `proposed` per target id (landmark picker counts). */
  proposedPhotoCounts(targetIds: readonly string[], tx?: Tx): Promise<Map<string, number>>;
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
}
