import type { DriverDocumentKind } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** `driver_documents`: status and expiry only (the photo ref is in the vault). */
export interface DocumentRecord {
  id: string;
  personId: string;
  kind: DriverDocumentKind;
  status: 'pending' | 'approved' | 'rejected';
  expiresAt: Date | null;
  submittedAt: Date;
  reviewedAt: Date | null;
  reviewedById: string | null;
  rejectReason: string | null;
  supersededAt: Date | null;
}

/** `driver_check_ins`: one row per liveness challenge. */
export interface CheckInRecord {
  id: string;
  personId: string;
  localDate: string;
  gesture: string;
  issuedAt: Date;
  expiresAt: Date;
  result: 'pending' | 'passed' | 'failed';
  submittedAt: Date | null;
  livenessScore: number | null;
  failureReason: string | null;
}

/** `driver_pauses`: staff paused him while a report is looked into (r6); open while `liftedAt` is null. */
export interface PauseRecord {
  id: string;
  personId: string;
  reason: 'safety_report' | 'other';
  ticketId: string | null;
  note: string;
  pausedAt: Date;
  pausedById: string;
  liftedAt: Date | null;
  liftedById: string | null;
  liftNote: string | null;
}

export interface DriverAccountRepository {
  createDocument(input: Omit<DocumentRecord, 'id'>, tx?: Tx): Promise<DocumentRecord>;
  updateDocument(id: string, patch: Partial<Omit<DocumentRecord, 'id' | 'personId' | 'kind'>>, tx?: Tx): Promise<DocumentRecord>;
  document(id: string, tx?: Tx): Promise<DocumentRecord | null>;
  /** Current (not superseded) submissions of these people, oldest first. */
  currentDocuments(personIds: readonly string[], tx?: Tx): Promise<DocumentRecord[]>;
  /** Current submissions waiting for review, oldest first (Console approvals queue). */
  pendingDocuments(limit: number, tx?: Tx): Promise<DocumentRecord[]>;
  createCheckIn(input: Omit<CheckInRecord, 'id'>, tx?: Tx): Promise<CheckInRecord>;
  updateCheckIn(id: string, patch: Partial<Pick<CheckInRecord, 'result' | 'submittedAt' | 'livenessScore' | 'failureReason'>>, tx?: Tx): Promise<CheckInRecord>;
  checkIn(id: string, tx?: Tx): Promise<CheckInRecord | null>;
  checkInsOn(personId: string, localDate: string, tx?: Tx): Promise<CheckInRecord[]>;
  /** His open pause (the latest when, against the rules, two are open), or null. */
  activePause(personId: string, tx?: Tx): Promise<PauseRecord | null>;
  createPause(input: Omit<PauseRecord, 'id' | 'liftedAt' | 'liftedById' | 'liftNote'>, tx?: Tx): Promise<PauseRecord>;
  liftPause(id: string, patch: { liftedAt: Date; liftedById: string; liftNote: string }, tx?: Tx): Promise<PauseRecord>;
}

/** Prisma's unique-constraint failure (P2002): here, a second open pause for the same person. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

export const DRIVER_ACCOUNT_REPOSITORY = Symbol('DRIVER_ACCOUNT_REPOSITORY');

export class InMemoryDriverAccountRepository implements DriverAccountRepository {
  readonly documents = new Map<string, DocumentRecord>();
  readonly checkIns = new Map<string, CheckInRecord>();
  readonly pauses = new Map<string, PauseRecord>();
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async createDocument(input: Omit<DocumentRecord, 'id'>): Promise<DocumentRecord> {
    const row = { id: this.id('ddoc'), ...input };
    this.documents.set(row.id, row);
    return { ...row };
  }

  async updateDocument(id: string, patch: Partial<Omit<DocumentRecord, 'id' | 'personId' | 'kind'>>): Promise<DocumentRecord> {
    const row = this.documents.get(id);
    if (!row) throw new Error(`document ${id} not found`);
    Object.assign(row, patch);
    return { ...row };
  }

  async document(id: string): Promise<DocumentRecord | null> {
    const row = this.documents.get(id);
    return row ? { ...row } : null;
  }

  async currentDocuments(personIds: readonly string[]): Promise<DocumentRecord[]> {
    return [...this.documents.values()].filter((d) => personIds.includes(d.personId) && d.supersededAt === null).map((d) => ({ ...d }));
  }

  async pendingDocuments(limit: number): Promise<DocumentRecord[]> {
    return [...this.documents.values()]
      .filter((d) => d.status === 'pending' && d.supersededAt === null)
      .sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((d) => ({ ...d }));
  }

  async createCheckIn(input: Omit<CheckInRecord, 'id'>): Promise<CheckInRecord> {
    const row = { id: this.id('chk'), ...input };
    this.checkIns.set(row.id, row);
    return { ...row };
  }

  async updateCheckIn(id: string, patch: Partial<Pick<CheckInRecord, 'result' | 'submittedAt' | 'livenessScore' | 'failureReason'>>): Promise<CheckInRecord> {
    const row = this.checkIns.get(id);
    if (!row) throw new Error(`check-in ${id} not found`);
    Object.assign(row, patch);
    return { ...row };
  }

  async checkIn(id: string): Promise<CheckInRecord | null> {
    const row = this.checkIns.get(id);
    return row ? { ...row } : null;
  }

  async checkInsOn(personId: string, localDate: string): Promise<CheckInRecord[]> {
    return [...this.checkIns.values()].filter((c) => c.personId === personId && c.localDate === localDate).map((c) => ({ ...c }));
  }

  async activePause(personId: string): Promise<PauseRecord | null> {
    const open = [...this.pauses.values()].filter((p) => p.personId === personId && p.liftedAt === null).sort((a, b) => b.pausedAt.getTime() - a.pausedAt.getTime());
    return open[0] ? { ...open[0] } : null;
  }

  async createPause(input: Omit<PauseRecord, 'id' | 'liftedAt' | 'liftedById' | 'liftNote'>): Promise<PauseRecord> {
    // Mirrors the partial unique index driver_pauses_one_open_per_person.
    if (await this.activePause(input.personId)) throw Object.assign(new Error('one open pause per person'), { code: 'P2002' });
    const row: PauseRecord = { id: this.id('dpause'), ...input, liftedAt: null, liftedById: null, liftNote: null };
    this.pauses.set(row.id, row);
    return { ...row };
  }

  async liftPause(id: string, patch: { liftedAt: Date; liftedById: string; liftNote: string }): Promise<PauseRecord> {
    const row = this.pauses.get(id);
    if (!row) throw new Error(`pause ${id} not found`);
    Object.assign(row, patch);
    return { ...row };
  }
}

export class PrismaDriverAccountRepository implements DriverAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async createDocument(input: Omit<DocumentRecord, 'id'>, tx?: Tx): Promise<DocumentRecord> {
    return (await this.db(tx).driverDocument.create({ data: input })) as DocumentRecord;
  }

  async updateDocument(id: string, patch: Partial<Omit<DocumentRecord, 'id' | 'personId' | 'kind'>>, tx?: Tx): Promise<DocumentRecord> {
    return (await this.db(tx).driverDocument.update({ where: { id }, data: patch })) as DocumentRecord;
  }

  async document(id: string, tx?: Tx): Promise<DocumentRecord | null> {
    return (await this.db(tx).driverDocument.findUnique({ where: { id } })) as DocumentRecord | null;
  }

  async currentDocuments(personIds: readonly string[], tx?: Tx): Promise<DocumentRecord[]> {
    if (personIds.length === 0) return [];
    return (await this.db(tx).driverDocument.findMany({ where: { personId: { in: [...personIds] }, supersededAt: null }, orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }] })) as DocumentRecord[];
  }

  async pendingDocuments(limit: number, tx?: Tx): Promise<DocumentRecord[]> {
    return (await this.db(tx).driverDocument.findMany({ where: { status: 'pending', supersededAt: null }, orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }], take: limit })) as DocumentRecord[];
  }

  async createCheckIn(input: Omit<CheckInRecord, 'id'>, tx?: Tx): Promise<CheckInRecord> {
    return (await this.db(tx).driverCheckIn.create({ data: input })) as CheckInRecord;
  }

  async updateCheckIn(id: string, patch: Partial<Pick<CheckInRecord, 'result' | 'submittedAt' | 'livenessScore' | 'failureReason'>>, tx?: Tx): Promise<CheckInRecord> {
    return (await this.db(tx).driverCheckIn.update({ where: { id }, data: patch })) as CheckInRecord;
  }

  async checkIn(id: string, tx?: Tx): Promise<CheckInRecord | null> {
    return (await this.db(tx).driverCheckIn.findUnique({ where: { id } })) as CheckInRecord | null;
  }

  async checkInsOn(personId: string, localDate: string, tx?: Tx): Promise<CheckInRecord[]> {
    return (await this.db(tx).driverCheckIn.findMany({ where: { personId, localDate }, orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }] })) as CheckInRecord[];
  }

  async activePause(personId: string, tx?: Tx): Promise<PauseRecord | null> {
    return (await this.db(tx).driverPause.findFirst({ where: { personId, liftedAt: null }, orderBy: [{ pausedAt: 'desc' }, { id: 'desc' }] })) as PauseRecord | null;
  }

  async createPause(input: Omit<PauseRecord, 'id' | 'liftedAt' | 'liftedById' | 'liftNote'>, tx?: Tx): Promise<PauseRecord> {
    return (await this.db(tx).driverPause.create({ data: input })) as PauseRecord;
  }

  async liftPause(id: string, patch: { liftedAt: Date; liftedById: string; liftNote: string }, tx?: Tx): Promise<PauseRecord> {
    return (await this.db(tx).driverPause.update({ where: { id }, data: patch })) as PauseRecord;
  }
}
