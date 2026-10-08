import { Prisma } from '@driver/db';
import type { CommissionTier, HolidayClosure, WeeklyWindow } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import {
  DEFAULT_MERCHANT_SETTINGS,
  isMerchantType,
  setupFrom,
  type MerchantPauseWindow,
  type MerchantSettings,
  type Org,
  type OrgMember,
  type OrgType,
  type PayerApprovalRequest,
} from './orgs.types.js';

export interface OrgFilter {
  cityId?: string;
  types?: readonly OrgType[];
  /** Orgs this person is a member of. */
  memberId?: string;
}

/**
 * `orgs` (+ merchant-setting columns), `org_members` and `payer_approvals`. People are ids only: names
 * and phones are read through identity (vault), never stored here.
 */
export interface OrgsRepository {
  create(input: { type: OrgType; name: string; cityId: string; members: OrgMember[] }, tx?: Tx): Promise<Org>;
  get(orgId: string, tx?: Tx): Promise<Org | null>;
  list(filter: OrgFilter, tx?: Tx): Promise<Org[]>;
  /** Adds the member or replaces its role and limit. */
  upsertMember(orgId: string, member: OrgMember, tx?: Tx): Promise<void>;
  /** Writes only the given settings (concurrent toggles of different settings never overwrite each other). */
  patchMerchant(orgId: string, patch: Partial<MerchantSettings>, tx?: Tx): Promise<void>;
  addApproval(input: Omit<PayerApprovalRequest, 'id'>, tx?: Tx): Promise<PayerApprovalRequest>;
  approval(id: string, tx?: Tx): Promise<PayerApprovalRequest | null>;
  approvalForOrder(orgId: string, orderId: string, tx?: Tx): Promise<PayerApprovalRequest | null>;
  /** Newest first. */
  approvals(orgId: string, filter?: { state?: PayerApprovalRequest['state'] }, tx?: Tx): Promise<PayerApprovalRequest[]>;
  /** pending → decision; null when the request was no longer pending (someone resolved it first). */
  resolveApproval(id: string, decision: 'approved' | 'declined' | 'withdrawn', tx?: Tx): Promise<PayerApprovalRequest | null>;
}

export const ORGS_REPOSITORY = Symbol('ORGS_REPOSITORY');

const clone = <T>(v: T): T => structuredClone(v);

export class InMemoryOrgsRepository implements OrgsRepository {
  private readonly orgs = new Map<string, Org>();
  private readonly approvalRows = new Map<string, PayerApprovalRequest>();
  private seq = 0;

  async create(input: { type: OrgType; name: string; cityId: string; members: OrgMember[] }): Promise<Org> {
    this.seq += 1;
    const org: Org = { id: `org_${this.seq}`, type: input.type, name: input.name, cityId: input.cityId, members: input.members.map((m) => ({ ...m })) };
    if (isMerchantType(input.type)) org.merchant = { ...DEFAULT_MERCHANT_SETTINGS };
    this.orgs.set(org.id, org);
    return clone(org);
  }

  async get(orgId: string): Promise<Org | null> {
    const o = this.orgs.get(orgId);
    return o ? clone(o) : null;
  }

  async list(filter: OrgFilter): Promise<Org[]> {
    return [...this.orgs.values()]
      .filter((o) => (filter.cityId === undefined || o.cityId === filter.cityId) && (!filter.types || filter.types.includes(o.type)) && (!filter.memberId || o.members.some((m) => m.personId === filter.memberId)))
      .map(clone);
  }

  async upsertMember(orgId: string, member: OrgMember): Promise<void> {
    const org = this.orgs.get(orgId);
    if (!org) throw new Error(`org ${orgId} not found`);
    const existing = org.members.find((m) => m.personId === member.personId);
    if (existing) Object.assign(existing, member);
    else org.members.push({ ...member });
  }

  async patchMerchant(orgId: string, patch: Partial<MerchantSettings>): Promise<void> {
    const org = this.orgs.get(orgId);
    if (!org) throw new Error(`org ${orgId} not found`);
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<MerchantSettings>;
    org.merchant = clone({ ...DEFAULT_MERCHANT_SETTINGS, ...org.merchant, ...defined });
  }

  async addApproval(input: Omit<PayerApprovalRequest, 'id'>): Promise<PayerApprovalRequest> {
    if (await this.approvalForOrder(input.orgId, input.orderId)) throw new Error('unique violation: payer_approvals(org_id, order_id)');
    this.seq += 1;
    const row = { ...input, id: `pay_${this.seq}` };
    this.approvalRows.set(row.id, row);
    return { ...row };
  }

  async approval(id: string): Promise<PayerApprovalRequest | null> {
    const r = this.approvalRows.get(id);
    return r ? { ...r } : null;
  }

  async approvalForOrder(orgId: string, orderId: string): Promise<PayerApprovalRequest | null> {
    const r = [...this.approvalRows.values()].find((a) => a.orgId === orgId && a.orderId === orderId);
    return r ? { ...r } : null;
  }

  async approvals(orgId: string, filter: { state?: PayerApprovalRequest['state'] } = {}): Promise<PayerApprovalRequest[]> {
    return [...this.approvalRows.values()]
      .filter((a) => a.orgId === orgId && (!filter.state || a.state === filter.state))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
      .map((a) => ({ ...a }));
  }

  async resolveApproval(id: string, decision: 'approved' | 'declined' | 'withdrawn'): Promise<PayerApprovalRequest | null> {
    const r = this.approvalRows.get(id);
    if (!r || r.state !== 'pending') return null;
    r.state = decision;
    return { ...r };
  }
}

// ───────────────────────── Prisma ─────────────────────────

const ORG_INCLUDE = { members: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] } };

interface OrgRow {
  id: string;
  type: string;
  name: string;
  cityId: string;
  autoAccept: boolean;
  lastHeartbeat: Date | null;
  pauseWindows: unknown;
  busyUntil: Date | null;
  closedAt: Date | null;
  closedReason: string | null;
  closedNote: string | null;
  closedUntil?: Date | null;
  printerState: string | null;
  printerName: string | null;
  printerAt: Date | null;
  defaultPrepMin: number | null;
  commissionTier: string | null;
  locationZoneKey: string | null;
  openingHours?: unknown;
  holidayClosures?: unknown;
  hoursUpdatedAt?: Date | null;
  pickupNote?: string | null;
  pickupPhotoRefs?: string[];
  pickupUpdatedAt?: Date | null;
  setup?: unknown;
  members: Array<{ personId: string; role: string; spendingLimitIqd: number | null; monthlyBudgetIqd?: number | null }>;
}

type Pin = { lat: number; lng: number };

function pauseWindowsFrom(v: unknown): MerchantPauseWindow[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
    .map((w) => ({ dow: Number(w['dow']), start: String(w['start']), end: String(w['end']), ...(typeof w['reason'] === 'string' ? { reason: w['reason'] } : {}) }));
}

function openingHoursFrom(v: unknown): WeeklyWindow[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
    .map((w) => ({ dow: Number(w['dow']), start: String(w['start']), end: String(w['end']) }));
}

function holidaysFrom(v: unknown): HolidayClosure[] | null {
  if (!Array.isArray(v)) return null;
  return v
    .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
    .map((h) => ({
      from: String(h['from']),
      to: String(h['to']),
      note: typeof h['note'] === 'string' ? h['note'] : null,
    }));
}

function orgFromRow(r: OrgRow, pin: Pin | undefined): Org {
  const type = r.type as OrgType;
  const org: Org = {
    id: r.id,
    type,
    name: r.name,
    cityId: r.cityId,
    members: r.members.map((m) => ({ personId: m.personId, role: m.role as OrgMember['role'], spendingLimitIqd: m.spendingLimitIqd, monthlyBudgetIqd: m.monthlyBudgetIqd ?? null })),
  };
  if (isMerchantType(type)) {
    org.merchant = {
      autoAccept: r.autoAccept,
      pauseWindows: pauseWindowsFrom(r.pauseWindows),
      lastHeartbeatAt: r.lastHeartbeat,
      defaultPrepMin: r.defaultPrepMin,
      commissionTier: (r.commissionTier as CommissionTier | null) ?? null,
      location: r.locationZoneKey ? { zoneKey: r.locationZoneKey, ...(pin ? { pin } : {}) } : null,
      busyUntil: r.busyUntil,
      closed: r.closedAt ? { reason: r.closedReason ?? '', note: r.closedNote, at: r.closedAt, until: r.closedUntil ?? null } : null,
      printer: r.printerState && r.printerAt ? { state: r.printerState === 'connected' ? 'connected' : 'disconnected', name: r.printerName, at: r.printerAt } : null,
      openingHours: openingHoursFrom(r.openingHours),
      holidays: holidaysFrom(r.holidayClosures),
      hoursUpdatedAt: r.hoursUpdatedAt ?? null,
      pickupSpot: r.pickupUpdatedAt ? { note: r.pickupNote ?? null, photoRefs: [...(r.pickupPhotoRefs ?? [])], updatedAt: r.pickupUpdatedAt } : null,
      setup: setupFrom(r.setup),
    };
  }
  return org;
}

const APPROVAL_REASONS: ReadonlySet<string> = new Set(['order_limit', 'month_budget', 'both']);

function approvalFromRow(r: { id: string; orgId: string; orderId: string; requestedBy: string; payerId: string; amountIqd: number; state: string; reason?: string | null; createdAt: Date }): PayerApprovalRequest {
  const reason = r.reason && APPROVAL_REASONS.has(r.reason) ? (r.reason as NonNullable<PayerApprovalRequest['reason']>) : null;
  return { id: r.id, orgId: r.orgId, orderId: r.orderId, requestedBy: r.requestedBy, payerId: r.payerId, amountIqd: r.amountIqd, state: r.state as PayerApprovalRequest['state'], reason, createdAt: r.createdAt };
}

export class PrismaOrgsRepository implements OrgsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  /** Kitchen pins (geography) are not readable through the ORM. */
  private async pins(db: Tx, ids: readonly string[]): Promise<Map<string, Pin>> {
    if (ids.length === 0) return new Map();
    const rows = await db.$queryRaw<Array<{ id: string; lat: number; lng: number }>>`
      SELECT "id", ST_Y("location_pin"::geometry) AS lat, ST_X("location_pin"::geometry) AS lng
      FROM "public"."orgs" WHERE "location_pin" IS NOT NULL AND "id" IN (${Prisma.join([...ids])})`;
    return new Map(rows.map((r) => [r.id, { lat: Number(r.lat), lng: Number(r.lng) }]));
  }

  private async hydrate(db: Tx, rows: OrgRow[]): Promise<Org[]> {
    const pins = await this.pins(
      db,
      rows.filter((r) => r.locationZoneKey !== null && isMerchantType(r.type as OrgType)).map((r) => r.id),
    );
    return rows.map((r) => orgFromRow(r, pins.get(r.id)));
  }

  async create(input: { type: OrgType; name: string; cityId: string; members: OrgMember[] }, tx?: Tx): Promise<Org> {
    const db = this.db(tx);
    const row = await db.org.create({
      data: {
        type: input.type,
        name: input.name,
        cityId: input.cityId,
        members: { create: input.members.map((m) => ({ personId: m.personId, role: m.role, spendingLimitIqd: m.spendingLimitIqd, monthlyBudgetIqd: m.monthlyBudgetIqd ?? null })) },
      },
      include: ORG_INCLUDE,
    });
    return orgFromRow(row as unknown as OrgRow, undefined);
  }

  async get(orgId: string, tx?: Tx): Promise<Org | null> {
    const db = this.db(tx);
    const row = await db.org.findUnique({ where: { id: orgId }, include: ORG_INCLUDE });
    return row ? (await this.hydrate(db, [row as unknown as OrgRow]))[0]! : null;
  }

  async list(filter: OrgFilter, tx?: Tx): Promise<Org[]> {
    const db = this.db(tx);
    const rows = await db.org.findMany({
      where: {
        ...(filter.cityId !== undefined ? { cityId: filter.cityId } : {}),
        ...(filter.types ? { type: { in: [...filter.types] } } : {}),
        ...(filter.memberId ? { members: { some: { personId: filter.memberId } } } : {}),
      },
      include: ORG_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return this.hydrate(db, rows as unknown as OrgRow[]);
  }

  async upsertMember(orgId: string, member: OrgMember, tx?: Tx): Promise<void> {
    await this.db(tx).orgMember.upsert({
      where: { orgId_personId: { orgId, personId: member.personId } },
      update: { role: member.role, spendingLimitIqd: member.spendingLimitIqd, monthlyBudgetIqd: member.monthlyBudgetIqd ?? null },
      create: { orgId, personId: member.personId, role: member.role, spendingLimitIqd: member.spendingLimitIqd, monthlyBudgetIqd: member.monthlyBudgetIqd ?? null },
    });
  }

  async patchMerchant(orgId: string, patch: Partial<MerchantSettings>, tx?: Tx): Promise<void> {
    const db = this.db(tx);
    const data: Prisma.OrgUpdateInput = {};
    if (patch.autoAccept !== undefined) data.autoAccept = patch.autoAccept;
    if (patch.pauseWindows !== undefined) data.pauseWindows = patch.pauseWindows === null ? Prisma.DbNull : (patch.pauseWindows as unknown as Prisma.InputJsonValue);
    if (patch.lastHeartbeatAt !== undefined) data.lastHeartbeat = patch.lastHeartbeatAt;
    if (patch.defaultPrepMin !== undefined) data.defaultPrepMin = patch.defaultPrepMin;
    if (patch.commissionTier !== undefined) data.commissionTier = patch.commissionTier;
    if (patch.busyUntil !== undefined) data.busyUntil = patch.busyUntil;
    if (patch.closed !== undefined) Object.assign(data, { closedAt: patch.closed?.at ?? null, closedReason: patch.closed?.reason ?? null, closedNote: patch.closed?.note ?? null, closedUntil: patch.closed?.until ?? null });
    if (patch.printer !== undefined) Object.assign(data, { printerState: patch.printer?.state ?? null, printerName: patch.printer?.name ?? null, printerAt: patch.printer?.at ?? null });
    if (patch.location !== undefined) data.locationZoneKey = patch.location?.zoneKey ?? null;
    if (patch.openingHours !== undefined)
      data.openingHours =
        patch.openingHours === null
          ? Prisma.DbNull
          : (patch.openingHours as unknown as Prisma.InputJsonValue);
    if (patch.holidays !== undefined)
      data.holidayClosures =
        patch.holidays === null
          ? Prisma.DbNull
          : (patch.holidays as unknown as Prisma.InputJsonValue);
    if (patch.hoursUpdatedAt !== undefined) data.hoursUpdatedAt = patch.hoursUpdatedAt;
    if (patch.setup !== undefined) data.setup = patch.setup === null ? Prisma.DbNull : (JSON.parse(JSON.stringify(patch.setup)) as Prisma.InputJsonValue);
    if (patch.pickupSpot !== undefined) Object.assign(data, { pickupNote: patch.pickupSpot?.note ?? null, pickupPhotoRefs: patch.pickupSpot?.photoRefs ?? [], pickupUpdatedAt: patch.pickupSpot?.updatedAt ?? null });
    await db.org.update({ where: { id: orgId }, data });
    if (patch.location !== undefined) {
      const pin = patch.location?.pin;
      if (pin) await db.$executeRaw`UPDATE "public"."orgs" SET "location_pin" = ST_SetSRID(ST_MakePoint(${pin.lng}, ${pin.lat}), 4326)::geography WHERE "id" = ${orgId}`;
      else await db.$executeRaw`UPDATE "public"."orgs" SET "location_pin" = NULL WHERE "id" = ${orgId}`;
    }
  }

  async addApproval(input: Omit<PayerApprovalRequest, 'id'>, tx?: Tx): Promise<PayerApprovalRequest> {
    const { reason, ...rest } = input;
    return approvalFromRow(await this.db(tx).payerApproval.create({ data: { ...rest, reason: reason ?? null } }));
  }

  async approval(id: string, tx?: Tx): Promise<PayerApprovalRequest | null> {
    const r = await this.db(tx).payerApproval.findUnique({ where: { id } });
    return r ? approvalFromRow(r) : null;
  }

  async approvalForOrder(orgId: string, orderId: string, tx?: Tx): Promise<PayerApprovalRequest | null> {
    const r = await this.db(tx).payerApproval.findUnique({ where: { orgId_orderId: { orgId, orderId } } });
    return r ? approvalFromRow(r) : null;
  }

  async approvals(orgId: string, filter: { state?: PayerApprovalRequest['state'] } = {}, tx?: Tx): Promise<PayerApprovalRequest[]> {
    const rows = await this.db(tx).payerApproval.findMany({ where: { orgId, ...(filter.state ? { state: filter.state } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return rows.map(approvalFromRow);
  }

  async resolveApproval(id: string, decision: 'approved' | 'declined' | 'withdrawn', tx?: Tx): Promise<PayerApprovalRequest | null> {
    const db = this.db(tx);
    const { count } = await db.payerApproval.updateMany({ where: { id, state: 'pending' }, data: { state: decision } });
    if (count === 0) return null;
    return this.approval(id, db);
  }
}
