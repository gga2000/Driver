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

export interface DriverAccountRepository {
  createDocument(input: Omit<DocumentRecord, 'id'>, tx?: Tx): Promise<DocumentRecord>;
  updateDocument(id: string, patch: Partial<Omit<DocumentRecord, 'id' | 'personId' | 'kind'>>, tx?: Tx): Promise<DocumentRecord>;
  document(id: string, tx?: Tx): Promise<DocumentRecord | null>;
  /** Current (not superseded) submissions of these people, oldest first. */
  currentDocuments(personIds: readonly string[], tx?: Tx): Promise<DocumentRecord[]>;
  createCheckIn(input: Omit<CheckInRecord, 'id'>, tx?: Tx): Promise<CheckInRecord>;
  updateCheckIn(id: string, patch: Partial<Pick<CheckInRecord, 'result' | 'submittedAt' | 'livenessScore' | 'failureReason'>>, tx?: Tx): Promise<CheckInRecord>;
  checkIn(id: string, tx?: Tx): Promise<CheckInRecord | null>;
  checkInsOn(personId: string, localDate: string, tx?: Tx): Promise<CheckInRecord[]>;
}

export const DRIVER_ACCOUNT_REPOSITORY = Symbol('DRIVER_ACCOUNT_REPOSITORY');

export class InMemoryDriverAccountRepository implements DriverAccountRepository {
  readonly documents = new Map<string, DocumentRecord>();
  readonly checkIns = new Map<string, CheckInRecord>();
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
}
