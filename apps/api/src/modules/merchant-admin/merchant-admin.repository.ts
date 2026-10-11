import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** `merchant_dispute_responses`: the merchant's one answer per disputed order (re-answering replaces it). */
export interface DisputeResponseRecord {
  id: string;
  orderId: string;
  merchantOrgId: string;
  decision: 'accept_default' | 'contest';
  note: string | null;
  evidenceRefs: string[];
  respondedById: string;
  at: Date;
}

export type StaffInviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

/**
 * `merchant_staff_invites` (PRV-08): one row per store and person. The person joins the store only
 * when he accepts; re-inviting resets the row to pending. Ids only (number and name stay in the vault).
 */
export interface StaffInviteRecord {
  id: string;
  merchantOrgId: string;
  personId: string;
  role: 'merchant_owner' | 'merchant_staff';
  invitedById: string;
  status: StaffInviteStatus;
  createdAt: Date;
  /** The last time it went out (the invite, or the latest resend). */
  sentAt: Date;
  answeredAt: Date | null;
  expiresAt: Date;
}

export interface MerchantAdminRepository {
  upsertResponse(input: Omit<DisputeResponseRecord, 'id'>, tx?: Tx): Promise<DisputeResponseRecord>;
  responses(orderIds: readonly string[], tx?: Tx): Promise<DisputeResponseRecord[]>;
  /** Creates the store's invite for the person, or resets the existing one (a fresh pending invite). */
  upsertStaffInvite(input: Omit<StaffInviteRecord, 'id' | 'status' | 'answeredAt'>, tx?: Tx): Promise<StaffInviteRecord>;
  staffInvite(merchantOrgId: string, personId: string, tx?: Tx): Promise<StaffInviteRecord | null>;
  /** The store's invites still in `pending` (expired ones included; the caller filters by time). */
  pendingStaffInvitesOfOrg(merchantOrgId: string, tx?: Tx): Promise<StaffInviteRecord[]>;
  /** The person's invites still in `pending`, across stores. */
  pendingStaffInvitesOfPerson(personId: string, tx?: Tx): Promise<StaffInviteRecord[]>;
  updateStaffInvite(id: string, patch: Partial<Pick<StaffInviteRecord, 'status' | 'sentAt' | 'answeredAt' | 'role'>>, tx?: Tx): Promise<StaffInviteRecord>;
}

export const MERCHANT_ADMIN_REPOSITORY = Symbol('MERCHANT_ADMIN_REPOSITORY');

export class InMemoryMerchantAdminRepository implements MerchantAdminRepository {
  readonly rows = new Map<string, DisputeResponseRecord>();
  private seq = 0;

  async upsertResponse(input: Omit<DisputeResponseRecord, 'id'>): Promise<DisputeResponseRecord> {
    const existing = this.rows.get(input.orderId);
    this.seq += 1;
    const row = { id: existing?.id ?? `mdr_${this.seq}`, ...input, evidenceRefs: [...input.evidenceRefs] };
    this.rows.set(input.orderId, row);
    return { ...row };
  }

  async responses(orderIds: readonly string[]): Promise<DisputeResponseRecord[]> {
    return orderIds.map((id) => this.rows.get(id)).filter((r): r is DisputeResponseRecord => Boolean(r)).map((r) => ({ ...r }));
  }

  readonly invites = new Map<string, StaffInviteRecord>();

  async upsertStaffInvite(input: Omit<StaffInviteRecord, 'id' | 'status' | 'answeredAt'>): Promise<StaffInviteRecord> {
    const key = `${input.merchantOrgId}:${input.personId}`;
    const existing = this.invites.get(key);
    this.seq += 1;
    const row: StaffInviteRecord = { id: existing?.id ?? `msi_${this.seq}`, ...input, status: 'pending', answeredAt: null };
    this.invites.set(key, row);
    return { ...row };
  }

  async staffInvite(merchantOrgId: string, personId: string): Promise<StaffInviteRecord | null> {
    const row = this.invites.get(`${merchantOrgId}:${personId}`);
    return row ? { ...row } : null;
  }

  async pendingStaffInvitesOfOrg(merchantOrgId: string): Promise<StaffInviteRecord[]> {
    return [...this.invites.values()].filter((r) => r.merchantOrgId === merchantOrgId && r.status === 'pending').map((r) => ({ ...r }));
  }

  async pendingStaffInvitesOfPerson(personId: string): Promise<StaffInviteRecord[]> {
    return [...this.invites.values()].filter((r) => r.personId === personId && r.status === 'pending').map((r) => ({ ...r }));
  }

  async updateStaffInvite(id: string, patch: Partial<Pick<StaffInviteRecord, 'status' | 'sentAt' | 'answeredAt' | 'role'>>): Promise<StaffInviteRecord> {
    const row = [...this.invites.values()].find((r) => r.id === id);
    if (!row) throw new Error(`staff invite ${id} not found`);
    Object.assign(row, patch);
    return { ...row };
  }
}

function fromRow(r: { id: string; orderId: string; merchantOrgId: string; decision: string; note: string | null; evidenceRefs: string[]; respondedById: string; updatedAt: Date }): DisputeResponseRecord {
  return { id: r.id, orderId: r.orderId, merchantOrgId: r.merchantOrgId, decision: r.decision === 'contest' ? 'contest' : 'accept_default', note: r.note, evidenceRefs: [...r.evidenceRefs], respondedById: r.respondedById, at: r.updatedAt };
}

type StaffInviteRow = { id: string; merchantOrgId: string; personId: string; role: string; invitedById: string; status: string; createdAt: Date; sentAt: Date; answeredAt: Date | null; expiresAt: Date };

const INVITE_STATUSES: readonly StaffInviteStatus[] = ['pending', 'accepted', 'declined', 'cancelled'];

function inviteFromRow(r: StaffInviteRow): StaffInviteRecord {
  return {
    id: r.id,
    merchantOrgId: r.merchantOrgId,
    personId: r.personId,
    role: r.role === 'merchant_owner' ? 'merchant_owner' : 'merchant_staff',
    invitedById: r.invitedById,
    status: (INVITE_STATUSES as readonly string[]).includes(r.status) ? (r.status as StaffInviteStatus) : 'cancelled',
    createdAt: r.createdAt,
    sentAt: r.sentAt,
    answeredAt: r.answeredAt,
    expiresAt: r.expiresAt,
  };
}

export class PrismaMerchantAdminRepository implements MerchantAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async upsertResponse(input: Omit<DisputeResponseRecord, 'id'>, tx?: Tx): Promise<DisputeResponseRecord> {
    const data = { merchantOrgId: input.merchantOrgId, decision: input.decision, note: input.note, evidenceRefs: input.evidenceRefs, respondedById: input.respondedById, updatedAt: input.at };
    const row = await this.db(tx).merchantDisputeResponse.upsert({ where: { orderId: input.orderId }, create: { orderId: input.orderId, ...data, createdAt: input.at }, update: data });
    return fromRow(row);
  }

  async responses(orderIds: readonly string[], tx?: Tx): Promise<DisputeResponseRecord[]> {
    if (orderIds.length === 0) return [];
    return (await this.db(tx).merchantDisputeResponse.findMany({ where: { orderId: { in: [...orderIds] } } })).map(fromRow);
  }

  async upsertStaffInvite(input: Omit<StaffInviteRecord, 'id' | 'status' | 'answeredAt'>, tx?: Tx): Promise<StaffInviteRecord> {
    const fresh = { role: input.role, invitedById: input.invitedById, status: 'pending', createdAt: input.createdAt, sentAt: input.sentAt, answeredAt: null, expiresAt: input.expiresAt };
    const row = await this.db(tx).merchantStaffInvite.upsert({
      where: { merchantOrgId_personId: { merchantOrgId: input.merchantOrgId, personId: input.personId } },
      create: { merchantOrgId: input.merchantOrgId, personId: input.personId, ...fresh },
      update: fresh,
    });
    return inviteFromRow(row);
  }

  async staffInvite(merchantOrgId: string, personId: string, tx?: Tx): Promise<StaffInviteRecord | null> {
    const row = await this.db(tx).merchantStaffInvite.findUnique({ where: { merchantOrgId_personId: { merchantOrgId, personId } } });
    return row ? inviteFromRow(row) : null;
  }

  async pendingStaffInvitesOfOrg(merchantOrgId: string, tx?: Tx): Promise<StaffInviteRecord[]> {
    return (await this.db(tx).merchantStaffInvite.findMany({ where: { merchantOrgId, status: 'pending' }, orderBy: { createdAt: 'asc' } })).map(inviteFromRow);
  }

  async pendingStaffInvitesOfPerson(personId: string, tx?: Tx): Promise<StaffInviteRecord[]> {
    return (await this.db(tx).merchantStaffInvite.findMany({ where: { personId, status: 'pending' }, orderBy: { createdAt: 'asc' } })).map(inviteFromRow);
  }

  async updateStaffInvite(id: string, patch: Partial<Pick<StaffInviteRecord, 'status' | 'sentAt' | 'answeredAt' | 'role'>>, tx?: Tx): Promise<StaffInviteRecord> {
    return inviteFromRow(await this.db(tx).merchantStaffInvite.update({ where: { id }, data: patch }));
  }
}
