import type { OtpPurpose, RoleKind } from '@driver/contracts';
import { onRollback, type Tx } from '../../shared/db/unit-of-work.js';
import type {
  DeviceRecord,
  GuardianLinkRecord,
  IdentityRecord,
  IdentityRepository,
  OtpRecord,
  PersonRecord,
  RoleRecord,
  RosterPage,
  SessionRecord,
  VaultAccessLogRecord,
  ChildIdentityRecord,
  ParticipantIdentityRecord,
  VaultLogOptions,
} from './identity.repository.js';
import { vaultLogFailsClosed } from './identity.repository.js';
import { VaultLogWriteError, accessorOf, recordSwallowedVaultLogFailure } from './vault-log.js';

/**
 * In-memory twin of the Prisma repository for unit tests and for running the API without a
 * database. Same contract, same uniqueness rules (one identity per phone hash, one device per
 * person+fingerprint, one role per person+kind+org, unique refresh hash).
 *
 * Same transaction semantics too: every write made with a `tx` of an open UnitOfWork is journaled
 * and undone, newest first, if that transaction rolls back — exactly what Postgres does. Writes made
 * without a `tx` (or with a hand-built fake one) are permanent, like auto-committed statements.
 */
export class InMemoryIdentityRepository implements IdentityRepository {
  readonly people = new Map<string, PersonRecord>();
  readonly identities = new Map<string, IdentityRecord>(); // by personId
  readonly accessLogs: VaultAccessLogRecord[] = [];
  /** Test hook: how many of the next access log writes fail (like a failed insert on Postgres). */
  failLogWrites = 0;
  /** Twin of the vault table of khat children (name by childRef). */
  readonly children: ChildIdentityRecord[] = [];
  readonly participantNames = new Map<string, ParticipantIdentityRecord>();
  readonly roles: RoleRecord[] = [];
  readonly devices: DeviceRecord[] = [];
  readonly sessions: SessionRecord[] = [];
  readonly otps: OtpRecord[] = [];
  readonly guardianLinks: GuardianLinkRecord[] = [];
  private seq = 0;
  private readonly journals = new WeakMap<object, Array<() => void>>();

  /** Registers `undo` to run if `tx` rolls back (no-op outside a managed transaction). */
  private journal(tx: Tx | undefined, undo: () => void): void {
    if (!tx) return;
    let stack = this.journals.get(tx as object);
    if (!stack) {
      const fresh: Array<() => void> = [];
      if (!onRollback(tx, () => { for (let i = fresh.length - 1; i >= 0; i -= 1) fresh[i]!(); })) return;
      this.journals.set(tx as object, fresh);
      stack = fresh;
    }
    stack.push(undo);
  }

  /** Journals the current field values of `rec` so a rollback restores them. */
  private keep<T extends object>(tx: Tx | undefined, rec: T): void {
    const before = { ...rec };
    this.journal(tx, () => Object.assign(rec, before));
  }

  /** Journals an append to `list` so a rollback removes it. */
  private added<T>(tx: Tx | undefined, list: T[], item: T): void {
    this.journal(tx, () => {
      const i = list.indexOf(item);
      if (i >= 0) list.splice(i, 1);
    });
  }

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async findPersonById(id: string) {
    return this.people.get(id) ?? null;
  }

  async findPeopleByIds(ids: readonly string[]) {
    return [...new Set(ids)].map((id) => this.people.get(id)).filter((p): p is PersonRecord => p !== undefined);
  }

  async findPersonByPhoneHash(phoneHash: string) {
    for (const idn of this.identities.values()) if (idn.phoneHash === phoneHash) return this.people.get(idn.personId) ?? null;
    return null;
  }

  async createPersonWithIdentity(input: { locale: string; sharedFamilyPhone: boolean; phoneE164: string; phoneHash: string; name: string | null; now: Date }, tx?: Tx) {
    for (const idn of this.identities.values()) if (idn.phoneHash === input.phoneHash) throw new Error('unique violation: phone_hash');
    const person: PersonRecord = {
      id: this.id('p'),
      locale: input.locale,
      trustTier: 'new',
      lastVerifiedAt: null,
      sharedFamilyPhone: input.sharedFamilyPhone,
      deletedAt: null,
      createdAt: input.now,
    };
    this.people.set(person.id, person);
    this.identities.set(person.id, { personId: person.id, phoneE164: input.phoneE164, phoneHash: input.phoneHash, name: input.name });
    this.journal(tx, () => {
      this.people.delete(person.id);
      this.identities.delete(person.id);
    });
    return person;
  }

  async ensureSystemPerson(id: string, now: Date, tx?: Tx) {
    const existing = this.people.get(id);
    if (existing) return { ...existing };
    const person: PersonRecord = { id, locale: 'ar-IQ', trustTier: 'new', lastVerifiedAt: null, sharedFamilyPhone: false, deletedAt: null, createdAt: now };
    this.people.set(id, person);
    this.journal(tx, () => this.people.delete(id));
    return { ...person };
  }

  async updatePerson(id: string, patch: Partial<Pick<PersonRecord, 'lastVerifiedAt' | 'sharedFamilyPhone' | 'locale' | 'trustTier'>>, tx?: Tx) {
    const p = this.people.get(id);
    if (!p) throw new Error(`person ${id} not found`);
    this.keep(tx, p);
    Object.assign(p, patch);
    return p;
  }

  async readIdentity(personId: string) {
    return this.identities.get(personId) ?? null;
  }

  async readIdentities(personIds: readonly string[]) {
    return [...new Set(personIds)].map((id) => this.identities.get(id)).filter((i): i is IdentityRecord => i !== undefined);
  }

  async updateIdentity(personId: string, patch: Partial<Pick<IdentityRecord, 'phoneE164' | 'phoneHash' | 'name' | 'emergencyContact' | 'mainPhotoRef' | 'mainPhotoAt' | 'trustedContacts' | 'safetyPrefs'>>, tx?: Tx) {
    const idn = this.identities.get(personId);
    if (!idn) throw new Error(`identity ${personId} not found`);
    if (patch.phoneHash) for (const other of this.identities.values()) if (other.personId !== personId && other.phoneHash === patch.phoneHash) throw new Error('unique violation: phone_hash');
    this.keep(tx, idn);
    Object.assign(idn, patch);
    return idn;
  }

  /**
   * Same shape as Postgres: a synthetic accessor (`system:*`, `share:<id>`…) is kept with its kind.
   * `failLogWrites` (tests) makes the next writes fail, to exercise the fail-open / fail-closed rule.
   */
  async logVaultAccess(entry: { personId: string; accessorId: string; purpose: string; fieldsRead: string[]; childRef?: string | null; now: Date }, tx?: Tx, opts?: VaultLogOptions) {
    if (this.failLogWrites > 0) {
      this.failLogWrites -= 1;
      const err = new Error('vault log write failed (in-memory test hook)');
      if (vaultLogFailsClosed(entry.purpose, opts)) throw new VaultLogWriteError(err);
      recordSwallowedVaultLogFailure(err, entry);
      return null;
    }
    const row: VaultAccessLogRecord = {
      id: this.id('val'),
      personId: entry.personId,
      accessorId: entry.accessorId,
      accessorKind: accessorOf(entry.accessorId).kind,
      purpose: entry.purpose,
      fieldsRead: [...entry.fieldsRead],
      childRef: entry.childRef ?? null,
      createdAt: entry.now,
    };
    this.accessLogs.push(row);
    this.added(tx, this.accessLogs, row);
    return row;
  }

  async logVaultAccessMany(entries: ReadonlyArray<{ personId: string; accessorId: string; purpose: string; fieldsRead: string[]; now: Date }>, tx?: Tx, opts?: VaultLogOptions) {
    let n = 0;
    for (const e of entries) if (await this.logVaultAccess(e, tx, opts)) n += 1;
    return n;
  }

  async vaultAccessLogs(personId: string) {
    return this.accessLogs.filter((l) => l.personId === personId);
  }

  async createChildIdentity(input: { guardianId: string; name: string; now: Date }, tx?: Tx) {
    const row: ChildIdentityRecord = { childRef: this.id('chref'), guardianId: input.guardianId, name: input.name };
    this.children.push(row);
    this.added(tx, this.children, row);
    return { ...row };
  }

  async readChildIdentities(childRefs: readonly string[]) {
    return this.children.filter((c) => childRefs.includes(c.childRef)).map((c) => ({ ...c }));
  }

  async childIdentitiesOf(guardianId: string) {
    return this.children.filter((c) => c.guardianId === guardianId).map((c) => ({ ...c }));
  }

  async setChildPhoto(childRef: string, photoRef: string | null, tx?: Tx) {
    const c = this.children.find((x) => x.childRef === childRef);
    if (!c) throw new Error(`child ${childRef} not found`);
    this.keep(tx, c);
    c.photoRef = photoRef;
  }

  async saveParticipantIdentity(input: ParticipantIdentityRecord, tx?: Tx) {
    const prior = this.participantNames.get(input.participantId);
    this.participantNames.set(input.participantId, { ...input });
    this.journal(tx, () => {
      if (prior) this.participantNames.set(input.participantId, prior);
      else this.participantNames.delete(input.participantId);
    });
  }

  async readParticipantIdentities(participantIds: readonly string[]) {
    return participantIds.flatMap((id) => {
      const r = this.participantNames.get(id);
      return r ? [{ ...r }] : [];
    });
  }

  /** Twin of the vault row's document / selfie storage refs, by personId. */
  readonly vaultRefLists = new Map<string, { documentRefs: Array<Record<string, unknown>>; selfieRefs: Array<Record<string, unknown>> }>();

  async appendVaultRef(personId: string, field: 'documentRefs' | 'selfieRefs', entry: Record<string, unknown>, tx?: Tx) {
    if (!this.identities.has(personId)) throw new Error(`identity ${personId} not found`);
    const lists = this.vaultRefLists.get(personId) ?? { documentRefs: [], selfieRefs: [] };
    this.vaultRefLists.set(personId, lists);
    const item = { ...entry };
    lists[field].push(item);
    this.added(tx, lists[field], item);
  }

  async vaultRefs(personId: string, field: 'documentRefs' | 'selfieRefs') {
    return (this.vaultRefLists.get(personId)?.[field] ?? []).map((e) => ({ ...e }));
  }

  async orgRoleHolders(orgId: string, kinds: readonly RoleKind[]) {
    return this.roles.filter((r) => r.orgId === orgId && kinds.includes(r.kind) && !r.revokedAt);
  }

  async rolesOf(personId: string) {
    return this.roles.filter((r) => r.personId === personId && !r.revokedAt);
  }

  async peopleWithRoles(kinds: readonly RoleKind[], page: RosterPage) {
    const q = page.idContains?.toLowerCase();
    const matches = [...this.people.values()]
      .filter((p) => !p.deletedAt && (!q || p.id.toLowerCase().includes(q)))
      .filter((p) => this.roles.some((r) => r.personId === p.id && !r.revokedAt && kinds.includes(r.kind)))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const after = page.afterId;
    const people = matches
      .filter((p) => after === undefined || p.id > after)
      .slice(0, page.limit)
      .map((person) => ({ person: { ...person }, roles: this.roles.filter((r) => r.personId === person.id && !r.revokedAt).map((r) => ({ ...r })) }));
    return { people, total: matches.length };
  }

  async upsertRole(input: { personId: string; kind: RoleKind; orgId: string | null; grantedBy: string | null; now: Date }, tx?: Tx) {
    const existing = this.roles.find((r) => r.personId === input.personId && r.kind === input.kind && r.orgId === input.orgId);
    if (existing && !existing.revokedAt) return { role: existing, created: false };
    if (existing) {
      this.keep(tx, existing);
      existing.revokedAt = null;
      existing.frozenAt = null;
      existing.grantedBy = input.grantedBy;
      existing.createdAt = input.now;
      return { role: existing, created: true };
    }
    const role: RoleRecord = { id: this.id('role'), personId: input.personId, kind: input.kind, orgId: input.orgId, grantedBy: input.grantedBy, frozenAt: null, revokedAt: null, createdAt: input.now };
    this.roles.push(role);
    this.added(tx, this.roles, role);
    return { role, created: true };
  }

  async revokeRole(id: string, now: Date, tx?: Tx) {
    const r = this.roles.find((x) => x.id === id);
    if (!r) throw new Error(`role ${id} not found`);
    this.keep(tx, r);
    r.revokedAt = now;
    return r;
  }

  async setRolesFrozen(personId: string, kinds: readonly RoleKind[], frozenAt: Date | null, tx?: Tx) {
    let n = 0;
    for (const r of this.roles) {
      if (r.personId === personId && !r.revokedAt && kinds.includes(r.kind)) {
        this.keep(tx, r);
        r.frozenAt = frozenAt;
        n += 1;
      }
    }
    return n;
  }

  async findDevice(personId: string, fingerprint: string) {
    return this.devices.find((d) => d.personId === personId && d.fingerprint === fingerprint) ?? null;
  }

  async findDeviceById(id: string) {
    return this.devices.find((d) => d.id === id) ?? null;
  }

  async devicesOf(personId: string) {
    return this.devices.filter((d) => d.personId === personId);
  }

  async createDevice(input: { personId: string; fingerprint: string; platform: string; appVersion: string | null; verifiedAt: Date | null; now: Date }, tx?: Tx) {
    const d: DeviceRecord = { id: this.id('dev'), personId: input.personId, fingerprint: input.fingerprint, platform: input.platform, appVersion: input.appVersion, verifiedAt: input.verifiedAt, lastSeenAt: input.now };
    this.devices.push(d);
    this.added(tx, this.devices, d);
    return d;
  }

  async updateDevice(id: string, patch: Partial<Pick<DeviceRecord, 'verifiedAt' | 'lastSeenAt' | 'appVersion'>>, tx?: Tx) {
    const d = this.devices.find((x) => x.id === id);
    if (!d) throw new Error(`device ${id} not found`);
    this.keep(tx, d);
    Object.assign(d, patch);
    return d;
  }

  async createSession(input: { personId: string; deviceId: string | null; refreshTokenHash: string; expiresAt: Date; now: Date }, tx?: Tx) {
    const s: SessionRecord = { id: this.id('sess'), personId: input.personId, deviceId: input.deviceId, refreshTokenHash: input.refreshTokenHash, previousRefreshTokenHash: null, expiresAt: input.expiresAt, rotatedAt: null, revokedAt: null, createdAt: input.now };
    this.sessions.push(s);
    this.added(tx, this.sessions, s);
    return s;
  }

  async findSessionById(id: string) {
    return this.sessions.find((s) => s.id === id) ?? null;
  }

  async findSessionByRefreshHash(hash: string) {
    return this.sessions.find((s) => s.refreshTokenHash === hash) ?? null;
  }

  async findSessionByPreviousRefreshHash(hash: string) {
    return this.sessions.find((s) => s.previousRefreshTokenHash === hash) ?? null;
  }

  async updateSession(id: string, patch: Partial<Pick<SessionRecord, 'refreshTokenHash' | 'previousRefreshTokenHash' | 'expiresAt' | 'rotatedAt' | 'revokedAt' | 'deviceId'>>, tx?: Tx) {
    const s = this.sessions.find((x) => x.id === id);
    if (!s) throw new Error(`session ${id} not found`);
    this.keep(tx, s);
    Object.assign(s, patch);
    return s;
  }

  async sessionsOpenedSince(personId: string, since: Date) {
    return this.sessions.filter((s) => s.personId === personId && s.createdAt.getTime() >= since.getTime()).length;
  }

  async lastSessionAtOf(personIds: readonly string[]) {
    const ids = new Set(personIds);
    const out: Record<string, Date> = {};
    for (const s of this.sessions) {
      if (!ids.has(s.personId)) continue;
      const at = s.rotatedAt && s.rotatedAt > s.createdAt ? s.rotatedAt : s.createdAt;
      if (!out[s.personId] || at > out[s.personId]!) out[s.personId] = at;
    }
    return out;
  }

  async rotateSession(id: string, expectRefreshHash: string, patch: Partial<Pick<SessionRecord, 'refreshTokenHash' | 'previousRefreshTokenHash' | 'expiresAt' | 'rotatedAt' | 'deviceId'>>, tx?: Tx) {
    const s = this.sessions.find((x) => x.id === id);
    if (!s || s.refreshTokenHash !== expectRefreshHash || s.revokedAt) return null;
    return this.updateSession(id, patch, tx);
  }

  async revokeSessionsOf(personId: string, now: Date, tx?: Tx) {
    let n = 0;
    for (const s of this.sessions) {
      if (s.personId === personId && !s.revokedAt) {
        this.keep(tx, s);
        s.revokedAt = now;
        n += 1;
      }
    }
    return n;
  }

  async latestOtp(phoneHash: string, purpose: OtpPurpose) {
    const list = this.otps.filter((o) => o.phoneHash === phoneHash && o.purpose === purpose);
    return list.length ? list[list.length - 1]! : null;
  }

  async createOtp(input: { phoneHash: string; codeHash: string; purpose: OtpPurpose; expiresAt: Date; now: Date; attempts?: number }, tx?: Tx) {
    const o: OtpRecord = { id: this.id('otp'), phoneHash: input.phoneHash, codeHash: input.codeHash, purpose: input.purpose, attempts: input.attempts ?? 0, expiresAt: input.expiresAt, verifiedAt: null, lockedAt: null, createdAt: input.now };
    this.otps.push(o);
    this.added(tx, this.otps, o);
    return o;
  }

  async updateOtp(id: string, patch: Partial<Pick<OtpRecord, 'attempts' | 'verifiedAt' | 'lockedAt'>>, tx?: Tx) {
    const o = this.otps.find((x) => x.id === id);
    if (!o) throw new Error(`otp ${id} not found`);
    this.keep(tx, o);
    Object.assign(o, patch);
    return o;
  }

  /** Never journaled: an auto-committed write, like the Prisma twin. */
  async claimOtpAttempt(id: string, input: { maxAttempts: number }) {
    const o = this.otps.find((x) => x.id === id);
    if (!o || o.verifiedAt || o.lockedAt || o.attempts >= input.maxAttempts) return null;
    o.attempts += 1;
    return { attempts: o.attempts };
  }

  /** Never journaled, like `claimOtpAttempt`. */
  async lockOtp(id: string, input: { now: Date; maxAttempts: number }) {
    const o = this.otps.find((x) => x.id === id);
    if (!o) return null;
    if (!o.verifiedAt && !o.lockedAt && o.attempts >= input.maxAttempts) o.lockedAt = input.now;
    return { ...o };
  }

  async consumeOtp(id: string, now: Date, tx?: Tx) {
    const o = this.otps.find((x) => x.id === id);
    if (!o || o.verifiedAt || o.lockedAt) return null;
    this.keep(tx, o);
    o.verifiedAt = now;
    return o;
  }

  async createGuardianLink(input: { guardianId: string; wardPersonId: string | null; wardParticipantId: string | null; now: Date }, tx?: Tx) {
    const g: GuardianLinkRecord = { id: this.id('gl'), guardianId: input.guardianId, wardPersonId: input.wardPersonId, wardParticipantId: input.wardParticipantId, state: 'pending', consentedAt: null, revokedAt: null };
    this.guardianLinks.push(g);
    this.added(tx, this.guardianLinks, g);
    return g;
  }

  async findGuardianLink(id: string) {
    return this.guardianLinks.find((g) => g.id === id) ?? null;
  }

  async findPendingGuardianLink(guardianId: string, ward: { wardPersonId: string | null; wardParticipantId: string | null }) {
    return this.guardianLinks.find((g) => g.guardianId === guardianId && g.state === 'pending' && g.wardPersonId === ward.wardPersonId && g.wardParticipantId === ward.wardParticipantId) ?? null;
  }

  async updateGuardianLink(id: string, patch: Partial<Pick<GuardianLinkRecord, 'state' | 'consentedAt' | 'revokedAt'>>, tx?: Tx) {
    const g = this.guardianLinks.find((x) => x.id === id);
    if (!g) throw new Error(`guardian link ${id} not found`);
    this.keep(tx, g);
    Object.assign(g, patch);
    return g;
  }

  async guardianLinksOf(guardianId: string) {
    return this.guardianLinks.filter((g) => g.guardianId === guardianId);
  }
}
