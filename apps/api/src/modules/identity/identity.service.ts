import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  FREEZABLE_ROLES,
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
  type RequestOtpInput,
  type RequestOtpOutput,
  type RevokeGuardianLinkInput,
  type RevokeRoleInput,
  type RoleGrant,
  type RoleKind,
  type SessionClaims,
  type TokenPair,
  type VerifyOtpInput,
  type VerifyOtpOutput,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { IDENTITY_EVENTS, type IdentityEventEmitter } from './events.adapter.js';
import { GuardianService, guardianView } from './guardian.service.js';
import { IDENTITY_REPOSITORY, type IdentityRepository, type PersonRecord, type RoleRecord } from './identity.repository.js';
import { OtpService } from './otp.service.js';
import { hashPhone, maskPhone, normalizeIraqiPhone } from './phone.js';
import { SessionService } from './session.service.js';
import { FakeSmsProvider } from './sms/fake.provider.js';
import { SMS_PROVIDER, type SmsProvider } from './sms/provider.js';

export const PHONE_PEPPER = Symbol('PHONE_PEPPER');

type RequestOtp = z.infer<typeof RequestOtpInput>;
type VerifyOtp = z.infer<typeof VerifyOtpInput>;
type GrantRole = z.infer<typeof GrantRoleInput>;
type LinkGuardian = z.infer<typeof LinkGuardianInput>;
type ChangePhoneStart = z.infer<typeof ChangePhoneStartInput>;
type ChangePhoneConfirm = z.infer<typeof ChangePhoneConfirmInput>;

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
  ) {
    this.otp = new OtpService(repo, sms, clock, pepper);
    this.sessions = sessions ?? new SessionService(repo, clock, { keys: [{ kid: 'k1', secret: pepper }], activeKid: 'k1' });
    this.guardians = new GuardianService(repo, this.otp, events, clock);
  }

  // ───────────────────────── phone helpers ─────────────────────────

  private phone(raw: string): { e164: string; hash: string; masked: string } {
    const e164 = normalizeIraqiPhone(raw);
    return { e164, hash: hashPhone(e164, this.pepper), masked: maskPhone(e164) };
  }

  // ───────────────────────── OTP + login ─────────────────────────

  async requestOtp(input: RequestOtp): Promise<z.infer<typeof RequestOtpOutput>> {
    const purpose: OtpPurpose = input.purpose ?? 'login';
    const { e164, hash, masked } = this.phone(input.phone);
    return this.uow.run(async (tx) => {
      const res = await this.otp.request(e164, hash, purpose, tx);
      return { phoneMasked: masked, expiresAt: res.expiresAt, resendAfterSec: res.resendAfterSec };
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
    });
  }

  verifyAccessToken(token: string): Promise<SessionClaims> {
    return this.sessions.verifyAccessToken(token);
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
      await this.repo.logVaultAccess({ personId, accessorId, purpose: reason, fieldsRead: ['name', 'phone_e164'], now: this.clock.now() }, tx);
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
      };
    });
  }

  /** Looks a person up by phone without creating one. Used by orgs/households and support. */
  async personIdByPhone(rawPhone: string): Promise<string | null> {
    const { hash } = this.phone(rawPhone);
    const p = await this.repo.findPersonByPhoneHash(hash);
    return p?.id ?? null;
  }

  async setName(actor: Actor, name: string): Promise<void> {
    await this.uow.run(async (tx) => {
      await this.repo.updateIdentity(actor.personId, { name }, tx);
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
    const code = this.sms instanceof FakeSmsProvider ? this.sms.lastCodeFor(e164) : null;
    return { phoneMasked: masked, code };
  }
}

function roleGrant(r: RoleRecord): RoleGrant {
  return { kind: r.kind, orgId: r.orgId, frozen: r.frozenAt !== null };
}
