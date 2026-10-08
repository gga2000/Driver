import { DEFAULT_SAFETY_PREFS, EmergencyRelation, SafetyPrefs, TRUSTED_CONTACTS_MAX, type OtpPurpose, type RoleKind } from '@driver/contracts';
import { Prisma, type TrustTier } from '@driver/db';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import { STAFF_READ_PURPOSES, VaultLogWriteError, accessorOf, recordSwallowedVaultLogFailure, type AccessorKind } from './vault-log.js';

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
  /** When the live grant began (set again when a revoked grant is re-granted). */
  createdAt: Date;
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
  /** The refresh token the last rotation retired; presenting it again revokes the session. */
  previousRefreshTokenHash: string | null;
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
  /** Customer spec §10 safety; absent/null = none set. */
  emergencyContact?: EmergencyContactRecord | null;
  /** The approved main photo customers see (storage ref) and when it was approved; absent/null = none. */
  mainPhotoRef?: string | null;
  mainPhotoAt?: Date | null;
  /** Joy w9: up to three trusted people, the first being the emergency contact; null = never set (falls back to the emergency contact). */
  trustedContacts?: EmergencyContactRecord[] | null;
  /** Joy w9: the safety switches; null = the defaults (all off). */
  safetyPrefs?: SafetyPrefs | null;
}

export interface EmergencyContactRecord {
  name: string;
  phoneE164: string;
  /** Who they are to the person ("mother", "friend"…); absent on contacts saved before it existed. */
  relation?: EmergencyRelation | null;
}

export interface VaultAccessLogRecord {
  id: string;
  personId: string;
  /** Who read: a person id, or a synthetic reader's id ("system:notify", "share:<linkId>"). */
  accessorId: string;
  /** 'person' for a person; the synthetic reader's kind otherwise (`accessorOf`). */
  accessorKind: AccessorKind;
  purpose: string;
  fieldsRead: string[];
  /** Set when a child's identity was read (personId is then the guardian). */
  childRef?: string | null;
  createdAt: Date;
}

/** vault.child_identities — a khat child's name, keyed by the opaque childRef stops and events carry. */
export interface ChildIdentityRecord {
  childRef: string;
  guardianId: string | null;
  name: string;
  /** The guardian's photo of the child (storage ref); absent/null = none. */
  photoRef?: string | null;
}

/** vault.participant_identities — the name an orderer gave the person he booked a ride for (c9/s3). */
export interface ParticipantIdentityRecord {
  participantId: string;
  /** The rider. */
  personId: string;
  givenById: string;
  name: string;
}

export interface IdentityRepository {
  // people
  findPersonById(id: string, tx?: Tx): Promise<PersonRecord | null>;
  /** Batched `findPersonById` (one query); unknown ids are left out. */
  findPeopleByIds(ids: readonly string[], tx?: Tx): Promise<PersonRecord[]>;
  findPersonByPhoneHash(phoneHash: string, tx?: Tx): Promise<PersonRecord | null>;
  createPersonWithIdentity(
    input: { locale: string; sharedFamilyPhone: boolean; phoneE164: string; phoneHash: string; name: string | null; now: Date },
    tx?: Tx,
  ): Promise<PersonRecord>;
  updatePerson(id: string, patch: Partial<Pick<PersonRecord, 'lastVerifiedAt' | 'sharedFamilyPhone' | 'locale' | 'trustTier'>>, tx?: Tx): Promise<PersonRecord>;

  // vault
  readIdentity(personId: string, tx?: Tx): Promise<IdentityRecord | null>;
  /** Batched `readIdentity` (one query); people without a vault row are left out. */
  readIdentities(personIds: readonly string[], tx?: Tx): Promise<IdentityRecord[]>;
  updateIdentity(personId: string, patch: Partial<Pick<IdentityRecord, 'phoneE164' | 'phoneHash' | 'name' | 'emergencyContact' | 'mainPhotoRef' | 'mainPhotoAt' | 'trustedContacts' | 'safetyPrefs'>>, tx?: Tx): Promise<IdentityRecord>;
  /**
   * One VaultAccessLog row. A synthetic accessor (`system:*`, `share:<id>`, `sos_link:<id>`) is written as
   * its kind and ref with a null accessor_id (vault_accessor_fk). Inside a transaction the insert runs in
   * a SAVEPOINT, so a failed insert never aborts the caller's transaction. A failure is swallowed
   * (counted, logged with `vault_log_write_failed`, null returned) unless the read is an interactive
   * staff read (`STAFF_READ_PURPOSES`, or `opts.failClosed`): then it throws `VaultLogWriteError` and
   * the read returns no data.
   */
  logVaultAccess(entry: { personId: string; accessorId: string; purpose: string; fieldsRead: string[]; childRef?: string | null; now: Date }, tx?: Tx, opts?: VaultLogOptions): Promise<VaultAccessLogRecord | null>;
  /** One VaultAccessLog row per entry, written in one statement; returns how many were written (0 when a swallowed failure). */
  logVaultAccessMany(entries: ReadonlyArray<{ personId: string; accessorId: string; purpose: string; fieldsRead: string[]; now: Date }>, tx?: Tx, opts?: VaultLogOptions): Promise<number>;
  vaultAccessLogs(personId: string, tx?: Tx): Promise<VaultAccessLogRecord[]>;
  createChildIdentity(input: { guardianId: string; name: string; now: Date }, tx?: Tx): Promise<ChildIdentityRecord>;
  readChildIdentities(childRefs: readonly string[], tx?: Tx): Promise<ChildIdentityRecord[]>;
  childIdentitiesOf(guardianId: string, tx?: Tx): Promise<ChildIdentityRecord[]>;
  /** Sets (or clears, with null) a child's photo ref. */
  setChildPhoto(childRef: string, photoRef: string | null, tx?: Tx): Promise<void>;
  /** Ride ideas c9/s3: stores (or replaces) the name given to an order's participant. */
  saveParticipantIdentity(input: ParticipantIdentityRecord, tx?: Tx): Promise<void>;
  readParticipantIdentities(participantIds: readonly string[], tx?: Tx): Promise<ParticipantIdentityRecord[]>;
  /** Wave 2: appends a storage ref (driver document photo, check-in selfie) to the vault row. */
  appendVaultRef(personId: string, field: 'documentRefs' | 'selfieRefs', entry: Record<string, unknown>, tx?: Tx): Promise<void>;
  /** Wave 2: the vault refs of one kind, for a reviewer's logged read. */
  vaultRefs(personId: string, field: 'documentRefs' | 'selfieRefs', tx?: Tx): Promise<Array<Record<string, unknown>>>;
  /** Wave 2: live (unrevoked) grants of `kinds` scoped to `orgId` (merchant staff list). */
  orgRoleHolders(orgId: string, kinds: readonly RoleKind[], tx?: Tx): Promise<RoleRecord[]>;

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
  /** Every device a person signed in from (the referral fingerprint, decisions §1). */
  devicesOf(personId: string, tx?: Tx): Promise<DeviceRecord[]>;
  createDevice(input: { personId: string; fingerprint: string; platform: string; appVersion: string | null; verifiedAt: Date | null; now: Date }, tx?: Tx): Promise<DeviceRecord>;
  updateDevice(id: string, patch: Partial<Pick<DeviceRecord, 'verifiedAt' | 'lastSeenAt' | 'appVersion'>>, tx?: Tx): Promise<DeviceRecord>;

  // sessions
  createSession(input: { personId: string; deviceId: string | null; refreshTokenHash: string; expiresAt: Date; now: Date }, tx?: Tx): Promise<SessionRecord>;
  findSessionById(id: string, tx?: Tx): Promise<SessionRecord | null>;
  findSessionByRefreshHash(hash: string, tx?: Tx): Promise<SessionRecord | null>;
  findSessionByPreviousRefreshHash(hash: string, tx?: Tx): Promise<SessionRecord | null>;
  updateSession(id: string, patch: Partial<Pick<SessionRecord, 'refreshTokenHash' | 'previousRefreshTokenHash' | 'expiresAt' | 'rotatedAt' | 'revokedAt' | 'deviceId'>>, tx?: Tx): Promise<SessionRecord>;
  revokeSessionsOf(personId: string, now: Date, tx?: Tx): Promise<number>;
  /** Per person, the latest session start or refresh (the app in use); absent = no session ever. */
  lastSessionAtOf(personIds: readonly string[], tx?: Tx): Promise<Record<string, Date>>;

  // otp
  latestOtp(phoneHash: string, purpose: OtpPurpose, tx?: Tx): Promise<OtpRecord | null>;
  /** `attempts`: misses carried over from the challenge this one replaces (one chain per phone and purpose). */
  createOtp(input: { phoneHash: string; codeHash: string; purpose: OtpPurpose; expiresAt: Date; now: Date; attempts?: number }, tx?: Tx): Promise<OtpRecord>;
  updateOtp(id: string, patch: Partial<Pick<OtpRecord, 'attempts' | 'verifiedAt' | 'lockedAt'>>, tx?: Tx): Promise<OtpRecord>;
  /**
   * Claims one attempt before a code is compared (audit SEC-01): a single conditional increment
   * that succeeds only while the challenge is unused, unlocked and under `maxAttempts`; `null`
   * otherwise. Deliberately takes NO `tx`: it commits on its own connection, immediately, so the
   * caller's transaction rolling back (it is about to throw `otp_invalid`) can never undo it, and
   * parallel guesses each see the others' claims. `attempts`: the count this claim made it (1…max),
   * as the UPDATE returned it, not as a later read sees it.
   */
  claimOtpAttempt(id: string, input: { maxAttempts: number }): Promise<{ attempts: number } | null>;
  /** Stamps `lockedAt` if the attempts are used up and it is not yet locked or used (no `tx`, as above); the row as it now stands. */
  lockOtp(id: string, input: { now: Date; maxAttempts: number }): Promise<OtpRecord | null>;
  /** Marks the challenge used, only if it is still unused and unlocked; `null` when another request got there first. */
  consumeOtp(id: string, now: Date, tx?: Tx): Promise<OtpRecord | null>;

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

export interface VaultLogOptions {
  /** Throw (no data) when the row cannot be written; default: the purpose is a staff read. */
  failClosed?: boolean;
}

/** Whether a log failure for this read throws (staff reads) or is swallowed. */
export function vaultLogFailsClosed(purpose: string, opts?: VaultLogOptions): boolean {
  return opts?.failClosed ?? STAFF_READ_PURPOSES.has(purpose);
}

/** The vault_access_logs columns for one read: a person in accessor_id, anyone else as kind + ref. */
export function vaultLogRow(entry: { personId: string; accessorId: string; purpose: string; fieldsRead: string[]; childRef?: string | null }) {
  const who = accessorOf(entry.accessorId);
  return { personId: entry.personId, accessorId: who.personId, accessorKind: who.kind, accessorRef: who.ref, purpose: entry.purpose, fieldsRead: entry.fieldsRead, childRef: entry.childRef ?? null };
}

/** The record of a stored row: `accessorId` is the person, or the synthetic reader's ref. */
function vaultLogRecord(row: { id: string; personId: string; accessorId: string | null; accessorKind: string; accessorRef: string | null; purpose: string; fieldsRead: string[]; childRef: string | null; createdAt: Date }): VaultAccessLogRecord {
  return { id: row.id, personId: row.personId, accessorId: row.accessorId ?? row.accessorRef ?? '', accessorKind: row.accessorKind as AccessorKind, purpose: row.purpose, fieldsRead: row.fieldsRead, childRef: row.childRef, createdAt: row.createdAt };
}

/** Savepoint writes are queued per transaction, so two reads joined to one transaction never interleave their savepoints. */
const savepointQueues = new WeakMap<object, Promise<unknown>>();
let savepointSeq = 0;

/**
 * Runs `fn` inside a SAVEPOINT of `tx`: on failure the savepoint is rolled back (the transaction stays
 * usable, so the caller's own writes still commit) and the error is rethrown. A JS try/catch alone is
 * not enough: a failed statement aborts the whole Postgres transaction (25P02). Only log writes are
 * queued: don't run other queries in parallel (`Promise.all`) on a transaction that reads the vault, or
 * one could land inside the savepoint and be rolled back with a failed log write.
 */
async function inSavepoint<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
  const key = tx as object;
  const run = (savepointQueues.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      savepointSeq = (savepointSeq + 1) % 1_000_000_000;
      const name = `vault_log_${savepointSeq}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
      try {
        const out = await fn();
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
        return out;
      } catch (err) {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
        throw err;
      }
    });
  savepointQueues.set(key, run);
  return run;
}

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

  async findPeopleByIds(ids: readonly string[], tx?: Tx) {
    if (ids.length === 0) return [];
    return this.db(tx).person.findMany({ where: { id: { in: [...ids] } } });
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
    return row ? identityRecord(row) : null;
  }

  async readIdentities(personIds: readonly string[], tx?: Tx) {
    if (personIds.length === 0) return [];
    const rows = await this.db(tx).personIdentity.findMany({ where: { personId: { in: [...personIds] } } });
    return rows.map(identityRecord);
  }

  async updateIdentity(personId: string, patch: Partial<Pick<IdentityRecord, 'phoneE164' | 'phoneHash' | 'name' | 'emergencyContact' | 'mainPhotoRef' | 'mainPhotoAt' | 'trustedContacts' | 'safetyPrefs'>>, tx?: Tx) {
    const { emergencyContact, trustedContacts, safetyPrefs, ...rest } = patch;
    const contactJson = (c: EmergencyContactRecord) => ({ name: c.name, phoneE164: c.phoneE164, ...(c.relation ? { relation: c.relation } : {}) });
    const data = {
      ...rest,
      ...(emergencyContact !== undefined ? { emergencyContact: emergencyContact === null ? Prisma.DbNull : contactJson(emergencyContact) } : {}),
      ...(trustedContacts !== undefined ? { trustedContacts: trustedContacts === null ? Prisma.DbNull : trustedContacts.map(contactJson) } : {}),
      ...(safetyPrefs !== undefined ? { safetyPrefs: safetyPrefs === null ? Prisma.DbNull : { ...safetyPrefs } } : {}),
    };
    const row = await this.db(tx).personIdentity.update({ where: { personId }, data });
    return identityRecord(row);
  }

  async logVaultAccess(entry: { personId: string; accessorId: string; purpose: string; fieldsRead: string[]; childRef?: string | null; now: Date }, tx?: Tx, opts?: VaultLogOptions) {
    const row = await this.writeLog(entry, tx, opts, (db) => db.vaultAccessLog.create({ data: vaultLogRow(entry) }));
    return row ? vaultLogRecord(row) : null;
  }

  async logVaultAccessMany(entries: ReadonlyArray<{ personId: string; accessorId: string; purpose: string; fieldsRead: string[]; now: Date }>, tx?: Tx, opts?: VaultLogOptions) {
    const first = entries[0];
    if (!first) return 0;
    const data = entries.map((e) => vaultLogRow(e));
    return (await this.writeLog(first, tx, opts, async (db) => (await db.vaultAccessLog.createMany({ data })).count)) ?? 0;
  }

  /** The log write in its own savepoint (or on its own, outside a transaction); see `logVaultAccess`. */
  private async writeLog<T>(entry: { personId: string; accessorId: string; purpose: string }, tx: Tx | undefined, opts: VaultLogOptions | undefined, write: (db: Tx) => Promise<T>): Promise<T | null> {
    try {
      return tx ? await inSavepoint(tx, () => write(tx)) : await write(this.db());
    } catch (err) {
      if (vaultLogFailsClosed(entry.purpose, opts)) throw new VaultLogWriteError(err);
      recordSwallowedVaultLogFailure(err, entry);
      return null;
    }
  }

  async createChildIdentity(input: { guardianId: string; name: string; now: Date }, tx?: Tx) {
    const row = await this.db(tx).childIdentity.create({ data: { guardianId: input.guardianId, name: input.name } });
    return { childRef: row.id, guardianId: row.guardianId, name: row.name };
  }

  async readChildIdentities(childRefs: readonly string[], tx?: Tx) {
    if (childRefs.length === 0) return [];
    const rows = await this.db(tx).childIdentity.findMany({ where: { id: { in: [...childRefs] } } });
    return rows.map((r) => ({ childRef: r.id, guardianId: r.guardianId, name: r.name, photoRef: r.photoRef }));
  }

  async childIdentitiesOf(guardianId: string, tx?: Tx) {
    const rows = await this.db(tx).childIdentity.findMany({ where: { guardianId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({ childRef: r.id, guardianId: r.guardianId, name: r.name, photoRef: r.photoRef }));
  }

  async setChildPhoto(childRef: string, photoRef: string | null, tx?: Tx) {
    await this.db(tx).childIdentity.update({ where: { id: childRef }, data: { photoRef } });
  }

  async saveParticipantIdentity(input: ParticipantIdentityRecord, tx?: Tx) {
    const data = { personId: input.personId, givenById: input.givenById, name: input.name };
    await this.db(tx).participantIdentity.upsert({ where: { participantId: input.participantId }, create: { participantId: input.participantId, ...data }, update: data });
  }

  async readParticipantIdentities(participantIds: readonly string[], tx?: Tx) {
    if (participantIds.length === 0) return [];
    const rows = await this.db(tx).participantIdentity.findMany({ where: { participantId: { in: [...participantIds] } } });
    return rows.map((r) => ({ participantId: r.participantId, personId: r.personId, givenById: r.givenById, name: r.name }));
  }

  async vaultAccessLogs(personId: string, tx?: Tx) {
    return (await this.db(tx).vaultAccessLog.findMany({ where: { personId }, orderBy: { createdAt: 'asc' } })).map(vaultLogRecord);
  }

  async appendVaultRef(personId: string, field: 'documentRefs' | 'selfieRefs', entry: Record<string, unknown>, tx?: Tx) {
    const db = this.db(tx);
    const row = await db.personIdentity.findUnique({ where: { personId }, select: { documentRefs: true, selfieRefs: true } });
    if (!row) throw new Error(`identity ${personId} not found`);
    const current = Array.isArray(row[field]) ? (row[field] as Prisma.JsonArray) : [];
    await db.personIdentity.update({ where: { personId }, data: { [field]: [...current, entry as Prisma.JsonObject] } });
  }

  async vaultRefs(personId: string, field: 'documentRefs' | 'selfieRefs', tx?: Tx) {
    const row = await this.db(tx).personIdentity.findUnique({ where: { personId }, select: { documentRefs: true, selfieRefs: true } });
    const list = row && Array.isArray(row[field]) ? (row[field] as Prisma.JsonArray) : [];
    return list.filter((x): x is Prisma.JsonObject => typeof x === 'object' && x !== null && !Array.isArray(x)) as Array<Record<string, unknown>>;
  }

  async orgRoleHolders(orgId: string, kinds: readonly RoleKind[], tx?: Tx) {
    return this.db(tx).role.findMany({ where: { orgId, kind: { in: [...kinds] }, revokedAt: null }, orderBy: { createdAt: 'asc' } });
  }

  async rolesOf(personId: string, tx?: Tx) {
    return this.db(tx).role.findMany({ where: { personId, revokedAt: null } });
  }

  async upsertRole(input: { personId: string; kind: RoleKind; orgId: string | null; grantedBy: string | null; now: Date }, tx?: Tx) {
    const db = this.db(tx);
    const existing = await db.role.findFirst({ where: { personId: input.personId, kind: input.kind, orgId: input.orgId } });
    if (existing && !existing.revokedAt) return { role: existing, created: false };
    if (existing) {
      const role = await db.role.update({ where: { id: existing.id }, data: { revokedAt: null, frozenAt: null, grantedBy: input.grantedBy, createdAt: input.now } });
      return { role, created: true };
    }
    const role = await db.role.create({ data: { personId: input.personId, kind: input.kind, orgId: input.orgId, grantedBy: input.grantedBy, createdAt: input.now } });
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

  async devicesOf(personId: string, tx?: Tx) {
    return this.db(tx).device.findMany({ where: { personId } });
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

  async findSessionByPreviousRefreshHash(hash: string, tx?: Tx) {
    return this.db(tx).session.findUnique({ where: { previousRefreshTokenHash: hash } });
  }

  async updateSession(id: string, patch: Partial<Pick<SessionRecord, 'refreshTokenHash' | 'previousRefreshTokenHash' | 'expiresAt' | 'rotatedAt' | 'revokedAt' | 'deviceId'>>, tx?: Tx) {
    return this.db(tx).session.update({ where: { id }, data: patch });
  }

  async lastSessionAtOf(personIds: readonly string[], tx?: Tx) {
    const out: Record<string, Date> = {};
    if (personIds.length === 0) return out;
    const rows = await this.db(tx).session.findMany({ where: { personId: { in: [...personIds] } }, select: { personId: true, createdAt: true, rotatedAt: true } });
    for (const r of rows) {
      const at = r.rotatedAt && r.rotatedAt > r.createdAt ? r.rotatedAt : r.createdAt;
      if (!out[r.personId] || at > out[r.personId]!) out[r.personId] = at;
    }
    return out;
  }

  async revokeSessionsOf(personId: string, now: Date, tx?: Tx) {
    const res = await this.db(tx).session.updateMany({ where: { personId, revokedAt: null }, data: { revokedAt: now } });
    return res.count;
  }

  async latestOtp(phoneHash: string, purpose: OtpPurpose, tx?: Tx) {
    const row = await this.db(tx).otpChallenge.findFirst({ where: { phoneHash, purpose: toDbPurpose(purpose) }, orderBy: { createdAt: 'desc' } });
    return row ? { ...row, purpose } : null;
  }

  async createOtp(input: { phoneHash: string; codeHash: string; purpose: OtpPurpose; expiresAt: Date; now: Date; attempts?: number }, tx?: Tx) {
    const row = await this.db(tx).otpChallenge.create({
      data: { phoneHash: input.phoneHash, codeHash: input.codeHash, purpose: toDbPurpose(input.purpose), expiresAt: input.expiresAt, ...(input.attempts ? { attempts: input.attempts } : {}) },
    });
    return { ...row, purpose: input.purpose };
  }

  async updateOtp(id: string, patch: Partial<Pick<OtpRecord, 'attempts' | 'verifiedAt' | 'lockedAt'>>, tx?: Tx) {
    const row = await this.db(tx).otpChallenge.update({ where: { id }, data: patch });
    return { ...row, purpose: fromDbPurpose(row.purpose) };
  }

  async claimOtpAttempt(id: string, input: { maxAttempts: number }) {
    // Outside any transaction on purpose (see the port): one UPDATE … RETURNING, atomic in Postgres.
    const rows = await this.prisma.prisma.$queryRaw<Array<{ attempts: number }>>`
      UPDATE "public"."otp_challenges"
         SET "attempts" = "attempts" + 1, "updated_at" = now()
       WHERE "id" = ${id} AND "verified_at" IS NULL AND "locked_at" IS NULL AND "attempts" < ${input.maxAttempts}
   RETURNING "attempts"`;
    return rows[0] ? { attempts: Number(rows[0].attempts) } : null;
  }

  async lockOtp(id: string, input: { now: Date; maxAttempts: number }) {
    const db = this.prisma.prisma;
    await db.otpChallenge.updateMany({ where: { id, verifiedAt: null, lockedAt: null, attempts: { gte: input.maxAttempts } }, data: { lockedAt: input.now } });
    const row = await db.otpChallenge.findUnique({ where: { id } });
    return row ? { ...row, purpose: fromDbPurpose(row.purpose) } : null;
  }

  async consumeOtp(id: string, now: Date, tx?: Tx) {
    const db = this.db(tx);
    const { count } = await db.otpChallenge.updateMany({ where: { id, verifiedAt: null, lockedAt: null }, data: { verifiedAt: now } });
    if (count === 0) return null;
    const row = await db.otpChallenge.findUniqueOrThrow({ where: { id } });
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

function contactRecord(raw: unknown): EmergencyContactRecord | null {
  const ec = raw as { name?: unknown; phoneE164?: unknown; relation?: unknown } | null | undefined;
  const relation = EmergencyRelation.safeParse(ec?.relation);
  return ec && typeof ec.name === 'string' && typeof ec.phoneE164 === 'string' ? { name: ec.name, phoneE164: ec.phoneE164, relation: relation.success ? relation.data : null } : null;
}

function identityRecord(row: { personId: string; phoneE164: string; phoneHash: string; name: string | null; emergencyContact?: unknown; trustedContacts?: unknown; safetyPrefs?: unknown; mainPhotoRef?: string | null; mainPhotoAt?: Date | null }): IdentityRecord {
  const emergencyContact = contactRecord(row.emergencyContact);
  const trustedContacts = Array.isArray(row.trustedContacts)
    ? row.trustedContacts
        .map(contactRecord)
        .filter((c): c is EmergencyContactRecord => c !== null)
        .slice(0, TRUSTED_CONTACTS_MAX)
    : null;
  const prefs = SafetyPrefs.partial().safeParse(row.safetyPrefs);
  const safetyPrefs = row.safetyPrefs && prefs.success ? { ...DEFAULT_SAFETY_PREFS, ...prefs.data } : null;
  return { personId: row.personId, phoneE164: row.phoneE164, phoneHash: row.phoneHash, name: row.name, emergencyContact, trustedContacts, safetyPrefs, mainPhotoRef: row.mainPhotoRef ?? null, mainPhotoAt: row.mainPhotoAt ?? null };
}
