import type { OtpPurpose, RoleKind } from '@driver/contracts';
import type { Tx } from '../../shared/db/unit-of-work.js';
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
} from './identity.repository.js';

/**
 * In-memory twin of the Prisma repository for unit tests and for running the API without a
 * database. Same contract, same uniqueness rules (one identity per phone hash, one device per
 * person+fingerprint, one role per person+kind+org, unique refresh hash).
 */
export class InMemoryIdentityRepository implements IdentityRepository {
  readonly people = new Map<string, PersonRecord>();
  readonly identities = new Map<string, IdentityRecord>(); // by personId
  readonly accessLogs: VaultAccessLogRecord[] = [];
  readonly roles: RoleRecord[] = [];
  readonly devices: DeviceRecord[] = [];
  readonly sessions: SessionRecord[] = [];
  readonly otps: OtpRecord[] = [];
  readonly guardianLinks: GuardianLinkRecord[] = [];
  private seq = 0;

  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async findPersonById(id: string) {
    return this.people.get(id) ?? null;
  }

  async findPersonByPhoneHash(phoneHash: string) {
    for (const idn of this.identities.values()) if (idn.phoneHash === phoneHash) return this.people.get(idn.personId) ?? null;
    return null;
  }

  async createPersonWithIdentity(input: { locale: string; sharedFamilyPhone: boolean; phoneE164: string; phoneHash: string; name: string | null; now: Date }) {
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
    return person;
  }

  async updatePerson(id: string, patch: Partial<Pick<PersonRecord, 'lastVerifiedAt' | 'sharedFamilyPhone' | 'locale' | 'trustTier'>>) {
    const p = this.people.get(id);
    if (!p) throw new Error(`person ${id} not found`);
    Object.assign(p, patch);
    return p;
  }

  async readIdentity(personId: string) {
    return this.identities.get(personId) ?? null;
  }

  async updateIdentity(personId: string, patch: Partial<Pick<IdentityRecord, 'phoneE164' | 'phoneHash' | 'name'>>) {
    const idn = this.identities.get(personId);
    if (!idn) throw new Error(`identity ${personId} not found`);
    if (patch.phoneHash) for (const other of this.identities.values()) if (other.personId !== personId && other.phoneHash === patch.phoneHash) throw new Error('unique violation: phone_hash');
    Object.assign(idn, patch);
    return idn;
  }

  async logVaultAccess(entry: { personId: string; accessorId: string; purpose: string; fieldsRead: string[]; now: Date }) {
    const row: VaultAccessLogRecord = { id: this.id('val'), personId: entry.personId, accessorId: entry.accessorId, purpose: entry.purpose, fieldsRead: [...entry.fieldsRead], createdAt: entry.now };
    this.accessLogs.push(row);
    return row;
  }

  async vaultAccessLogs(personId: string) {
    return this.accessLogs.filter((l) => l.personId === personId);
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

  async upsertRole(input: { personId: string; kind: RoleKind; orgId: string | null; grantedBy: string | null; now: Date }) {
    const existing = this.roles.find((r) => r.personId === input.personId && r.kind === input.kind && r.orgId === input.orgId);
    if (existing && !existing.revokedAt) return { role: existing, created: false };
    if (existing) {
      existing.revokedAt = null;
      existing.frozenAt = null;
      existing.grantedBy = input.grantedBy;
      return { role: existing, created: true };
    }
    const role: RoleRecord = { id: this.id('role'), personId: input.personId, kind: input.kind, orgId: input.orgId, grantedBy: input.grantedBy, frozenAt: null, revokedAt: null };
    this.roles.push(role);
    return { role, created: true };
  }

  async revokeRole(id: string, now: Date) {
    const r = this.roles.find((x) => x.id === id);
    if (!r) throw new Error(`role ${id} not found`);
    r.revokedAt = now;
    return r;
  }

  async setRolesFrozen(personId: string, kinds: readonly RoleKind[], frozenAt: Date | null) {
    let n = 0;
    for (const r of this.roles) {
      if (r.personId === personId && !r.revokedAt && kinds.includes(r.kind)) {
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

  async createDevice(input: { personId: string; fingerprint: string; platform: string; appVersion: string | null; verifiedAt: Date | null; now: Date }) {
    const d: DeviceRecord = { id: this.id('dev'), personId: input.personId, fingerprint: input.fingerprint, platform: input.platform, appVersion: input.appVersion, verifiedAt: input.verifiedAt, lastSeenAt: input.now };
    this.devices.push(d);
    return d;
  }

  async updateDevice(id: string, patch: Partial<Pick<DeviceRecord, 'verifiedAt' | 'lastSeenAt' | 'appVersion'>>) {
    const d = this.devices.find((x) => x.id === id);
    if (!d) throw new Error(`device ${id} not found`);
    Object.assign(d, patch);
    return d;
  }

  async createSession(input: { personId: string; deviceId: string | null; refreshTokenHash: string; expiresAt: Date; now: Date }) {
    const s: SessionRecord = { id: this.id('sess'), personId: input.personId, deviceId: input.deviceId, refreshTokenHash: input.refreshTokenHash, expiresAt: input.expiresAt, rotatedAt: null, revokedAt: null, createdAt: input.now };
    this.sessions.push(s);
    return s;
  }

  async findSessionById(id: string) {
    return this.sessions.find((s) => s.id === id) ?? null;
  }

  async findSessionByRefreshHash(hash: string) {
    return this.sessions.find((s) => s.refreshTokenHash === hash) ?? null;
  }

  async updateSession(id: string, patch: Partial<Pick<SessionRecord, 'refreshTokenHash' | 'expiresAt' | 'rotatedAt' | 'revokedAt' | 'deviceId'>>) {
    const s = this.sessions.find((x) => x.id === id);
    if (!s) throw new Error(`session ${id} not found`);
    Object.assign(s, patch);
    return s;
  }

  async revokeSessionsOf(personId: string, now: Date) {
    let n = 0;
    for (const s of this.sessions) {
      if (s.personId === personId && !s.revokedAt) {
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

  async createOtp(input: { phoneHash: string; codeHash: string; purpose: OtpPurpose; expiresAt: Date; now: Date }) {
    const o: OtpRecord = { id: this.id('otp'), phoneHash: input.phoneHash, codeHash: input.codeHash, purpose: input.purpose, attempts: 0, expiresAt: input.expiresAt, verifiedAt: null, lockedAt: null, createdAt: input.now };
    this.otps.push(o);
    return o;
  }

  async updateOtp(id: string, patch: Partial<Pick<OtpRecord, 'attempts' | 'verifiedAt' | 'lockedAt'>>) {
    const o = this.otps.find((x) => x.id === id);
    if (!o) throw new Error(`otp ${id} not found`);
    Object.assign(o, patch);
    return o;
  }

  async createGuardianLink(input: { guardianId: string; wardPersonId: string | null; wardParticipantId: string | null; now: Date }) {
    const g: GuardianLinkRecord = { id: this.id('gl'), guardianId: input.guardianId, wardPersonId: input.wardPersonId, wardParticipantId: input.wardParticipantId, state: 'pending', consentedAt: null, revokedAt: null };
    this.guardianLinks.push(g);
    return g;
  }

  async findGuardianLink(id: string) {
    return this.guardianLinks.find((g) => g.id === id) ?? null;
  }

  async findPendingGuardianLink(guardianId: string, ward: { wardPersonId: string | null; wardParticipantId: string | null }) {
    return this.guardianLinks.find((g) => g.guardianId === guardianId && g.state === 'pending' && g.wardPersonId === ward.wardPersonId && g.wardParticipantId === ward.wardParticipantId) ?? null;
  }

  async updateGuardianLink(id: string, patch: Partial<Pick<GuardianLinkRecord, 'state' | 'consentedAt' | 'revokedAt'>>) {
    const g = this.guardianLinks.find((x) => x.id === id);
    if (!g) throw new Error(`guardian link ${id} not found`);
    Object.assign(g, patch);
    return g;
  }

  async guardianLinksOf(guardianId: string) {
    return this.guardianLinks.filter((g) => g.guardianId === guardianId);
  }
}

/** Keeps the `Tx` import meaningful for implementers that ignore it. */
export type { Tx };
