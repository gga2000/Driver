import { DriverError, SECOND_STEP_ROLE_KINDS, STAFF_TOTP_RULES, type Actor, type SecondStep } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { IdentityEventEmitter } from './events.adapter.js';
import type { IdentityRepository, StaffTotpRecord } from './identity.repository.js';
import {
  findRecoveryHash,
  hashRecoveryCode,
  matchTotp,
  newRecoveryCodes,
  newTotpSecret,
  openSecret,
  otpauthUri,
  sealSecret,
  totpCode,
  totpStep,
  type StaffTotpConfig,
} from './totp.js';

/** The account name the authenticator app shows under "Driver". */
const APP_ACCOUNT = 'Console';

/** How a code was accepted. */
type Passed = { via: 'code'; step: number } | { via: 'recovery'; left: number };

/**
 * Admin and finance sign-in's second step (docs/api/staff-totp.md). After the SMS code, a session of a
 * person holding admin or finance owes one authenticator code: those roles count only once it passed
 * (`secondStepAt` on the session). The first time, the person sets the app up (`enrol` → `confirm`)
 * and gets 8 recovery codes once.
 *
 * Every code (and recovery code) first claims one of 5 tries with a single conditional UPDATE committed
 * on its own, like the SMS code (audit SEC-01), so parallel guesses can never all be compared; the 5th
 * wrong one in a row locks the step for 15 minutes and tells the admins (`staff.totp_locked`, the
 * Console safety strip). A code's step is recorded when it is accepted, so it never works twice. Every
 * read of the secret or the recovery hashes writes a vault access log row first.
 */
export class StaffTotpService {
  constructor(
    private readonly repo: IdentityRepository,
    private readonly events: IdentityEventEmitter,
    private readonly clock: Clock,
    private readonly config: StaffTotpConfig,
  ) {}

  /** Whether the person holds a live admin or finance grant (the people who owe the step). */
  async required(personId: string, tx?: Tx): Promise<boolean> {
    const roles = await this.repo.rolesOf(personId, tx);
    return roles.some((r) => r.frozenAt === null && SECOND_STEP_ROLE_KINDS.includes(r.kind));
  }

  /** True when this session owes the step: the person must pass it and the session has not. */
  async pending(actor: Pick<Actor, 'personId' | 'sessionId'>, tx?: Tx): Promise<boolean> {
    if (!(await this.required(actor.personId, tx))) return false;
    const session = await this.repo.findSessionById(actor.sessionId, tx);
    return !session?.secondStepAt;
  }

  /** What this session still owes: `enrol` (no app set up yet), `code`, or null. */
  async step(actor: Pick<Actor, 'personId' | 'sessionId'>, tx?: Tx): Promise<SecondStep | null> {
    if (!(await this.pending(actor, tx))) return null;
    const state = await this.repo.staffTotpState(actor.personId, tx);
    return state?.confirmedAt ? 'code' : 'enrol';
  }

  /** A fresh secret for the app (replacing one never confirmed); refused once the app is set up. */
  async enrol(actor: Actor): Promise<{ secret: string; uri: string }> {
    await this.mustOwe(actor);
    const now = this.clock.now();
    const secret = newTotpSecret();
    const started = await this.repo.startStaffTotp(actor.personId, sealSecret(this.config.key, actor.personId, secret), now);
    if (!started) throw new DriverError('totp_already_set');
    // Showing the secret is a read of it: logged like every other.
    await this.repo.logVaultAccess({ personId: actor.personId, accessorId: actor.personId, purpose: 'staff_totp_enrol', fieldsRead: ['totp_secret'], now }, undefined, { failClosed: true });
    return { secret, uri: otpauthUri(secret, APP_ACCOUNT) };
  }

  /** The first code confirms the set-up and passes this session; the recovery codes, once. */
  async confirm(actor: Actor, code: string): Promise<{ recoveryCodes: string[] }> {
    await this.mustOwe(actor);
    const state = await this.repo.staffTotpState(actor.personId);
    if (!state) throw new DriverError('totp_invalid');
    if (state.confirmedAt) throw new DriverError('totp_already_set');
    const passed = await this.check(actor.personId, actor.personId, code, { purpose: 'staff_totp_enrol', recovery: false, consume: false });
    if (passed.via !== 'code') throw new DriverError('totp_invalid');
    const recoveryCodes = newRecoveryCodes();
    const now = this.clock.now();
    if (!(await this.repo.confirmStaffTotp(actor.personId, { step: passed.step, recoveryHashes: recoveryCodes.map(hashRecoveryCode), now }))) throw new DriverError('totp_already_set');
    await this.pass(actor, now, 'enrolled');
    return { recoveryCodes };
  }

  /** A code from the app, or one recovery code, passes this session. */
  async verify(actor: Actor, code: string): Promise<{ recoveryLeft: number | null }> {
    await this.mustOwe(actor);
    const state = await this.repo.staffTotpState(actor.personId);
    if (!state?.confirmedAt) throw new DriverError('totp_invalid');
    const passed = await this.check(actor.personId, actor.personId, code, { purpose: 'staff_totp_verify', recovery: true, consume: true });
    const now = this.clock.now();
    await this.pass(actor, now, passed.via === 'recovery' ? 'recovery' : 'code');
    return { recoveryLeft: passed.via === 'recovery' ? passed.left : null };
  }

  /**
   * An admin's own fresh code, asked before he resets someone else's authenticator: same tries, lock
   * and one-use rule as signing in; recovery codes are not accepted here.
   */
  async confirmOwnCode(actor: Actor, code: string): Promise<void> {
    const state = await this.repo.staffTotpState(actor.personId);
    if (!state?.confirmedAt) throw new DriverError('totp_required');
    await this.check(actor.personId, actor.personId, code, { purpose: 'staff_totp_reset_confirm', recovery: false, consume: true });
  }

  /** Clears the person's set-up (inside the caller's unit of work); he sets the app up again next sign-in. */
  async clear(actor: Actor, personId: string, tx: Tx): Promise<boolean> {
    if (personId === actor.personId) throw new DriverError('forbidden');
    const removed = await this.repo.deleteStaffTotp(personId, tx);
    await this.events.emit(tx, { actorId: actor.personId, type: 'staff.totp_reset', occurredAt: this.clock.now(), payload: { personId, resetBy: actor.personId, hadApp: removed } }, { name: 'person', id: personId });
    return removed;
  }

  /** Demo mode only: the code the caller's own app would show now (the next one when this one is used). */
  async demoCode(actor: Actor): Promise<{ code: string | null }> {
    if (!this.config.demo) return { code: null };
    if (!(await this.required(actor.personId))) return { code: null };
    const now = this.clock.now();
    const row = await this.repo.readStaffTotp(actor.personId, { accessorId: actor.personId, purpose: 'staff_totp_demo', fieldsRead: ['totp_secret'], now });
    if (!row) return { code: null };
    const step = totpStep(now);
    const usable = row.lastStep !== null && row.lastStep >= step ? row.lastStep + 1 : step;
    if (usable > step + STAFF_TOTP_RULES.window) return { code: null };
    return { code: totpCode(openSecret(this.config.key, actor.personId, row.secretEnc), usable) };
  }

  /** Staff locked out right now, with when it ends (the Console safety strip). */
  async locks(): Promise<Array<{ personId: string; lockedAt: Date; lockedUntil: Date }>> {
    const rows = await this.repo.lockedStaffTotps(this.clock.now());
    return rows.filter((r) => r.lockedUntil).map((r) => ({ personId: r.personId, lockedUntil: r.lockedUntil!, lockedAt: new Date(r.lockedUntil!.getTime() - STAFF_TOTP_RULES.lockMinutes * 60_000) }));
  }

  // ───────────────────────── internals ─────────────────────────

  private async mustOwe(actor: Actor): Promise<void> {
    if (!(await this.required(actor.personId))) throw new DriverError('forbidden');
  }

  /** Marks the session as past the step (identity's auth cache drops it on every API machine). */
  private async pass(actor: Actor, now: Date, how: 'enrolled' | 'code' | 'recovery'): Promise<void> {
    await this.repo.updateSession(actor.sessionId, { secondStepAt: now });
    await this.events.emit(undefined, { actorId: actor.personId, type: 'staff.totp_passed', occurredAt: now, payload: { personId: actor.personId, sessionId: actor.sessionId, how } }, { name: 'person', id: actor.personId });
  }

  /**
   * One try: claimed first (committed on its own), then the secret read (logged) and compared. A code
   * that matches records its step (`consume`) so it is never accepted again; a recovery code is used up.
   * Wrong: `totp_invalid`, or `totp_locked` on the try that uses up the 5.
   */
  private async check(personId: string, accessorId: string, given: string, opts: { purpose: string; recovery: boolean; consume: boolean }): Promise<Passed> {
    const now = this.clock.now();
    const claim = await this.repo.claimStaffTotpAttempt(personId, { now, maxTries: STAFF_TOTP_RULES.maxTries });
    if (!claim) {
      const state = await this.repo.staffTotpState(personId);
      if (!state) throw new DriverError('totp_invalid');
      // Locked, or the tries ran out without the lock landing (a crash in between): lock now.
      const lock = state.lockedUntil && state.lockedUntil > now ? { lockedUntil: state.lockedUntil, newly: false } : await this.lock(personId, now);
      throw this.locked(now, lock.lockedUntil ?? now);
    }
    const code = given.trim();
    const digits = /^\d{6}$/.test(code);
    const row = await this.repo.readStaffTotp(personId, { accessorId, purpose: opts.purpose, fieldsRead: digits || !opts.recovery ? ['totp_secret'] : ['totp_recovery_hashes'], now });
    if (!row) throw new DriverError('totp_invalid');
    const passed = digits ? await this.byCode(row, code, now, opts.consume) : opts.recovery ? await this.byRecovery(row, code, now) : null;
    if (passed) return passed;
    if (claim.attempts >= STAFF_TOTP_RULES.maxTries) {
      const lock = await this.lock(personId, now);
      throw this.locked(now, lock.lockedUntil ?? now);
    }
    throw new DriverError('totp_invalid');
  }

  private async byCode(row: StaffTotpRecord, code: string, now: Date, consume: boolean): Promise<Passed | null> {
    const step = matchTotp(openSecret(this.config.key, row.personId, row.secretEnc), code, now, row.lastStep);
    if (step === null) return null;
    // `consume` false: the set-up's first code; `confirmStaffTotp` records its step with the confirmation.
    if (consume && !(await this.repo.useStaffTotpStep(row.personId, step))) return null;
    return { via: 'code', step };
  }

  private async byRecovery(row: StaffTotpRecord, code: string, now: Date): Promise<Passed | null> {
    const hash = findRecoveryHash(code, row.recoveryHashes);
    if (!hash) return null;
    const used = await this.repo.useStaffTotpRecovery(row.personId, hash);
    if (!used) return null;
    // Every recovery code used is on the record (who, when, how many are left).
    await this.events.emit(undefined, { actorId: row.personId, type: 'staff.totp_recovery_used', occurredAt: now, payload: { personId: row.personId, left: used.left } }, { name: 'person', id: row.personId });
    return { via: 'recovery', left: used.left };
  }

  /** Sets the lock; the first to set it tells every admin (push, and the row on the safety strip). */
  private async lock(personId: string, now: Date): Promise<{ lockedUntil: Date | null; newly: boolean }> {
    const until = new Date(now.getTime() + STAFF_TOTP_RULES.lockMinutes * 60_000);
    const lock = await this.repo.lockStaffTotp(personId, { now, until, maxTries: STAFF_TOTP_RULES.maxTries });
    if (lock.newly) {
      const { people } = await this.repo.peopleWithRoles(['admin'], { limit: 50 });
      const adminIds = people.filter(({ roles }) => roles.some((r) => r.kind === 'admin' && r.frozenAt === null)).map(({ person }) => person.id);
      await this.events.emit(undefined, { actorId: personId, type: 'staff.totp_locked', occurredAt: now, payload: { personId, lockedUntil: until.toISOString(), minutes: STAFF_TOTP_RULES.lockMinutes, adminIds } }, { name: 'person', id: personId });
    }
    return lock;
  }

  private locked(now: Date, until: Date): DriverError {
    return new DriverError('totp_locked', { retryAfterSec: Math.max(0, Math.ceil((until.getTime() - now.getTime()) / 1000)), params: { minutes: STAFF_TOTP_RULES.lockMinutes } });
  }
}
