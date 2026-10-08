import { DriverError, type GuardianLinkView } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { IdentityEventEmitter } from './events.adapter.js';
import type { GuardianLinkRecord, IdentityRepository, OtpRecord } from './identity.repository.js';
import type { OtpService } from './otp.service.js';

export const GUARDIAN_STATE_AR: Record<GuardianLinkRecord['state'], string> = {
  pending: 'بانتظار الموافقة',
  active: 'مفعّل',
  revoked: 'ملغى',
};

export function guardianView(link: GuardianLinkRecord): GuardianLinkView {
  return {
    id: link.id,
    guardianId: link.guardianId,
    wardPersonId: link.wardPersonId,
    wardParticipantId: link.wardParticipantId,
    state: link.state,
    state_ar: GUARDIAN_STATE_AR[link.state],
  };
}

/**
 * Guardian → ward links (domain §12, edge-case §7). A link is `pending` until the ward's phone
 * confirms by OTP (purpose `guardian_consent`); only then does the guardian get the `guardian`
 * role. A declared shared family phone can never be a guardian.
 */
export class GuardianService {
  constructor(
    private readonly repo: IdentityRepository,
    private readonly otp: OtpService,
    private readonly events: IdentityEventEmitter,
    private readonly clock: Clock,
  ) {}

  /** Creates (or returns) the pending link and sends the consent code to the ward's phone. */
  async link(
    guardianId: string,
    ward: { wardPersonId: string | null; wardParticipantId: string | null; phoneE164: string; phoneHash: string },
    tx?: Tx,
  ): Promise<GuardianLinkRecord> {
    const guardian = await this.repo.findPersonById(guardianId, tx);
    if (!guardian) throw new DriverError('person_not_found');
    if (guardian.sharedFamilyPhone) throw new DriverError('shared_phone_role_forbidden');
    if (ward.wardPersonId === guardianId) throw new DriverError('guardian_self_link');
    const now = this.clock.now();
    const key = { wardPersonId: ward.wardPersonId, wardParticipantId: ward.wardParticipantId };
    const link = (await this.repo.findPendingGuardianLink(guardianId, key, tx)) ?? (await this.repo.createGuardianLink({ guardianId, ...key, now }, tx));
    await this.otp.request(ward.phoneE164, ward.phoneHash, 'guardian_consent', tx, undefined, { actorId: guardianId });
    return link;
  }

  /**
   * The ward (or whoever holds the ward's phone) entered the consent code, already checked by
   * `OtpService.check` outside the transaction; the link becomes active and the code is used up.
   */
  async consent(linkId: string, challenge: OtpRecord, actorId: string, tx?: Tx): Promise<GuardianLinkRecord> {
    const link = await this.repo.findGuardianLink(linkId, tx);
    if (!link) throw new DriverError('guardian_link_not_found');
    if (link.state !== 'pending') throw new DriverError('guardian_link_not_pending');
    await this.otp.consume(challenge, tx);
    const now = this.clock.now();
    const active = await this.repo.updateGuardianLink(link.id, { state: 'active', consentedAt: now }, tx);
    const grant = await this.repo.upsertRole({ personId: link.guardianId, kind: 'guardian', orgId: null, grantedBy: actorId, now }, tx);
    if (grant.created) {
      await this.events.emit(tx, { actorId, type: 'role.granted', occurredAt: now, payload: { personId: link.guardianId, kind: 'guardian', orgId: null, via: 'guardian.linked' } }, { name: 'person', id: link.guardianId });
    }
    await this.events.emit(
      tx,
      { actorId, type: 'guardian.linked', occurredAt: now, payload: { linkId: link.id, guardianId: link.guardianId, wardPersonId: link.wardPersonId, wardParticipantId: link.wardParticipantId } },
      { name: 'guardian_link', id: link.id },
    );
    return active;
  }

  /** Either side may revoke. When the guardian has no other active link the guardian role goes too. */
  async revoke(linkId: string, actorId: string, tx?: Tx): Promise<GuardianLinkRecord> {
    const link = await this.repo.findGuardianLink(linkId, tx);
    if (!link) throw new DriverError('guardian_link_not_found');
    if (actorId !== link.guardianId && actorId !== link.wardPersonId) {
      const actorRoles = await this.repo.rolesOf(actorId, tx);
      if (!actorRoles.some((r) => r.kind === 'admin' || r.kind === 'support')) throw new DriverError('forbidden');
    }
    if (link.state === 'revoked') return link;
    const now = this.clock.now();
    const wasActive = link.state === 'active';
    const revoked = await this.repo.updateGuardianLink(link.id, { state: 'revoked', revokedAt: now }, tx);
    if (wasActive) {
      await this.events.emit(
        tx,
        { actorId, type: 'guardian.revoked', occurredAt: now, payload: { linkId: link.id, guardianId: link.guardianId, wardPersonId: link.wardPersonId, wardParticipantId: link.wardParticipantId } },
        { name: 'guardian_link', id: link.id },
      );
      const remaining = (await this.repo.guardianLinksOf(link.guardianId, tx)).filter((l) => l.state === 'active');
      if (remaining.length === 0) {
        const role = (await this.repo.rolesOf(link.guardianId, tx)).find((r) => r.kind === 'guardian' && r.orgId === null);
        if (role) {
          await this.repo.revokeRole(role.id, now, tx);
          await this.events.emit(tx, { actorId, type: 'role.revoked', occurredAt: now, payload: { personId: link.guardianId, kind: 'guardian', orgId: null, via: 'guardian.revoked' } }, { name: 'person', id: link.guardianId });
        }
      }
    }
    return revoked;
  }
}
