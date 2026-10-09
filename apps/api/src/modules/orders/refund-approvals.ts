import { Inject, Injectable } from '@nestjs/common';
import { DriverError, type RefundApprovalLimit, type RefundApprovalState } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';

/**
 * Refunds over a limit wait for a second OK (Ali 2026-10-08, Console item 4; docs/api/refund-approvals.md).
 * `support.refund` and `orders.staff.resolveDispute` record a request here instead of posting; someone
 * else in finance or admin approves it (the refund then posts through the path that asked, registered
 * with `register`), declines it with a note, or the requester cancels it. Only `pending` moves, once.
 */

export type RefundApprovalKind = 'ticket' | 'dispute';

/** `refund_approvals` */
export interface RefundApprovalRecord {
  id: string;
  kind: RefundApprovalKind;
  cityId: string;
  ticketId: string | null;
  orderId: string | null;
  amountIqd: number;
  limitKind: RefundApprovalLimit;
  /** The original request: ticket `{ method, faultParty, note, idempotencyKey }`, complaint `{ outcome, faultParty, reason }`. */
  payload: Record<string, unknown>;
  requestedBy: string;
  requestedAt: Date;
  state: RefundApprovalState;
  decidedBy: string | null;
  decidedAt: Date | null;
  declineNote: string | null;
  idempotencyKey: string;
}

export type NewRefundApproval = Omit<RefundApprovalRecord, 'id' | 'state' | 'decidedBy' | 'decidedAt' | 'declineNote' | 'requestedAt'>;
type Decision = Pick<RefundApprovalRecord, 'state' | 'decidedBy' | 'decidedAt' | 'declineNote'>;

export interface RefundApprovalsRepository {
  /** Idempotent by `idempotencyKey`: the same request twice is one row (the first). */
  create(input: Omit<RefundApprovalRecord, 'id'>, tx?: Tx): Promise<RefundApprovalRecord>;
  get(id: string, tx?: Tx): Promise<RefundApprovalRecord | null>;
  byKey(key: string, tx?: Tx): Promise<RefundApprovalRecord | null>;
  /** Pending ones oldest first; decided ones newest first. */
  list(filter: { pending: boolean; cityId?: string | undefined; limit: number }, tx?: Tx): Promise<RefundApprovalRecord[]>;
  /** Pending for this ticket / order, oldest first. */
  pendingFor(filter: { ticketId?: string; orderId?: string }, tx?: Tx): Promise<RefundApprovalRecord[]>;
  /** Moves a `pending` row only; null when it was no longer pending. */
  decide(id: string, decision: Decision, tx?: Tx): Promise<RefundApprovalRecord | null>;
}

export const REFUND_APPROVALS_REPOSITORY = Symbol('REFUND_APPROVALS_REPOSITORY');

const LIST_LIMIT = 200;

export class InMemoryRefundApprovalsRepository implements RefundApprovalsRepository {
  readonly rows = new Map<string, RefundApprovalRecord>();
  private seq = 0;

  async create(input: Omit<RefundApprovalRecord, 'id'>): Promise<RefundApprovalRecord> {
    const prior = await this.byKey(input.idempotencyKey);
    if (prior) return prior;
    this.seq += 1;
    const row = { ...input, id: `ra_${this.seq}` };
    this.rows.set(row.id, row);
    return { ...row };
  }

  async get(id: string): Promise<RefundApprovalRecord | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  async byKey(key: string): Promise<RefundApprovalRecord | null> {
    const r = [...this.rows.values()].find((x) => x.idempotencyKey === key);
    return r ? { ...r } : null;
  }

  async list(filter: { pending: boolean; cityId?: string | undefined; limit: number }): Promise<RefundApprovalRecord[]> {
    const rows = [...this.rows.values()].filter((r) => (r.state === 'pending') === filter.pending && (!filter.cityId || r.cityId === filter.cityId));
    rows.sort((a, b) => (filter.pending ? a.requestedAt.getTime() - b.requestedAt.getTime() : (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0)));
    return rows.slice(0, filter.limit).map((r) => ({ ...r }));
  }

  async pendingFor(filter: { ticketId?: string; orderId?: string }): Promise<RefundApprovalRecord[]> {
    return (await this.list({ pending: true, limit: Number.MAX_SAFE_INTEGER })).filter((r) => (filter.ticketId ? r.ticketId === filter.ticketId : true) && (filter.orderId ? r.orderId === filter.orderId : true));
  }

  async decide(id: string, decision: Decision): Promise<RefundApprovalRecord | null> {
    const r = this.rows.get(id);
    if (!r || r.state !== 'pending') return null;
    Object.assign(r, decision);
    return { ...r };
  }
}

type Row = {
  id: string;
  kind: string;
  cityId: string;
  ticketId: string | null;
  orderId: string | null;
  amountIqd: number;
  limitKind: string;
  payload: unknown;
  requestedBy: string;
  requestedAt: Date;
  state: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  declineNote: string | null;
  idempotencyKey: string;
};

function recordFrom(r: Row): RefundApprovalRecord {
  return {
    id: r.id,
    kind: r.kind as RefundApprovalKind,
    cityId: r.cityId,
    ticketId: r.ticketId,
    orderId: r.orderId,
    amountIqd: r.amountIqd,
    limitKind: r.limitKind as RefundApprovalLimit,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    requestedBy: r.requestedBy,
    requestedAt: r.requestedAt,
    state: r.state as RefundApprovalState,
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt,
    declineNote: r.declineNote,
    idempotencyKey: r.idempotencyKey,
  };
}

const PICK = {
  id: true,
  kind: true,
  cityId: true,
  ticketId: true,
  orderId: true,
  amountIqd: true,
  limitKind: true,
  payload: true,
  requestedBy: true,
  requestedAt: true,
  state: true,
  decidedBy: true,
  decidedAt: true,
  declineNote: true,
  idempotencyKey: true,
} as const;

export class PrismaRefundApprovalsRepository implements RefundApprovalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async create(input: Omit<RefundApprovalRecord, 'id'>, tx?: Tx): Promise<RefundApprovalRecord> {
    const { payload, ...rest } = input;
    const prior = await this.byKey(input.idempotencyKey, tx);
    if (prior) return prior;
    // Two clicks at once: the second insert loses on the unique key and reads the first. Inside a
    // transaction a failed insert would abort it, so the conflict is skipped in SQL instead.
    const rows = await this.db(tx).refundApproval.createManyAndReturn({ data: [{ ...rest, payload: payload as object }], skipDuplicates: true, select: PICK });
    const row = rows[0] ?? (await this.db(tx).refundApproval.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: PICK }));
    if (!row) throw new Error(`refund approval ${input.idempotencyKey} vanished`);
    return recordFrom(row);
  }

  async get(id: string, tx?: Tx): Promise<RefundApprovalRecord | null> {
    const r = await this.db(tx).refundApproval.findUnique({ where: { id }, select: PICK });
    return r ? recordFrom(r) : null;
  }

  async byKey(key: string, tx?: Tx): Promise<RefundApprovalRecord | null> {
    const r = await this.db(tx).refundApproval.findUnique({ where: { idempotencyKey: key }, select: PICK });
    return r ? recordFrom(r) : null;
  }

  async list(filter: { pending: boolean; cityId?: string | undefined; limit: number }, tx?: Tx): Promise<RefundApprovalRecord[]> {
    const rows = await this.db(tx).refundApproval.findMany({
      where: { state: filter.pending ? 'pending' : { not: 'pending' }, ...(filter.cityId ? { cityId: filter.cityId } : {}) },
      orderBy: filter.pending ? { requestedAt: 'asc' } : { decidedAt: 'desc' },
      take: filter.limit,
      select: PICK,
    });
    return rows.map(recordFrom);
  }

  async pendingFor(filter: { ticketId?: string; orderId?: string }, tx?: Tx): Promise<RefundApprovalRecord[]> {
    const rows = await this.db(tx).refundApproval.findMany({
      where: { state: 'pending', ...(filter.ticketId ? { ticketId: filter.ticketId } : {}), ...(filter.orderId ? { orderId: filter.orderId } : {}) },
      orderBy: { requestedAt: 'asc' },
      select: PICK,
    });
    return rows.map(recordFrom);
  }

  async decide(id: string, decision: Decision, tx?: Tx): Promise<RefundApprovalRecord | null> {
    const { count } = await this.db(tx).refundApproval.updateMany({ where: { id, state: 'pending' }, data: decision });
    return count === 1 ? this.get(id, tx) : null;
  }
}

/** Posts an approved refund through the path that asked for it, in the decision's transaction. */
export type RefundApprovalApplier = (row: RefundApprovalRecord, approverId: string, tx: Tx) => Promise<void>;

@Injectable()
export class RefundApprovalsService {
  private readonly appliers = new Map<RefundApprovalKind, RefundApprovalApplier>();

  constructor(
    @Inject(REFUND_APPROVALS_REPOSITORY) private readonly repo: RefundApprovalsRepository,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The ticket path (support) and the complaint path (orders) each register how an approved refund posts. */
  register(kind: RefundApprovalKind, applier: RefundApprovalApplier): () => void {
    this.appliers.set(kind, applier);
    return () => {
      if (this.appliers.get(kind) === applier) this.appliers.delete(kind);
    };
  }

  /** Records the request (the same key twice is the first row). Nothing posts. */
  request(input: NewRefundApproval, tx?: Tx): Promise<RefundApprovalRecord> {
    return this.repo.create({ ...input, requestedAt: this.clock.now(), state: 'pending', decidedBy: null, decidedAt: null, declineNote: null }, tx);
  }

  get(id: string, tx?: Tx): Promise<RefundApprovalRecord | null> {
    return this.repo.get(id, tx);
  }

  list(filter: { pending: boolean; cityId?: string | undefined }, tx?: Tx): Promise<RefundApprovalRecord[]> {
    return this.repo.list({ ...filter, limit: LIST_LIMIT }, tx);
  }

  pendingFor(filter: { ticketId?: string; orderId?: string }, tx?: Tx): Promise<RefundApprovalRecord[]> {
    return this.repo.pendingFor(filter, tx);
  }

  byKey(key: string, tx?: Tx): Promise<RefundApprovalRecord | null> {
    return this.repo.byKey(key, tx);
  }

  /**
   * Someone other than the requester lets it post: the row moves to `approved` and the refund posts in
   * the same transaction, so a refund that can no longer post (case closed, more than the order) leaves
   * the request pending with that error. `after` runs in the transaction too (audit, events).
   */
  approve(approverId: string, id: string, after?: (row: RefundApprovalRecord, tx: Tx) => Promise<void>): Promise<RefundApprovalRecord> {
    return this.uow.run(async (tx) => {
      const row = await this.pending(id, tx);
      if (row.requestedBy === approverId) throw new DriverError('approval_own_item');
      const applier = this.appliers.get(row.kind);
      if (!applier) throw new Error(`no refund applier for ${row.kind}`);
      // Post first, then move the row only if it is still pending: a refund that cannot post leaves it
      // pending, and a second approver racing this one fails (its transaction, posting included, rolls back).
      await applier(row, approverId, tx);
      const decided = await this.repo.decide(id, { state: 'approved', decidedBy: approverId, decidedAt: this.clock.now(), declineNote: null }, tx);
      if (!decided) throw new DriverError('approval_state_conflict');
      if (after) await after(decided, tx);
      return decided;
    });
  }

  decline(approverId: string, id: string, note: string, after?: (row: RefundApprovalRecord, tx: Tx) => Promise<void>): Promise<RefundApprovalRecord> {
    return this.uow.run(async (tx) => {
      const row = await this.pending(id, tx);
      if (row.requestedBy === approverId) throw new DriverError('approval_own_item');
      const decided = await this.repo.decide(id, { state: 'declined', decidedBy: approverId, decidedAt: this.clock.now(), declineNote: note }, tx);
      if (!decided) throw new DriverError('approval_state_conflict');
      if (after) await after(decided, tx);
      return decided;
    });
  }

  /** The requester takes it back; anyone else is refused (`forbidden`). */
  cancel(personId: string, id: string, after?: (row: RefundApprovalRecord, tx: Tx) => Promise<void>): Promise<RefundApprovalRecord> {
    return this.uow.run(async (tx) => {
      const row = await this.pending(id, tx);
      if (row.requestedBy !== personId) throw new DriverError('forbidden');
      const decided = await this.repo.decide(id, { state: 'cancelled', decidedBy: personId, decidedAt: this.clock.now(), declineNote: null }, tx);
      if (!decided) throw new DriverError('approval_state_conflict');
      if (after) await after(decided, tx);
      return decided;
    });
  }

  private async pending(id: string, tx: Tx): Promise<RefundApprovalRecord> {
    const row = await this.repo.get(id, tx);
    if (!row) throw new DriverError('approval_not_found');
    if (row.state !== 'pending') throw new DriverError('approval_state_conflict');
    return row;
  }
}
