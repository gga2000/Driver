import type { OtpPurpose, RoleKind } from '@driver/contracts';
import type { TrustTier } from '@driver/db';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/**
 * The identity module's persistence port. This file (and `prisma.repository.ts`, which implements
 * it) are the ONLY code allowed to touch `prisma.personIdentity` / `prisma.vaultAccessLog`
 * (domain §13: the vault). `vault-isolation.test.ts` scans the API source to keep it that way.
 *
 * Every method takes an optional `Tx`: inside `UnitOfWork.run` services pass the transaction so
 * the aggregate rows and the outbox commit together; plain reads may omit it.
 */

export interface PersonRecord {
  id: string;
  locale: string;
  trustTier: string;
  lastVerifiedAt: Date | null;
  sharedFamilyPhone: boolean;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface RoleRecord {
  id: string;
  personId: string;
  kind: RoleKind;
  orgId: string | null;
  grantedBy: string | null;
  frozenAt: Date | null;
  revokedAt: Date | null;
}

export interface DeviceRecord {
  id: string;
  personId: string;
  platform: string;
  appVersion: string | null;
  fingerprint: string;
  verifiedAt: Date | null;
  lastSeenAt: Date | null;
}

export interface SessionRecord {
  id: string;
  personId: string;
  deviceId: string | null;
  refreshTokenHash: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface OtpRecord {
  id: string;
  phoneHash: string;
  codeHash: string;
  purpose: OtpPurpose;
  attempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
  lockedAt: Date | null;
  createdAt: Date;
}

export type GuardianLinkState = 'pending' | 'active' | 'revoked';

export interface GuardianLinkRecord {
  id: string;
  guardianId: string;
  wardPersonId: string | null;
  wardParticipantId: string | null;
  state: GuardianLinkState;
  consentedAt: Date | null;
  revokedAt: Date | null;
}

/** vault.person_identities — the only place a phone number or name is stored. */
export interface IdentityRecord {
  personId: string;
  phoneE164: string;
  phoneHash: string;
  name: string | null;
}

export interface VaultAccessLogRecord {
  id: string;
  personId: string;
  accessorId: string;
  purpose: string;
  fieldsRead: string[];
  createdAt: Date;
}

export interface IdentityRepository {
  // people
  findPersonById(id: string, tx?: Tx): Promise<PersonRecord | null>;
  findPersonByPhoneHash(phoneHash: string, tx?: Tx): Promise<PersonRecord | null>;
  createPersonWithIdentity(
    input: { locale: string; sharedFamilyPhone: boolean; phoneE164: string; phoneHash: string; name: string | null; now: Date },
    tx?: Tx,
  ): Promise<PersonRecord>;
  updatePerson(id: string, patch: Partial<Pick<PersonRecord, 'lastVerifiedAt' | 'sharedFamilyPhone' | 'locale' | 'trustTier'>>, tx?: Tx): Promise<PersonRecord>;

  // vault
  readIdentity(personId: string, tx?: Tx): Promise<IdentityRecord | null>;
  updateIdentity(personId: string, patch: Partial<Pick<IdentityRecord, 'phoneE164' | 'phoneHash' | 'name'>>, tx?: Tx): Promise<IdentityRecord>;
  logVaultAccess(entry: { personId: string; accessorId: string; purpose: string; fieldsRead: string[]; now: Date }, tx?: Tx): Promise<VaultAccessLogRecord>;
  vaultAccessLogs(personId: string, tx?: Tx): Promise<VaultAccessLogRecord[]>;

  // roles
  rolesOf(personId: string, tx?: Tx): Promise<RoleRecord[]>;
  upsertRole(input: { personId: string; kind: RoleKind; orgId: string | null; grantedBy: string | null; now: Date }, tx?: Tx): Promise<{ role: RoleRecord; created: boolean }>;
  revokeRole(id: string, now: Date, tx?: Tx): Promise<RoleRecord>;
  setRolesFrozen(personId: string, kinds: readonly RoleKind[], frozenAt: Date | null, tx?: Tx): Promise<number>;
  /**
   * People holding a live grant of any of `kinds`, ordered by id, starting after `afterId`, each
   * with their live roles; `total` counts every match (before paging). No vault fields.
   */
  peopleWithRoles(kinds: readonly RoleKind[], page: RosterPage, tx?: Tx): Promise<{ people: Array<{ person: PersonRecord; roles: RoleRecord[] }>; total: number }>;

  // devices
  findDevice(personId: string, fingerprint: string, tx?: Tx): Promise<DeviceRecord | null>;
  findDeviceById(id: string, tx?: Tx): Promise<DeviceRecord | null>;
  createDevice(input: { personId: string; fingerprint: string; platform: string; appVersion: string | null; verifiedAt: Date | null; now: Date }, tx?: Tx): Promise<DeviceRecord>;
  updateDevice(id: string, patch: Partial<Pick<DeviceRecord, 'verifiedAt' | 'lastSeenAt' | 'appVersion'>>, tx?: Tx): Promise<DeviceRecord>;

  // sessions
  createSession(input: { personId: string; deviceId: string | null; refreshTokenHash: string; expiresAt: Date; now: Date }, tx?: Tx): Promise<SessionRecord>;
  findSessionById(id: string, tx?: Tx): Promise<SessionRecord | null>;
  findSessionByRefreshHash(hash: string, tx?: Tx): Promise<SessionRecord | null>;
  updateSession(id: string, patch: Partial<Pick<SessionRecord, 'refreshTokenHash' | 'expiresAt' | 'rotatedAt' | 'revokedAt' | 'deviceId'>>, tx?: Tx): Promise<SessionRecord>;
  revokeSessionsOf(personId: string, now: Date, tx?: Tx): Promise<number>;

  // otp
  latestOtp(phoneHash: string, purpose: OtpPurpose, tx?: Tx): Promise<OtpRecord | null>;
  createOtp(input: { phoneHash: string; codeHash: string; purpose: OtpPurpose; expiresAt: Date; now: Date }, tx?: Tx): Promise<OtpRecord>;
  updateOtp(id: string, patch: Partial<Pick<OtpRecord, 'attempts' | 'verifiedAt' | 'lockedAt'>>, tx?: Tx): Promise<OtpRecord>;

  // guardian links
  createGuardianLink(input: { guardianId: string; wardPersonId: string | null; wardParticipantId: string | null; now: Date }, tx?: Tx): Promise<GuardianLinkRecord>;
  findGuardianLink(id: string, tx?: Tx): Promise<GuardianLinkRecord | null>;
  findPendingGuardianLink(guardianId: string, ward: { wardPersonId: string | null; wardParticipantId: string | null }, tx?: Tx): Promise<GuardianLinkRecord | null>;
  updateGuardianLink(id: string, patch: Partial<Pick<GuardianLinkRecord, 'state' | 'consentedAt' | 'revokedAt'>>, tx?: Tx): Promise<GuardianLinkRecord>;
  guardianLinksOf(guardianId: string, tx?: Tx): Promise<GuardianLinkRecord[]>;
}

export interface RosterPage {
  afterId?: string | undefined;
  limit: number;
  /** Person id substring, case-insensitive. */
  idContains?: string | undefined;
}

export const IDENTITY_REPOSITORY = Symbol('IDENTITY_REPOSITORY');

// ───────────────────────── Prisma implementation ─────────────────────────

/** Bound when DATABASE_URL is set. Vault tables are read and written here and nowhere else. */
export class PrismaIdentityRepository implements IdentityRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async findPersonById(id: string, tx?: Tx) {
    return this.db(tx).person.findUnique({ where: { id } });
  }

  async findPersonByPhoneHash(phoneHash: string, tx?: Tx) {
    const identity = await this.db(tx).personIdentity.findUnique({ where: { phoneHash }, include: { person: true } });
    return identity?.person ?? null;
  }

  async createPersonWithIdentity(
    input: { locale: string; sharedFamilyPhone: boolean; phoneE164: string; phoneHash: string; name: string | null; now: Date },
    tx?: Tx,
  ) {
    return this.db(tx).person.create({
      data: {
        locale: input.locale,
        sharedFamilyPhone: input.sharedFamilyPhone,
        identity: { create: { phoneE164: input.phoneE164, phoneHash: input.phoneHash, name: input.name } },
      },
    });
  }

  async updatePerson(id: string, patch: Partial<Pick<PersonRecord, 'lastVerifiedAt' | 'sharedFamilyPhone' | 'locale' | 'trustTier'>>, tx?: Tx) {
    const { trustTier, ...rest } = patch;
    return this.db(tx).person.update({ where: { id }, data: { ...rest, ...(trustTier ? { trustTier: trustTier as TrustTier } : {}) } });
  }

  async readIdentity(personId: string, tx?: Tx) {
    const row = await this.db(tx).personIdentity.findUnique({ where: { personId } });
    return row ? { personId: row.personId, phoneE164: row.phoneE164, phoneHash: row.phoneHash, name: row.name } : null;
  }

  async updateIdentity(personId: string, patch: Partial<Pick<IdentityRecord, 'phoneE164' | 'phoneHash' | 'name'>>, tx?: Tx) {
    const row = await this.db(tx).personIdentity.update({ where: { personId }, data: patch });
    return { personId: row.personId, phoneE164: row.phoneE164, phoneHash: row.phoneHash, name: row.name };
  }

  async logVaultAccess(entry: { personId: string; accessorId: string; purpose: string; fieldsRead: string[]; now: Date }, tx?: Tx) {
    const { personId, accessorId, purpose, fieldsRead } = entry;
    const data = { personId, accessorId, purpose, fieldsRead };
    return this.db(tx).vaultAccessLog.create({ data });
  }

  async vaultAccessLogs(personId: string, tx?: Tx) {
    return this.db(tx).vaultAccessLog.findMany({ where: { personId }, orderBy: { createdAt: 'asc' } });
  }

  async rolesOf(personId: string, tx?: Tx) {
    return this.db(tx).role.findMany({ where: { personId, revokedAt: null } });
  }

  async upsertRole(input: { personId: string; kind: RoleKind; orgId: string | null; grantedBy: string | null; now: Date }, tx?: Tx) {
    const db = this.db(tx);
    const existing = await db.role.findFirst({ where: { personId: input.personId, kind: input.kind, orgId: input.orgId } });
    if (existing && !existing.revokedAt) return { role: existing, created: false };
    if (existing) {
      const role = await db.role.update({ where: { id: existing.id }, data: { revokedAt: null, frozenAt: null, grantedBy: input.grantedBy } });
      return { role, created: true };
    }
    const role = await db.role.create({ data: { personId: input.personId, kind: input.kind, orgId: input.orgId, grantedBy: input.grantedBy } });
    return { role, created: true };
  }

  async revokeRole(id: string, now: Date, tx?: Tx) {
    return this.db(tx).role.update({ where: { id }, data: { revokedAt: now } });
  }

  async setRolesFrozen(personId: string, kinds: readonly RoleKind[], frozenAt: Date | null, tx?: Tx) {
    const res = await this.db(tx).role.updateMany({ where: { personId, kind: { in: [...kinds] }, revokedAt: null }, data: { frozenAt } });
    return res.count;
  }

  async peopleWithRoles(kinds: readonly RoleKind[], page: RosterPage, tx?: Tx) {
    const db = this.db(tx);
    const base = {
      deletedAt: null,
      roles: { some: { kind: { in: [...kinds] }, revokedAt: null } },
      ...(page.idContains ? { id: { contains: page.idContains, mode: 'insensitive' as const } } : {}),
    };
    const [rows, total] = await Promise.all([
      db.person.findMany({
        where: page.afterId ? { AND: [base, { id: { gt: page.afterId } }] } : base,
        orderBy: { id: 'asc' },
        take: page.limit,
        include: { roles: { where: { revokedAt: null } } },
      }),
      db.person.count({ where: base }),
    ]);
    return { people: rows.map(({ roles, ...person }) => ({ person, roles })), total };
  }

  async findDevice(personId: string, fingerprint: string, tx?: Tx) {
    return this.db(tx).device.findUnique({ where: { personId_fingerprint: { personId, fingerprint } } });
  }

  async findDeviceById(id: string, tx?: Tx) {
    return this.db(tx).device.findUnique({ where: { id } });
  }

  async createDevice(input: { personId: string; fingerprint: string; platform: string; appVersion: string | null; verifiedAt: Date | null; now: Date }, tx?: Tx) {
    return this.db(tx).device.create({
      data: {
        personId: input.personId,
        fingerprint: input.fingerprint,
        platform: input.platform,
        appVersion: input.appVersion,
        verifiedAt: input.verifiedAt,
        lastSeenAt: input.now,
      },
    });
  }

  async updateDevice(id: string, patch: Partial<Pick<DeviceRecord, 'verifiedAt' | 'lastSeenAt' | 'appVersion'>>, tx?: Tx) {
    return this.db(tx).device.update({ where: { id }, data: patch });
  }

  async createSession(input: { personId: string; deviceId: string | null; refreshTokenHash: string; expiresAt: Date; now: Date }, tx?: Tx) {
    const { now: _unused, ...data } = input;
    void _unused;
    return this.db(tx).session.create({ data });
  }

  async findSessionById(id: string, tx?: Tx) {
    return this.db(tx).session.findUnique({ where: { id } });
  }

  async findSessionByRefreshHash(hash: string, tx?: Tx) {
    return this.db(tx).session.findUnique({ where: { refreshTokenHash: hash } });
  }

  async updateSession(id: string, patch: Partial<Pick<SessionRecord, 'refreshTokenHash' | 'expiresAt' | 'rotatedAt' | 'revokedAt' | 'deviceId'>>, tx?: Tx) {
    return this.db(tx).session.update({ where: { id }, data: patch });
  }

  async revokeSessionsOf(personId: string, now: Date, tx?: Tx) {
    const res = await this.db(tx).session.updateMany({ where: { personId, revokedAt: null }, data: { revokedAt: now } });
    return res.count;
  }

  async latestOtp(phoneHash: string, purpose: OtpPurpose, tx?: Tx) {
    const row = await this.db(tx).otpChallenge.findFirst({ where: { phoneHash, purpose: toDbPurpose(purpose) }, orderBy: { createdAt: 'desc' } });
    return row ? { ...row, purpose } : null;
  }

  async createOtp(input: { phoneHash: string; codeHash: string; purpose: OtpPurpose; expiresAt: Date; now: Date }, tx?: Tx) {
    const row = await this.db(tx).otpChallenge.create({
      data: { phoneHash: input.phoneHash, codeHash: input.codeHash, purpose: toDbPurpose(input.purpose), expiresAt: input.expiresAt },
    });
    return { ...row, purpose: input.purpose };
  }

  async updateOtp(id: string, patch: Partial<Pick<OtpRecord, 'attempts' | 'verifiedAt' | 'lockedAt'>>, tx?: Tx) {
    const row = await this.db(tx).otpChallenge.update({ where: { id }, data: patch });
    return { ...row, purpose: fromDbPurpose(row.purpose) };
  }

  async createGuardianLink(input: { guardianId: string; wardPersonId: string | null; wardParticipantId: string | null; now: Date }, tx?: Tx) {
    const { now: _unused, ...data } = input;
    void _unused;
    return this.db(tx).guardianLink.create({ data });
  }

  async findGuardianLink(id: string, tx?: Tx) {
    return this.db(tx).guardianLink.findUnique({ where: { id } });
  }

  async findPendingGuardianLink(guardianId: string, ward: { wardPersonId: string | null; wardParticipantId: string | null }, tx?: Tx) {
    return this.db(tx).guardianLink.findFirst({ where: { guardianId, state: 'pending', ...ward } });
  }

  async updateGuardianLink(id: string, patch: Partial<Pick<GuardianLinkRecord, 'state' | 'consentedAt' | 'revokedAt'>>, tx?: Tx) {
    return this.db(tx).guardianLink.update({ where: { id }, data: patch });
  }

  async guardianLinksOf(guardianId: string, tx?: Tx) {
    return this.db(tx).guardianLink.findMany({ where: { guardianId }, orderBy: { createdAt: 'asc' } });
  }
}

/** Contract purposes ⇄ Prisma `OtpPurpose` enum (`phone_change` is `number_change` in the schema). */
function toDbPurpose(p: OtpPurpose): 'login' | 'guardian_consent' | 'number_change' {
  return p === 'phone_change' ? 'number_change' : p;
}
function fromDbPurpose(p: string): OtpPurpose {
  return p === 'number_change' ? 'phone_change' : (p as OtpPurpose);
}
