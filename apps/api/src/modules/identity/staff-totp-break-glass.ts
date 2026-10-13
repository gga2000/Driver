import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx, UnitOfWork } from '../../shared/db/unit-of-work.js';
import type { IdentityEventEmitter } from './events.adapter.js';
import { PrismaIdentityRepository } from './identity.repository.js';
import { hashPhone, maskPhone, normalizeIraqiPhone } from './phone.js';
import { phonePepperFromEnv } from './session.service.js';

/** Who the break-glass run is recorded as (events, the vault log and the Console audit trail). */
export const BREAK_GLASS_ACTOR = 'system:break_glass';

export interface StaffTotpBreakGlassInput {
  /** The locked-out staff member's phone, any Iraqi format. */
  phone: string;
  /** Who ran it (the person with Fly access), and why: both go in the audit trail. */
  operator: string;
  reason: string;
  /** False: only look (the dry run); true: clear it. */
  apply: boolean;
}

export interface StaffTotpBreakGlassResult {
  found: boolean;
  phoneMasked: string;
  personId: string | null;
  hadApp: boolean;
  ended: number;
  applied: boolean;
}

export interface StaffTotpBreakGlassDeps {
  prisma: PrismaService;
  uow: UnitOfWork;
  events: IdentityEventEmitter;
  /** Writes the Console audit row in the same transaction (the controls module owns that table). */
  audit: (row: { personId: string; summaryAr: string; detail: Record<string, unknown>; at: Date }, tx: Tx) => Promise<unknown>;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

/**
 * Break glass (docs/api/staff-totp.md): when no admin can reset a staff member's authenticator in the
 * Console (the last admin lost his phone and his recovery codes), someone with server access clears it
 * with a one-off script. Same effect as the Console reset: the set-up is deleted, every session ends,
 * the person is notified (`staff.totp_reset`, through the outbox the running API delivers), and the
 * Console audit trail gets a row naming the operator and the reason. Never reachable from any app.
 */
export async function staffTotpBreakGlass(deps: StaffTotpBreakGlassDeps, input: StaffTotpBreakGlassInput): Promise<StaffTotpBreakGlassResult> {
  const operator = input.operator.trim();
  const reason = input.reason.trim();
  if (operator.length < 2 || reason.length < 5) throw new Error('break glass needs --operator (who runs it) and --reason (why)');
  const e164 = normalizeIraqiPhone(input.phone);
  const phoneMasked = maskPhone(e164);
  const repo = new PrismaIdentityRepository(deps.prisma);
  const now = (deps.now ?? (() => new Date()))();
  const person = await repo.findPersonByPhoneHash(hashPhone(e164, phonePepperFromEnv(deps.env)));
  if (!person) return { found: false, phoneMasked, personId: null, hadApp: false, ended: 0, applied: false };
  if (!input.apply) {
    const state = await repo.staffTotpState(person.id);
    return { found: true, phoneMasked, personId: person.id, hadApp: Boolean(state), ended: 0, applied: false };
  }
  return deps.uow.run(async (tx) => {
    await repo.logVaultAccess({ personId: person.id, accessorId: BREAK_GLASS_ACTOR, purpose: 'staff_totp_break_glass', fieldsRead: ['totp_secret', 'recovery_hashes'], now }, tx, { failClosed: true });
    const hadApp = await repo.deleteStaffTotp(person.id, tx);
    const sessionIds = await repo.revokeSessionsOf(person.id, now, tx);
    for (const sessionId of sessionIds) {
      await deps.events.emit(tx, { actorId: BREAK_GLASS_ACTOR, type: 'session.signed_out', occurredAt: now, payload: { personId: person.id, sessionId } }, { name: 'person', id: person.id });
    }
    await deps.events.emit(tx, { actorId: BREAK_GLASS_ACTOR, type: 'session.all_ended', occurredAt: now, payload: { personId: person.id, endedBy: BREAK_GLASS_ACTOR, reason: 'admin', sessions: sessionIds.length } }, { name: 'person', id: person.id });
    await deps.events.emit(tx, { actorId: BREAK_GLASS_ACTOR, type: 'staff.totp_reset', occurredAt: now, payload: { personId: person.id, resetBy: null, hadApp, breakGlass: true } }, { name: 'person', id: person.id });
    await deps.audit({ personId: person.id, summaryAr: `صفّر تطبيق المصادقة من السيرفر (طوارئ): ${operator}`, detail: { breakGlass: true, operator, reason, hadApp, ended: sessionIds.length }, at: now }, tx);
    return { found: true, phoneMasked, personId: person.id, hadApp, ended: sessionIds.length, applied: true };
  });
}
