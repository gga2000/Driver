import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DEFAULT_SAFETY_PREFS,
  DriverError,
  TRUSTED_CONTACTS_MAX,
  type EmergencyRelation,
  type SafetyPrefs,
  FREEZABLE_ROLES,
  searchScore,
  REVERIFY_AFTER_IDLE_DAYS,
  SHARED_PHONE_FORBIDDEN_ROLES,
  type Actor,
  type ChangePhoneConfirmInput,
  type ChangePhoneStartInput,
  type ChangePhoneStartOutput,
  type ConsentGuardianLinkInput,
  type DeviceInfo,
  type GrantRoleInput,
  type GuardianLinkView,
  type IdentityPort,
  type LinkGuardianInput,
  type MeView,
  type OtpPurpose,
  type RequestOrigin,
  type RequestOtpInput,
  type RequestOtpOutput,
  type RevokeGuardianLinkInput,
  type RevokeRoleInput,
  type RoleGrant,
  type RoleKind,
  type SessionClaims,
  type TokenPair,
  type UpdateProfileInput,
  type VerifyOtpInput,
  type VerifyOtpOutput,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { IDENTITY_EVENTS, type IdentityEventEmitter } from './events.adapter.js';
import { GuardianService, guardianView } from './guardian.service.js';
import { IDENTITY_REPOSITORY, type EmergencyContactRecord, type IdentityRecord, type IdentityRepository, type PersonRecord, type RoleRecord } from './identity.repository.js';
import { OtpService } from './otp.service.js';
import { hashPhone, invitePhoneHint, maskPhone, normalizeIraqiPhone } from './phone.js';
import { InMemoryRateLimiter, OtpRequestGuard } from './rate-limit.js';
import { SessionService } from './session.service.js';
import { DevSmsProvider } from '../../shared/messaging/sms.js';
import { SMS_PROVIDER, type SmsProvider } from './sms/provider.js';
import type { WhatsAppPort } from '../../shared/messaging/whatsapp.js';

/** WhatsApp port for login codes (`identity.requestOtp` with `channel: 'whatsapp'`); WHATSAPP_PROVIDER=dev|meta. */
export const OTP_WHATSAPP = Symbol('OTP_WHATSAPP');

export const PHONE_PEPPER = Symbol('PHONE_PEPPER');
/** The OTP request guard (per-IP / per-device limits); bound by the module, Redis-backed when configured. */
export const OTP_REQUEST_GUARD = Symbol('OTP_REQUEST_GUARD');

type RequestOtp = z.infer<typeof RequestOtpInput>;
type VerifyOtp = z.infer<typeof VerifyOtpInput>;
type GrantRole = z.infer<typeof GrantRoleInput>;
type LinkGuardian = z.infer<typeof LinkGuardianInput>;
type ChangePhoneStart = z.infer<typeof ChangePhoneStartInput>;
type ChangePhoneConfirm = z.infer<typeof ChangePhoneConfirmInput>;

export interface RosterRow {
  personId: string;
  roles: RoleKind[];
  frozen: boolean;
  trustTier: string;
  joinedAt: Date;
}

export interface RosterResult {
  rows: RosterRow[];
  nextCursor: string | null;
  total: number;
}

/** Who can hold a role on behalf of the system when no human actor is involved. */
const SYSTEM_ACTOR = 'system';

/**
 * Identity façade (plan Step 2 + edge-case §7). One pseudonymous Person per peppered phone hash;
 * the phone and name live only in the vault, reachable through `IdentityRepository`.
 *
 * Every mutation runs inside `UnitOfWork.run` and emits its domain event through the events
 * adapter in the same unit of work.
 */
@Injectable()
export class IdentityService implements IdentityPort {
  private readonly otp: OtpService;
  private readonly sessions: SessionService;
  private readonly guardians: GuardianService;
  private readonly otpGuard: OtpRequestGuard;
  /** In-flight phone changes keyed by personId (new phone stays out of the vault until confirmed). */
  private readonly phoneChanges = new Map<string, { newE164: string; newHash: string; startedAt: Date }>();

  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(IDENTITY_EVENTS) private readonly events: IdentityEventEmitter,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    @Inject(PHONE_PEPPER) private readonly pepper: string,
    sessions?: SessionService,
    @Optional() @Inject(OTP_REQUEST_GUARD) otpGuard?: OtpRequestGuard,
    @Optional() @Inject(OTP_WHATSAPP) otpWhatsApp?: WhatsAppPort,
  ) {
    this.otpGuard = otpGuard ?? new OtpRequestGuard(new InMemoryRateLimiter(clock));
    this.otp = new OtpService(repo, sms, clock, pepper, otpWhatsApp);
    this.sessions = sessions ?? new SessionService(repo, clock, { keys: [{ kid: 'k1', secret: pepper }], activeKid: 'k1' });
    this.guardians = new GuardianService(repo, this.otp, events, clock);
  }

  // ───────────────────────── phone helpers ─────────────────────────

  private phone(raw: string): { e164: string; hash: string; masked: string } {
    const e164 = normalizeIraqiPhone(raw);
    return { e164, hash: hashPhone(e164, this.pepper), masked: maskPhone(e164) };
  }

  // ───────────────────────── OTP + login ─────────────────────────

  /**
   * Sends a code. M2 review follow-up: every request counts against its client IP (10/hour) and its
   * device (5/hour) before anything else happens — `rate_limited` with `retryAfterSec` beyond that.
   * Internal callers pass no origin and are not counted.
   */
  async requestOtp(input: RequestOtp, origin: RequestOrigin = {}): Promise<z.infer<typeof RequestOtpOutput>> {
    await this.otpGuard.check({ ip: origin.ip ?? null, deviceFingerprint: input.device?.fingerprint ?? null });
    const purpose: OtpPurpose = input.purpose ?? 'login';
    const { e164, hash, masked } = this.phone(input.phone);
    return this.uow.run(async (tx) => {
      const res = await this.otp.request(e164, hash, purpose, tx, input.channel ?? 'sms');
      return { phoneMasked: masked, expiresAt: res.expiresAt, resendAfterSec: res.resendAfterSec, channel: res.channel };
    });
  }

  /**
   * Verifies the login code, finds or creates the Person for this phone hash, registers the device
   * and opens a session — all in one transaction. A new device on an existing person is recorded
   * as verified (the OTP just proved it) and emits `device.registered`.
   */
  async verifyOtp(input: VerifyOtp): Promise<z.infer<typeof VerifyOtpOutput>> {
    const { e164, hash } = this.phone(input.phone);
    return this.uow.run(async (tx) => {
      await this.otp.verify(hash, 'login', input.code, tx);
      const now = this.clock.now();
      let person = await this.repo.findPersonByPhoneHash(hash, tx);
      let isNew = false;
      if (!person) {
        isNew = true;
        person = await this.repo.createPersonWithIdentity({ locale: 'ar-IQ', sharedFamilyPhone: input.sharedFamilyPhone ?? false, phoneE164: e164, phoneHash: hash, name: null, now }, tx);
        await this.events.emit(tx, { actorId: person.id, type: 'person.registered', occurredAt: now, payload: { personId: person.id, sharedFamilyPhone: person.sharedFamilyPhone } }, { name: 'person', id: person.id });
        await this.repo.upsertRole({ personId: person.id, kind: 'customer', orgId: null, grantedBy: SYSTEM_ACTOR, now }, tx);
        await this.events.emit(tx, { actorId: SYSTEM_ACTOR, type: 'role.granted', occurredAt: now, payload: { personId: person.id, kind: 'customer', orgId: null } }, { name: 'person', id: person.id });
      } else if (person.deletedAt) {
        throw new DriverError('account_suspended');
      } else if (input.sharedFamilyPhone && !person.sharedFamilyPhone) {
        await this.repo.updatePerson(person.id, { sharedFamilyPhone: true }, tx);
      }
      const deviceId = input.device ? (await this.registerDevice(person.id, input.device, now, true, tx)).id : null;
      await this.markVerified(person.id, now, tx, isNew ? 'person.verified' : 'person.reverified', person.lastVerifiedAt === null);
      const { tokens } = await this.sessions.open(person.id, deviceId, tx);
      return { personId: person.id, isNew, tokens };
    });
  }

  private async registerDevice(personId: string, device: DeviceInfo, now: Date, verified: boolean, tx: Tx) {
    const existing = await this.repo.findDevice(personId, device.fingerprint, tx);
    if (existing) {
      return this.repo.updateDevice(existing.id, { lastSeenAt: now, appVersion: device.appVersion ?? existing.appVersion, ...(verified && !existing.verifiedAt ? { verifiedAt: now } : {}) }, tx);
    }
    const created = await this.repo.createDevice({ personId, fingerprint: device.fingerprint, platform: device.platform, appVersion: device.appVersion ?? null, verifiedAt: verified ? now : null, now }, tx);
    await this.events.emit(tx, { actorId: personId, type: 'device.registered', occurredAt: now, payload: { personId, deviceId: created.id, platform: device.platform, verified } }, { name: 'person', id: personId });
    return created;
  }

  /** Sets lastVerifiedAt, thaws frozen roles and emits person.verified (first time) or person.reverified. */
  private async markVerified(personId: string, now: Date, tx: Tx, type: 'person.verified' | 'person.reverified', firstTime: boolean) {
    await this.repo.updatePerson(personId, { lastVerifiedAt: now }, tx);
    const thawed = await this.repo.setRolesFrozen(personId, FREEZABLE_ROLES, null, tx);
    await this.events.emit(tx, { actorId: personId, type: firstTime ? 'person.verified' : type, occurredAt: now, payload: { personId, rolesThawed: thawed } }, { name: 'person', id: personId });
  }

  // ───────────────────────── sessions ─────────────────────────

  /**
   * Rotates the refresh token. When the client reports a device fingerprint this person has never
   * verified, re-verification is required: freezable roles are frozen and the session still
   * refreshes (so the app can show the OTP screen), but `me.reverificationRequired` turns true.
   */
  async refresh(refreshToken: string, device?: DeviceInfo): Promise<TokenPair> {
    return this.uow.run(async (tx) => {
      const now = this.clock.now();
      const { session, tokens } = await this.sessions.refresh(refreshToken, tx, async (s) => {
        if (!device) return;
        const known = await this.repo.findDevice(s.personId, device.fingerprint, tx);
        if (known && known.verifiedAt) {
          await this.repo.updateDevice(known.id, { lastSeenAt: now }, tx);
          return { deviceId: known.id };
        }
        const d = await this.registerDevice(s.personId, device, now, false, tx);
        await this.freezeForReverification(s.personId, now, 'new_device', tx);
        return { deviceId: d.id };
      });
      await this.checkIdle(session.personId, now, tx);
      return tokens;
    });
  }

  async logout(actor: Actor, refreshToken?: string): Promise<void> {
    await this.uow.run(async (tx) => {
      await this.sessions.revoke(actor.sessionId, tx);
      if (refreshToken) await this.sessions.revokeByRefreshToken(refreshToken, tx);
      // Notify drops the push tokens this session registered (a signed-out phone gets nothing).
      await this.events.emit(tx, { actorId: actor.personId, type: 'session.signed_out', occurredAt: this.clock.now(), payload: { personId: actor.personId, sessionId: actor.sessionId } }, { name: 'person', id: actor.personId });
    });
  }

  verifyAccessToken(token: string): Promise<SessionClaims> {
    return this.sessions.verifyAccessToken(token);
  }

  /** Throws `session_expired` / `token_invalid` unless the session is still live (open `live.*` streams re-check it). */
  assertSessionLive(claims: Pick<SessionClaims, 'sub' | 'sid' | 'did'>): Promise<void> {
    return this.sessions.assertSessionLive(claims);
  }

  // ───────────────────────── re-verification (edge-case §7) ─────────────────────────

  /** True when the person must re-verify by OTP: 120 idle days, or a device not yet verified. */
  async reverificationRequired(personId: string, deviceId?: string, tx?: Tx): Promise<boolean> {
    const person = await this.repo.findPersonById(personId, tx);
    if (!person) throw new DriverError('person_not_found');
    const now = this.clock.now();
    if (await this.checkIdle(personId, now, tx, person)) return true;
    if (deviceId) {
      const device = await this.repo.findDeviceById(deviceId, tx);
      if (device && !device.verifiedAt) return true;
    }
    const roles = await this.repo.rolesOf(personId, tx);
    return roles.some((r) => r.frozenAt !== null);
  }

  private async checkIdle(personId: string, now: Date, tx?: Tx, person?: PersonRecord): Promise<boolean> {
    const p = person ?? (await this.repo.findPersonById(personId, tx));
    if (!p) return false;
    const idleMs = now.getTime() - (p.lastVerifiedAt ?? p.createdAt).getTime();
    if (idleMs >= REVERIFY_AFTER_IDLE_DAYS * 86_400_000) {
      await this.freezeForReverification(personId, now, 'idle_120_days', tx);
      return true;
    }
    return false;
  }

  private async freezeForReverification(personId: string, now: Date, reason: 'new_device' | 'idle_120_days', tx?: Tx) {
    const roles = await this.repo.rolesOf(personId, tx);
    const toFreeze = roles.filter((r) => FREEZABLE_ROLES.includes(r.kind) && r.frozenAt === null);
    if (toFreeze.length === 0) return;
    await this.repo.setRolesFrozen(personId, FREEZABLE_ROLES, now, tx);
    await this.events.emit(tx, { actorId: SYSTEM_ACTOR, type: 'person.reverification_required', occurredAt: now, payload: { personId, reason, frozenRoles: toFreeze.map((r) => r.kind) } }, { name: 'person', id: personId });
  }

  // ───────────────────────── roles ─────────────────────────

  async hasRole(personId: string, kind: RoleKind, orgId?: string): Promise<boolean> {
    const roles = await this.repo.rolesOf(personId);
    return roles.some((r) => r.kind === kind && r.frozenAt === null && (orgId === undefined || r.orgId === orgId));
  }

  /**
   * Live (unfrozen) role kinds of a person, deduplicated across orgs. The narrow read other modules
   * get through `ROLE_READER` (the ledger's cash caps by role, G-80); nothing else about the person.
   */
  async activeRoles(personId: string): Promise<RoleKind[]> {
    const roles = await this.repo.rolesOf(personId);
    return [...new Set(roles.filter((r) => r.frozenAt === null).map((r) => r.kind))];
  }

  /**
   * The narrow roster port (Console drivers list): people holding any of `kinds`, paged by person
   * id, with those grants and whether any is frozen. Pseudonymous: nothing is read from the vault.
   */
  async roster(input: { kinds: readonly RoleKind[]; cursor?: string | undefined; limit: number; q?: string | undefined }): Promise<RosterResult> {
    const { people, total } = await this.repo.peopleWithRoles(input.kinds, { afterId: input.cursor, limit: input.limit + 1, idContains: input.q || undefined });
    const page = people.slice(0, input.limit);
    return {
      rows: page.map(({ person, roles }) => {
        const held = roles.filter((r) => input.kinds.includes(r.kind));
        return {
          personId: person.id,
          roles: [...new Set(held.map((r) => r.kind))].sort(),
          frozen: held.some((r) => r.frozenAt !== null),
          trustTier: person.trustTier,
          joinedAt: person.createdAt,
        };
      }),
      nextCursor: people.length > input.limit ? (page.at(-1)?.person.id ?? null) : null,
      total,
    };
  }

  /** Live roles of one person, limited to `kinds` (the roster's presence-first path). */
  async rosterEntry(personId: string, kinds: readonly RoleKind[]): Promise<RosterRow | null> {
    const person = await this.repo.findPersonById(personId);
    if (!person || person.deletedAt) return null;
    const held = (await this.repo.rolesOf(personId)).filter((r) => kinds.includes(r.kind));
    if (held.length === 0) return null;
    return { personId, roles: [...new Set(held.map((r) => r.kind))].sort(), frozen: held.some((r) => r.frozenAt !== null), trustTier: person.trustTier, joinedAt: person.createdAt };
  }

  /** Idempotent: granting an existing role returns it and emits nothing. */
  async grantRole(actor: Actor | { personId: string }, input: GrantRole): Promise<RoleGrant> {
    return this.uow.run(async (tx) => {
      const person = await this.repo.findPersonById(input.personId, tx);
      if (!person) throw new DriverError('person_not_found');
      if (person.sharedFamilyPhone && SHARED_PHONE_FORBIDDEN_ROLES.includes(input.kind)) throw new DriverError('shared_phone_role_forbidden');
      const now = this.clock.now();
      const orgId = input.orgId ?? null;
      const { role, created } = await this.repo.upsertRole({ personId: input.personId, kind: input.kind, orgId, grantedBy: actor.personId, now }, tx);
      if (created) {
        await this.events.emit(tx, { actorId: actor.personId, type: 'role.granted', occurredAt: now, payload: { personId: input.personId, kind: input.kind, orgId } }, { name: 'person', id: input.personId });
      }
      return roleGrant(role);
    });
  }

  /** Idempotent: revoking an absent role is a no-op. The event carries the actor who revoked. */
  async revokeRole(actor: Actor | { personId: string }, input: z.infer<typeof RevokeRoleInput>): Promise<void> {
    await this.uow.run(async (tx) => {
      const orgId = input.orgId ?? null;
      const role = (await this.repo.rolesOf(input.personId, tx)).find((r) => r.kind === input.kind && r.orgId === orgId);
      if (!role) return;
      const now = this.clock.now();
      await this.repo.revokeRole(role.id, now, tx);
      await this.events.emit(tx, { actorId: actor.personId, type: 'role.revoked', occurredAt: now, payload: { personId: input.personId, kind: input.kind, orgId, revokedBy: actor.personId } }, { name: 'person', id: input.personId });
    });
  }

  // ───────────────────────── profile ─────────────────────────

  /** Name from the vault (access logged) plus live roles and re-verification state. */
  async me(actor: Actor): Promise<MeView> {
    return this.profile(actor.personId, actor.personId, 'self_profile', actor.deviceId);
  }

  /** Reads identifiers from the vault and writes a VaultAccessLog row with the reason (domain §13). */
  async profile(personId: string, accessorId: string, reason: string, deviceId?: string): Promise<MeView> {
    return this.uow.run(async (tx) => {
      const person = await this.repo.findPersonById(personId, tx);
      if (!person) throw new DriverError('person_not_found');
      const identity = await this.repo.readIdentity(personId, tx);
      if (!identity) throw new DriverError('person_not_found');
      const trusted = trustedOf(identity);
      const fieldsRead = ['name', 'phone_e164', ...(identity.emergencyContact ? ['emergency_contact'] : []), ...(identity.trustedContacts?.length ? ['trusted_contacts'] : [])];
      await this.repo.logVaultAccess({ personId, accessorId, purpose: reason, fieldsRead, now: this.clock.now() }, tx);
      const reverify = await this.reverificationRequired(personId, deviceId, tx);
      const roles = await this.repo.rolesOf(personId, tx);
      return {
        personId,
        name: identity.name,
        phoneMasked: maskPhone(identity.phoneE164),
        locale: person.locale,
        trustTier: person.trustTier,
        sharedFamilyPhone: person.sharedFamilyPhone,
        roles: roles.map(roleGrant),
        reverificationRequired: reverify,
        canWithdraw: !reverify,
        lastVerifiedAt: person.lastVerifiedAt,
        emergencyContact: identity.emergencyContact ? maskedContact(identity.emergencyContact) : null,
        trustedContacts: trusted.map(maskedContact),
        safety: identity.safetyPrefs ?? { ...DEFAULT_SAFETY_PREFS },
      };
    });
  }

  /**
   * The courier card a customer sees on an order the courier carries (customer app §4): his first
   * name only — read from the vault and logged with purpose `courier_card` — when he last verified
   * himself (OTP re-verification; the Partner shift selfie replaces it when it ships), and the storage
   * ref of his APPROVED main photo (Ali, 2026-10-06; the caller signs a short-lived URL). The read
   * logs `main_photo` too when he has one; a photo still under review never leaves the vault.
   */
  async courierCard(courierId: string, accessorId: string): Promise<{ firstName: string | null; lastVerifiedAt: Date | null; photoRef: string | null }> {
    return this.uow.run(async (tx) => {
      const person = await this.repo.findPersonById(courierId, tx);
      if (!person || person.deletedAt) return { firstName: null, lastVerifiedAt: null, photoRef: null };
      const identity = await this.repo.readIdentity(courierId, tx);
      const photoRef = identity?.mainPhotoRef ?? null;
      await this.repo.logVaultAccess({ personId: courierId, accessorId, purpose: 'courier_card', fieldsRead: photoRef ? ['name', 'main_photo'] : ['name'], now: this.clock.now() }, tx);
      const first = identity?.name?.trim().split(/\s+/)[0] ?? '';
      return { firstName: first || null, lastVerifiedAt: person.lastVerifiedAt, photoRef };
    });
  }

  // ───────────────────────── driver main photo (Ali, 2026-10-06) ─────────────────────────

  /**
   * The approved main photos of drivers a customer is shown (ride match card, الرجعة offers and seat,
   * the share page): storage refs by person id, only for people who have one. Each one returned is a
   * VaultAccessLog row (`main_photo`, the caller's accessor and purpose); deleted people are left out.
   */
  async mainPhotoRefs(personIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string>> {
    const ids = [...new Set(personIds)];
    if (ids.length === 0) return {};
    return this.uow.run(async (tx) => {
      const live = (await this.repo.findPeopleByIds(ids, tx)).filter((p) => !p.deletedAt).map((p) => p.id);
      if (live.length === 0) return {};
      const out: Record<string, string> = {};
      for (const i of await this.repo.readIdentities(live, tx)) if (i.mainPhotoRef) out[i.personId] = i.mainPhotoRef;
      const now = this.clock.now();
      await this.repo.logVaultAccessMany(
        Object.keys(out).filter((id) => id !== accessorId).map((personId) => ({ personId, accessorId, purpose, fieldsRead: ['main_photo'], now })),
        tx,
      );
      return out;
    });
  }

  /**
   * A `photo` driver document was approved: its upload (the vault's document ref for that record)
   * becomes the main photo customers see. Called by driver-account inside the review's unit of work;
   * a rejected or pending photo never gets here, so the previous approved photo (or the initial)
   * stays until then. Returns the ref, or null when the document has no stored ref.
   */
  async promoteMainPhoto(personId: string, documentId: string): Promise<string | null> {
    return this.uow.run(async (tx) => {
      const ref = (await this.repo.vaultRefs(personId, 'documentRefs', tx)).find((r) => r['recordId'] === documentId && typeof r['ref'] === 'string');
      if (!ref) return null;
      await this.repo.updateIdentity(personId, { mainPhotoRef: ref['ref'] as string, mainPhotoAt: this.clock.now() }, tx);
      return ref['ref'] as string;
    });
  }

  /**
   * The driver's own photo refs for his "صورتك" screen: the approved main photo and the upload behind
   * each `photo` document (by document id). His own vault row, so nothing is logged.
   */
  async ownPhotoRefs(personId: string): Promise<{ mainRef: string | null; mainAt: Date | null; byDocument: Record<string, string> }> {
    const identity = await this.repo.readIdentity(personId);
    const byDocument: Record<string, string> = {};
    for (const r of await this.repo.vaultRefs(personId, 'documentRefs')) {
      if (r['kind'] === 'photo' && typeof r['recordId'] === 'string' && typeof r['ref'] === 'string') byDocument[r['recordId']] = r['ref'];
    }
    return { mainRef: identity?.mainPhotoRef ?? null, mainAt: identity?.mainPhotoAt ?? null, byDocument };
  }

  /**
   * First names only, for a work context that shows people by first name (the intercity driver's
   * manifest). Every read is logged against the person read, with the caller's `purpose`; the full
   * name and the phone never leave identity. Unknown or deleted people are left out; a person
   * without a name maps to null.
   */
  async firstNamesFor(personIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string | null>> {
    return this.uow.run(async (tx) => {
      const now = this.clock.now();
      const out: Record<string, string | null> = {};
      for (const personId of new Set(personIds)) {
        const person = await this.repo.findPersonById(personId, tx);
        if (!person || person.deletedAt) continue;
        const identity = await this.repo.readIdentity(personId, tx);
        if (personId !== accessorId) await this.repo.logVaultAccess({ personId, accessorId, purpose, fieldsRead: ['name'], now }, tx);
        const first = identity?.name ? firstNameOf(identity.name) : '';
        out[personId] = first || null;
      }
      return out;
    });
  }

  /**
   * Staff display names for the Console (K-01): "حيدر ك." — the first name and the family initial,
   * never the full name or the phone. Batched: one read of the people, one of the vault rows and
   * one write of the access log, a row per person read (the caller's `purpose`, the staff member as
   * accessor). Deleted people come back marked `deleted` with nothing read or logged; unknown ids
   * are left out; a person with no name in the vault maps to `displayName: null`.
   */
  async displayNamesFor(personIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, { displayName: string | null; deleted: boolean }>> {
    const ids = [...new Set(personIds)];
    if (ids.length === 0) return {};
    return this.uow.run(async (tx) => {
      const now = this.clock.now();
      const out: Record<string, { displayName: string | null; deleted: boolean }> = {};
      const live: string[] = [];
      for (const person of await this.repo.findPeopleByIds(ids, tx)) {
        if (person.deletedAt) out[person.id] = { displayName: null, deleted: true };
        else live.push(person.id);
      }
      if (live.length === 0) return out;
      const vault = new Map((await this.repo.readIdentities(live, tx)).map((i) => [i.personId, i]));
      await this.repo.logVaultAccessMany(
        live.filter((id) => id !== accessorId && vault.has(id)).map((personId) => ({ personId, accessorId, purpose, fieldsRead: ['name'], now })),
        tx,
      );
      for (const id of live) {
        const name = vault.get(id)?.name;
        out[id] = { displayName: name ? shortDisplayName(name) : null, deleted: false };
      }
      return out;
    });
  }

  /**
   * Console drivers search by name: which of `personIds` have a staff display name ("حيدر ك.")
   * matching `query`, spelling-folded (`searchScore`: every query word starts a word of the name).
   * Only the display name is matched, so a search never reveals a family name. One read of the
   * people and one of the vault rows; a log row (the staff member as accessor, `purpose`) for each
   * person returned, since the search discloses those names. Deleted people never match.
   */
  async matchDisplayNames(personIds: readonly string[], query: string, accessorId: string, purpose: string): Promise<string[]> {
    const ids = [...new Set(personIds)];
    if (ids.length === 0 || !query.trim()) return [];
    return this.uow.run(async (tx) => {
      const live = (await this.repo.findPeopleByIds(ids, tx)).filter((p) => !p.deletedAt).map((p) => p.id);
      if (live.length === 0) return [];
      const vault = await this.repo.readIdentities(live, tx);
      const hits = vault.filter((i) => i.name && searchScore(query, shortDisplayName(i.name)) > 0).map((i) => i.personId);
      const now = this.clock.now();
      await this.repo.logVaultAccessMany(
        hits.filter((id) => id !== accessorId).map((personId) => ({ personId, accessorId, purpose, fieldsRead: ['name'], now })),
        tx,
      );
      return ids.filter((id) => hits.includes(id));
    });
  }

  /**
   * Customer spec §10: the display name and the emergency contact go to the vault only (domain §13);
   * the public side records just that the profile changed, never the values.
   */
  async updateProfile(actor: Actor, input: UpdateProfileInput): Promise<MeView> {
    const name = input.name?.trim();
    if (input.name !== undefined && (!name || name.length > 60)) throw new DriverError('invalid_input');
    const contact = (c: { name: string; phone: string; relation?: EmergencyRelation | undefined }): EmergencyContactRecord => {
      const contactName = c.name.trim();
      if (!contactName) throw new DriverError('invalid_input');
      return { name: contactName, phoneE164: this.phone(c.phone).e164, relation: c.relation ?? null };
    };
    let emergencyContact: EmergencyContactRecord | null | undefined;
    if (input.emergencyContact === null) emergencyContact = null;
    else if (input.emergencyContact) emergencyContact = contact(input.emergencyContact);
    // Everything is checked before anything is written.
    const fresh = input.trustedContacts?.map((c) => ('keep' in c ? c : contact(c)));
    await this.uow.run(async (tx) => {
      const now = this.clock.now();
      const current = await this.repo.readIdentity(actor.personId, tx);
      if (!current) throw new DriverError('person_not_found');
      const patch: Parameters<IdentityRepository['updateIdentity']>[1] = { ...(name !== undefined ? { name } : {}) };
      const fields: string[] = name !== undefined ? ['name'] : [];
      let trusted: EmergencyContactRecord[] | undefined;
      if (fresh) {
        // The whole list (w9): kept people by index (their numbers never left the vault), new ones as typed.
        const before = trustedOf(current);
        trusted = fresh.map((c) => {
          if (!('keep' in c)) return c;
          const kept = before[c.keep];
          if (!kept) throw new DriverError('invalid_input');
          return kept;
        });
        if (new Set(trusted.map((c) => c.phoneE164)).size !== trusted.length) throw new DriverError('invalid_input');
        emergencyContact = trusted[0] ?? null;
      } else if (emergencyContact !== undefined) {
        // The emergency contact set on its own (old screens, Partner) is the first trusted person.
        const rest = trustedOf(current).slice(1).filter((c) => c.phoneE164 !== emergencyContact?.phoneE164);
        trusted = emergencyContact ? [emergencyContact, ...rest].slice(0, TRUSTED_CONTACTS_MAX) : rest;
        if (!emergencyContact && rest[0]) emergencyContact = rest[0];
      }
      if (emergencyContact !== undefined) {
        patch.emergencyContact = emergencyContact;
        fields.push('emergency_contact');
      }
      if (trusted !== undefined) {
        patch.trustedContacts = trusted;
        fields.push('trusted_contacts');
      }
      if (input.safety) {
        patch.safetyPrefs = { ...DEFAULT_SAFETY_PREFS, ...(current.safetyPrefs ?? {}), ...input.safety };
        fields.push('safety_prefs');
      }
      await this.repo.updateIdentity(actor.personId, patch, tx);
      await this.events.emit(tx, { actorId: actor.personId, type: 'person.profile_updated', occurredAt: now, payload: { personId: actor.personId, fields } }, { name: 'person', id: actor.personId });
    });
    return this.me(actor);
  }

  /**
   * The trusted people's names and numbers (w9) for a message about the person (the «وصل بالسلامة»
   * ping): a logged vault read against the person, like the SOS contact.
   */
  async trustedContactsOf(personId: string, accessorId: string, purpose: string): Promise<{ name: string; phoneE164: string }[]> {
    return this.uow.run(async (tx) => {
      const person = await this.repo.findPersonById(personId, tx);
      if (!person || person.deletedAt) return [];
      const identity = await this.repo.readIdentity(personId, tx);
      const list = identity ? trustedOf(identity) : [];
      if (list.length === 0) return [];
      await this.repo.logVaultAccess({ personId, accessorId, purpose, fieldsRead: ['trusted_contacts'], now: this.clock.now() }, tx);
      return list.map((c) => ({ name: c.name, phoneE164: c.phoneE164 }));
    });
  }

  /** The person's safety switches (w9); not personal data, so the read is not logged. */
  async safetyPrefsOf(personId: string): Promise<SafetyPrefs> {
    return (await this.repo.readIdentity(personId))?.safetyPrefs ?? { ...DEFAULT_SAFETY_PREFS };
  }

  /**
   * The peppered hash of a person's own number: the key pending points wait under (domain §3). The
   * hash is the public pseudonym, not an identifier, so the read is not logged.
   */
  async phoneHashOf(personId: string): Promise<string | null> {
    return (await this.repo.readIdentity(personId))?.phoneHash ?? null;
  }

  /**
   * Household cards (domain §12): name and masked phone of each member for another member to see.
   * Every read is logged against the member read (purpose household_view). Deleted people are left
   * out — no vault read, nothing shown — like `firstNamesFor` / `courierCard` (review 2026-10-04 #23);
   * callers render a missing card as a nameless row.
   */
  async memberCards(personIds: readonly string[], accessorId: string, purpose = 'household_view'): Promise<Record<string, { name: string | null; phoneMasked: string }>> {
    return this.uow.run(async (tx) => {
      const now = this.clock.now();
      const out: Record<string, { name: string | null; phoneMasked: string }> = {};
      for (const personId of new Set(personIds)) {
        const person = await this.repo.findPersonById(personId, tx);
        if (!person || person.deletedAt) continue;
        const identity = await this.repo.readIdentity(personId, tx);
        if (!identity) continue;
        if (personId !== accessorId) await this.repo.logVaultAccess({ personId, accessorId, purpose, fieldsRead: ['name', 'phone_e164'], now }, tx);
        out[personId] = { name: identity.name, phoneMasked: maskPhone(identity.phoneE164) };
      }
      return out;
    });
  }

  /**
   * The number an owner typed for an invite still waiting, as "0770 ••• 4567" (fleet drivers,
   * merchant staff): head and tail only, never the name. Each read is a VaultAccessLog row.
   */
  async invitePhoneHints(
    personIds: readonly string[],
    accessorId: string,
    purpose: string,
  ): Promise<Record<string, string>> {
    return this.uow.run(async (tx) => {
      const now = this.clock.now();
      const out: Record<string, string> = {};
      for (const personId of new Set(personIds)) {
        const identity = await this.repo.readIdentity(personId, tx);
        if (!identity) continue;
        if (personId !== accessorId)
          await this.repo.logVaultAccess(
            { personId, accessorId, purpose, fieldsRead: ['phone_e164'], now },
            tx,
          );
        out[personId] = invitePhoneHint(identity.phoneE164);
      }
      return out;
    });
  }

  /**
   * When each person last verified a phone OTP (null = never signed in: an invite still waiting).
   * Reads the person rows only, no vault fields.
   */
  async verifiedAtOf(personIds: readonly string[]): Promise<Record<string, Date | null>> {
    const out: Record<string, Date | null> = {};
    for (const personId of new Set(personIds)) out[personId] = (await this.repo.findPersonById(personId))?.lastVerifiedAt ?? null;
    return out;
  }

  /**
   * When each person last used the app: the later of his last OTP sign-in and his latest session
   * start or refresh (null = never). Person and session rows only, no vault fields.
   */
  async lastActiveAtOf(personIds: readonly string[]): Promise<Record<string, Date | null>> {
    const ids = [...new Set(personIds)];
    const [verified, sessions] = await Promise.all([this.verifiedAtOf(ids), this.repo.lastSessionAtOf(ids)]);
    const out: Record<string, Date | null> = {};
    for (const id of ids) {
      const v = verified[id] ?? null;
      const s = sessions[id] ?? null;
      out[id] = v && s ? (v > s ? v : s) : (v ?? s);
    }
    return out;
  }

  /**
   * Household invite by phone (domain §12): the Person behind the number, created pseudonymously when
   * the number has never signed in (as a guardian link does). The number stays in the vault.
   */
  async ensurePersonByPhone(rawPhone: string, actorId: string, via: string): Promise<string> {
    const { e164, hash } = this.phone(rawPhone);
    return this.uow.run(async (tx) => {
      const existing = await this.repo.findPersonByPhoneHash(hash, tx);
      if (existing) return existing.id;
      const now = this.clock.now();
      const person = await this.repo.createPersonWithIdentity({ locale: 'ar-IQ', sharedFamilyPhone: false, phoneE164: e164, phoneHash: hash, name: null, now }, tx);
      await this.events.emit(tx, { actorId, type: 'person.registered', occurredAt: now, payload: { personId: person.id, via } }, { name: 'person', id: person.id });
      return person.id;
    });
  }

  /** Looks a person up by phone without creating one. Used by orgs/households and support. */
  async personIdByPhone(rawPhone: string): Promise<string | null> {
    const { hash } = this.phone(rawPhone);
    const p = await this.repo.findPersonByPhoneHash(hash);
    return p?.id ?? null;
  }

  /**
   * Order participants (domain §3): the peppered phone hash plus the Person behind it, if any. The
   * number itself never leaves identity; a participant without a person earns `points_pending`
   * keyed by this hash, claimed on verification.
   */
  async phoneRef(rawPhone: string): Promise<{ personId: string | null; phoneHash: string }> {
    const { hash } = this.phone(rawPhone);
    const p = await this.repo.findPersonByPhoneHash(hash);
    return { personId: p?.id ?? null, phoneHash: hash };
  }

  async setName(actor: Actor, name: string): Promise<void> {
    await this.uow.run(async (tx) => {
      await this.repo.updateIdentity(actor.personId, { name }, tx);
    });
  }

  // ───────────────────────── خطوط children (vault) ─────────────────────────

  /**
   * M2 review follow-up: a khat child's name goes into the vault, keyed by an opaque `childRef` that is
   * all stops and events ever carry. The registering person is the child's guardian.
   */
  async registerChild(actor: Actor | { personId: string }, input: { name: string }): Promise<{ childRef: string }> {
    const name = input.name.trim();
    if (!name || name.length > 80) throw new DriverError('invalid_input');
    return this.uow.run(async (tx) => {
      const now = this.clock.now();
      const child = await this.repo.createChildIdentity({ guardianId: actor.personId, name, now }, tx);
      await this.events.emit(tx, { actorId: actor.personId, type: 'child.registered', occurredAt: now, payload: { childRef: child.childRef, guardianId: actor.personId } }, { name: 'person', id: actor.personId });
      return { childRef: child.childRef };
    });
  }

  /**
   * The driver's run sheet (trips' narrow port): names for the children on his stops. Trips decides he
   * is the trip's driver; every name read here is logged (accessor = driver, purpose khat_run_sheet).
   */
  async childNamesForRunSheet(driverId: string, childRefs: readonly string[]): Promise<Record<string, string>> {
    return this.readChildNames(driverId, [...new Set(childRefs)], 'khat_run_sheet');
  }

  /**
   * Wave 2 (`khat.todayRun`) rows: each child's FIRST name (the full name never leaves identity) and the storage ref of the photo the guardian added
   * (null without one), for the run's own driver ONLY — the khat module checks he drives the run (the
   * assigned driver, or the substitute once the run is his). One log row per child read, against the
   * guardian (purpose khat_today_run; `child_photo` in the fields when a photo went out).
   */
  async childCardsForRun(driverId: string, childRefs: readonly string[]): Promise<Record<string, { firstName: string; photoRef: string | null }>> {
    const refs = [...new Set(childRefs)];
    if (refs.length === 0) return {};
    return this.uow.run(async (tx) => {
      const found = await this.repo.readChildIdentities(refs, tx);
      const now = this.clock.now();
      const out: Record<string, { firstName: string; photoRef: string | null }> = {};
      for (const ref of refs) {
        const c = found.find((x) => x.childRef === ref);
        if (!c) continue;
        const photoRef = c.photoRef ?? null;
        await this.repo.logVaultAccess({ personId: c.guardianId ?? driverId, accessorId: driverId, purpose: 'khat_today_run', fieldsRead: photoRef ? ['child_name', 'child_photo'] : ['child_name'], childRef: c.childRef, now }, tx);
        out[c.childRef] = { firstName: firstNameOf(c.name), photoRef };
      }
      return out;
    });
  }

  /**
   * The guardian's own children with the storage ref of each one's photo (customer app, خطوط
   * children). Only the guardian's own; each read logged (guardian_view).
   */
  async childrenWithPhotos(guardianId: string): Promise<Array<{ childRef: string; name: string; photoRef: string | null }>> {
    return this.uow.run(async (tx) => {
      const children = await this.repo.childIdentitiesOf(guardianId, tx);
      const now = this.clock.now();
      for (const c of children) {
        await this.repo.logVaultAccess({ personId: guardianId, accessorId: guardianId, purpose: 'guardian_view', fieldsRead: c.photoRef ? ['child_name', 'child_photo'] : ['child_name'], childRef: c.childRef, now }, tx);
      }
      return children.map((c) => ({ childRef: c.childRef, name: c.name, photoRef: c.photoRef ?? null }));
    });
  }

  /**
   * A guardian sets (a storage ref) or removes (null) his child's photo. Only the child's own guardian:
   * anyone else gets `forbidden`, an unknown child `not_found`. Returns the ref it replaced, so the
   * caller deletes those bytes.
   */
  async setChildPhoto(guardianId: string, childRef: string, photoRef: string | null): Promise<{ previousRef: string | null }> {
    return this.uow.run(async (tx) => {
      const [child] = await this.repo.readChildIdentities([childRef], tx);
      if (!child) throw new DriverError('not_found');
      if (child.guardianId !== guardianId) throw new DriverError('forbidden');
      await this.repo.setChildPhoto(childRef, photoRef, tx);
      const now = this.clock.now();
      await this.events.emit(tx, { actorId: guardianId, type: photoRef ? 'child.photo_set' : 'child.photo_removed', occurredAt: now, payload: { childRef } }, { name: 'person', id: guardianId });
      return { previousRef: child.photoRef ?? null };
    });
  }

  // ───────────────────────── wave 2: vault refs, org roles ─────────────────────────

  /**
   * A driver document photo or check-in selfie: the storage ref goes to the vault row
   * (`document_refs` / `selfie_refs`, domain §13); the public schema keeps only status and expiry.
   */
  async attachVaultRef(personId: string, field: 'documentRefs' | 'selfieRefs', entry: { ref: string; kind: string; recordId: string }): Promise<void> {
    await this.uow.run(async (tx) => {
      const identity = await this.repo.readIdentity(personId, tx);
      if (!identity) throw new DriverError('person_not_found');
      await this.repo.appendVaultRef(personId, field, { ...entry, at: this.clock.now().toISOString() }, tx);
    });
  }

  /** A reviewer's read of the storage refs (Console document review); every read is logged. */
  async vaultRefsFor(personId: string, field: 'documentRefs' | 'selfieRefs', accessorId: string, purpose: string): Promise<Array<{ ref: string; kind: string; recordId: string; at: string }>> {
    return this.uow.run(async (tx) => {
      const refs = await this.repo.vaultRefs(personId, field, tx);
      await this.repo.logVaultAccess({ personId, accessorId, purpose, fieldsRead: [field === 'documentRefs' ? 'document_refs' : 'selfie_refs'], now: this.clock.now() }, tx);
      return refs.map((r) => ({ ref: String(r['ref'] ?? ''), kind: String(r['kind'] ?? ''), recordId: String(r['recordId'] ?? ''), at: String(r['at'] ?? '') }));
    });
  }

  /** Orgs where the person holds a live (unfrozen) grant of one of `kinds`: merchant staff, fleet owners. */
  async scopedOrgs(personId: string, kinds: readonly RoleKind[]): Promise<Array<{ orgId: string; kind: RoleKind }>> {
    const roles = await this.repo.rolesOf(personId);
    return roles.filter((r) => r.orgId !== null && r.frozenAt === null && kinds.includes(r.kind)).map((r) => ({ orgId: r.orgId!, kind: r.kind }));
  }

  /** Who holds `kinds` at `orgId`, since when and granted by whom (pseudonymous; names through `memberCards`, logged). */
  async orgRoleHolders(orgId: string, kinds: readonly RoleKind[]): Promise<Array<{ personId: string; kind: RoleKind; frozen: boolean; grantedAt: Date; grantedBy: string | null }>> {
    const roles = await this.repo.orgRoleHolders(orgId, kinds);
    return roles.map((r) => ({ personId: r.personId, kind: r.kind, frozen: r.frozenAt !== null, grantedAt: r.createdAt, grantedBy: r.grantedBy }));
  }

  /**
   * A person's own number for the DEVELOPMENT call bridge (chat module's `DevCallBridge`): the only
   * path that hands a raw number out of identity, and only to a caller that is a party of the same
   * order. Every read is a VaultAccessLog row (`fieldsRead: phone_e164`, the caller's `purpose`).
   * Production never calls it: the proxy bridge dials a platform number.
   */
  async phoneForCall(personId: string, accessorId: string, purpose: string): Promise<string | null> {
    return this.uow.run(async (tx) => {
      const person = await this.repo.findPersonById(personId, tx);
      if (!person || person.deletedAt) return null;
      const identity = await this.repo.readIdentity(personId, tx);
      if (!identity) return null;
      await this.repo.logVaultAccess({ personId, accessorId, purpose, fieldsRead: ['phone_e164'], now: this.clock.now() }, tx);
      return identity.phoneE164;
    });
  }

  /**
   * What the notify module needs to reach a person: the locale (public side) always, the E.164
   * number only with `phone` (an SMS or WhatsApp is about to go out). A phone read is a
   * VaultAccessLog row (accessor `system:notify`, the template as purpose). Null for unknown or
   * deleted people.
   */
  async notifyContact(personId: string, opts: { phone: boolean; purpose: string }): Promise<{ locale: 'ar-IQ' | 'en'; phoneE164: string | null } | null> {
    return this.uow.run(async (tx) => {
      const person = await this.repo.findPersonById(personId, tx);
      if (!person || person.deletedAt) return null;
      const locale = person.locale === 'en' ? 'en' : 'ar-IQ';
      if (!opts.phone) return { locale, phoneE164: null };
      const identity = await this.repo.readIdentity(personId, tx);
      await this.repo.logVaultAccess({ personId, accessorId: 'system:notify', purpose: opts.purpose, fieldsRead: ['phone_e164'], now: this.clock.now() }, tx);
      return { locale, phoneE164: identity?.phoneE164 ?? null };
    });
  }

  /**
   * SOS (scoring & safety §3): the person's emergency contact — name and E.164 number — for the
   * safety module (whether one is set, the contact's first name on the pressing phone) and for notify
   * (the WhatsApp / SMS to that number). Every read is a VaultAccessLog row against the person
   * (`fieldsRead: emergency_contact`, the caller as accessor, its purpose). Null when none is set or
   * the person is unknown or deleted.
   */
  async emergencyContactOf(personId: string, accessorId: string, purpose: string): Promise<{ name: string; phoneE164: string } | null> {
    return this.uow.run(async (tx) => {
      const person = await this.repo.findPersonById(personId, tx);
      if (!person || person.deletedAt) return null;
      const identity = await this.repo.readIdentity(personId, tx);
      await this.repo.logVaultAccess({ personId, accessorId, purpose, fieldsRead: ['emergency_contact'], now: this.clock.now() }, tx);
      return identity?.emergencyContact ? { name: identity.emergencyContact.name, phoneE164: identity.emergencyContact.phoneE164 } : null;
    });
  }

  /**
   * خطوط guardian notice (domain §8 "child dropped"): the child's guardian and first name for the
   * "{child} وصل {place} بالسلامة" message. Logged as a vault read against the guardian.
   */
  async childNotice(childRef: string): Promise<{ guardianId: string; childFirstName: string } | null> {
    return this.uow.run(async (tx) => {
      const [child] = await this.repo.readChildIdentities([childRef], tx);
      if (!child?.guardianId) return null;
      await this.repo.logVaultAccess({ personId: child.guardianId, accessorId: 'system:notify', purpose: 'khat_child_arrived', fieldsRead: ['child_name'], childRef, now: this.clock.now() }, tx);
      return { guardianId: child.guardianId, childFirstName: firstNameOf(child.name) || child.name };
    });
  }

  /**
   * خطوط guardian call (partner S-6): who the run's driver reaches when he taps the call icon on a
   * child's row. The khat module decides he drives that child today; the read is logged against the
   * guardian (accessor = driver, purpose khat_guardian_call). Only the person id leaves identity.
   */
  async guardianForCall(driverId: string, childRef: string): Promise<string | null> {
    return this.uow.run(async (tx) => {
      const [child] = await this.repo.readChildIdentities([childRef], tx);
      if (!child?.guardianId) return null;
      await this.repo.logVaultAccess({ personId: child.guardianId, accessorId: driverId, purpose: 'khat_guardian_call', fieldsRead: ['guardian_id'], childRef, now: this.clock.now() }, tx);
      return child.guardianId;
    });
  }

  /** Field-ops onboarding: names a person created by phone, only when the vault has no name yet. */
  async nameIfMissing(personId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    await this.uow.run(async (tx) => {
      const identity = await this.repo.readIdentity(personId, tx);
      if (identity && !identity.name) await this.repo.updateIdentity(personId, { name: trimmed.slice(0, 60) }, tx);
    });
  }

  /** The guardian's own children (guardian view); every name read is logged. */
  async myChildren(actor: Actor | { personId: string }): Promise<Array<{ childRef: string; name: string }>> {
    return this.uow.run(async (tx) => {
      const children = await this.repo.childIdentitiesOf(actor.personId, tx);
      const now = this.clock.now();
      for (const c of children) {
        await this.repo.logVaultAccess({ personId: actor.personId, accessorId: actor.personId, purpose: 'guardian_view', fieldsRead: ['child_name'], childRef: c.childRef, now }, tx);
      }
      return children.map((c) => ({ childRef: c.childRef, name: c.name }));
    });
  }

  private async readChildNames(accessorId: string, childRefs: string[], purpose: string): Promise<Record<string, string>> {
    if (childRefs.length === 0) return {};
    return this.uow.run(async (tx) => {
      const found = await this.repo.readChildIdentities(childRefs, tx);
      const now = this.clock.now();
      const out: Record<string, string> = {};
      for (const ref of childRefs) {
        const c = found.find((x) => x.childRef === ref);
        if (!c) continue;
        // The subject is the child's guardian (a child has no Person); a guardian-less legacy row is logged against the reader.
        await this.repo.logVaultAccess({ personId: c.guardianId ?? accessorId, accessorId, purpose, fieldsRead: ['child_name'], childRef: c.childRef, now }, tx);
        out[c.childRef] = c.name;
      }
      return out;
    });
  }

  // ───────────────────────── guardians ─────────────────────────

  /** Ward by phone (a Person — found or created pseudonymously) or by participant id. */
  async linkGuardian(actor: Actor, input: LinkGuardian): Promise<GuardianLinkView> {
    return this.uow.run(async (tx) => {
      if (await this.reverificationRequired(actor.personId, actor.deviceId, tx)) throw new DriverError('reverification_required');
      let ward: { wardPersonId: string | null; wardParticipantId: string | null; phoneE164: string; phoneHash: string };
      if (input.wardPhone) {
        const { e164, hash } = this.phone(input.wardPhone);
        let person = await this.repo.findPersonByPhoneHash(hash, tx);
        if (!person) {
          const now = this.clock.now();
          person = await this.repo.createPersonWithIdentity({ locale: 'ar-IQ', sharedFamilyPhone: false, phoneE164: e164, phoneHash: hash, name: null, now }, tx);
          await this.events.emit(tx, { actorId: actor.personId, type: 'person.registered', occurredAt: now, payload: { personId: person.id, via: 'guardian_link' } }, { name: 'person', id: person.id });
        }
        ward = { wardPersonId: person.id, wardParticipantId: null, phoneE164: e164, phoneHash: hash };
      } else {
        // Participant phones live in the vault by hash only; resolving them is the orders module's
        // job (Step 4). Until then a participant ward needs the ward phone too.
        throw new DriverError('invalid_input');
      }
      const link = await this.guardians.link(actor.personId, ward, tx);
      return guardianView(link);
    });
  }

  async consentGuardianLink(actor: Actor, input: z.infer<typeof ConsentGuardianLinkInput>): Promise<GuardianLinkView> {
    return this.uow.run(async (tx) => {
      const link = await this.repo.findGuardianLink(input.linkId, tx);
      if (!link || !link.wardPersonId) throw new DriverError('guardian_link_not_found');
      const wardIdentity = await this.repo.readIdentity(link.wardPersonId, tx);
      if (!wardIdentity) throw new DriverError('guardian_link_not_found');
      const active = await this.guardians.consent(link.id, wardIdentity.phoneHash, input.code, actor.personId, tx);
      return guardianView(active);
    });
  }

  async revokeGuardianLink(actor: Actor, input: z.infer<typeof RevokeGuardianLinkInput>): Promise<GuardianLinkView> {
    return this.uow.run(async (tx) => guardianView(await this.guardians.revoke(input.linkId, actor.personId, tx)));
  }

  // ───────────────────────── phone change (edge-case §7) ─────────────────────────

  /** Sends a code to both the current and the new number; nothing changes until both are entered. */
  async changePhoneStart(actor: Actor, input: ChangePhoneStart): Promise<z.infer<typeof ChangePhoneStartOutput>> {
    return this.uow.run(async (tx) => {
      const current = await this.repo.readIdentity(actor.personId, tx);
      if (!current) throw new DriverError('person_not_found');
      const next = this.phone(input.newPhone);
      if (next.hash === current.phoneHash) throw new DriverError('phone_change_same_number');
      if (await this.repo.findPersonByPhoneHash(next.hash, tx)) throw new DriverError('phone_change_taken');
      const a = await this.otp.request(current.phoneE164, current.phoneHash, 'phone_change', tx);
      await this.otp.request(next.e164, next.hash, 'phone_change', tx);
      this.phoneChanges.set(actor.personId, { newE164: next.e164, newHash: next.hash, startedAt: this.clock.now() });
      return { oldPhoneMasked: maskPhone(current.phoneE164), newPhoneMasked: next.masked, expiresAt: a.expiresAt };
    });
  }

  async changePhoneConfirm(actor: Actor, input: ChangePhoneConfirm): Promise<MeView> {
    await this.uow.run(async (tx) => {
      const pending = this.phoneChanges.get(actor.personId);
      const current = await this.repo.readIdentity(actor.personId, tx);
      if (!pending || !current) throw new DriverError('phone_change_not_started');
      await this.otp.verify(current.phoneHash, 'phone_change', input.oldCode, tx);
      await this.otp.verify(pending.newHash, 'phone_change', input.newCode, tx);
      if (await this.repo.findPersonByPhoneHash(pending.newHash, tx)) throw new DriverError('phone_change_taken');
      const now = this.clock.now();
      await this.repo.updateIdentity(actor.personId, { phoneE164: pending.newE164, phoneHash: pending.newHash }, tx);
      await this.repo.logVaultAccess({ personId: actor.personId, accessorId: actor.personId, purpose: 'phone_change', fieldsRead: ['phone_e164'], now }, tx);
      this.phoneChanges.delete(actor.personId);
      await this.events.emit(tx, { actorId: actor.personId, type: 'phone.changed', occurredAt: now, payload: { personId: actor.personId, oldPhoneMasked: maskPhone(current.phoneE164), newPhoneMasked: maskPhone(pending.newE164) } }, { name: 'person', id: actor.personId });
    });
    return this.me(actor);
  }

  // ───────────────────────── lost SIM (edge-case §7, stub) ─────────────────────────

  /**
   * Support records the claim; completion (ID match, number move) is manual in M2. Emits
   * `identity.lost_sim_claim` so the Console can list open claims.
   */
  async recordLostSimClaim(actor: Actor, input: { personId: string; newPhone: string; note?: string }): Promise<{ claimId: string }> {
    return this.uow.run(async (tx) => {
      if (!(await this.hasRole(actor.personId, 'support')) && !(await this.hasRole(actor.personId, 'admin'))) throw new DriverError('forbidden');
      const person = await this.repo.findPersonById(input.personId, tx);
      if (!person) throw new DriverError('person_not_found');
      const next = this.phone(input.newPhone);
      const now = this.clock.now();
      const ev = await this.events.emit(tx, { actorId: actor.personId, type: 'identity.lost_sim_claim', occurredAt: now, payload: { personId: input.personId, newPhoneMasked: next.masked, note: input.note ?? null, status: 'manual' } }, { name: 'person', id: input.personId });
      return { claimId: ev.id };
    });
  }

  // ───────────────────────── dev ─────────────────────────

  async devLastOtp(phone: string): Promise<{ phoneMasked: string; code: string | null }> {
    const { e164, masked } = this.phone(phone);
    const code = this.otp.devWhatsAppCode(e164) ?? (this.sms instanceof DevSmsProvider ? this.sms.lastCodeFor(e164) : null);
    return { phoneMasked: masked, code };
  }
}

function roleGrant(r: RoleRecord): RoleGrant {
  return { kind: r.kind, orgId: r.orgId, frozen: r.frozenAt !== null };
}

/** "زينب علي حسين" → "زينب" (first whitespace-separated token). */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name.trim();
}

/** First-name tokens that never stand alone: "عبد الله", "أبو علي". */
const COMPOUND_FIRST = new Set(['عبد', 'ابو', 'أبو', 'ام', 'أم']);

/**
 * Staff display name (K-01): the first name and the initial of the next name — the father's name in
 * Iraqi usage — with a dot: "حيدر كاظم جواد" → "حيدر ك."; compound first names stay whole
 * ("عبد الله حسن" → "عبد الله ح."), and a leading "ال" is skipped for the initial
 * ("سيف الربيعي" → "سيف ر."). A single name is shown as is.
 */
export function shortDisplayName(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  const firstLen = tokens.length > 1 && COMPOUND_FIRST.has(tokens[0]!) ? 2 : 1;
  const first = tokens.slice(0, firstLen).join(' ');
  const next = tokens[firstLen];
  if (!next) return first;
  const letters = [...(next.startsWith('ال') && next.length > 3 ? next.slice(2) : next)];
  return `${first} ${letters[0]}.`;
}

/** The trusted people (w9): the stored list, or the emergency contact alone for rows saved before it existed. */
function trustedOf(identity: Pick<IdentityRecord, 'trustedContacts' | 'emergencyContact'>): EmergencyContactRecord[] {
  if (identity.trustedContacts) return identity.trustedContacts.slice(0, TRUSTED_CONTACTS_MAX);
  return identity.emergencyContact ? [identity.emergencyContact] : [];
}

function maskedContact(c: EmergencyContactRecord): { name: string; phoneMasked: string; relation: EmergencyRelation | null } {
  return { name: c.name, phoneMasked: maskPhone(c.phoneE164), relation: c.relation ?? null };
}
