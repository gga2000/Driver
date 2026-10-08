import { Logger } from '@nestjs/common';
import { DriverError, type DeletionBlocker, type DeletionCheckView, type DeletionConfirmOutput, type DeletionStartOutput } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';
import type { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { ErasureNotReady, type ErasureRegistry } from './deletion.js';
import type { IdentityEventEmitter } from './events.adapter.js';
import type { IdentityRepository } from './identity.repository.js';
import type { OtpService } from './otp.service.js';
import { maskPhone } from './phone.js';

/** How many deleted people one pass of the erasure job takes on. */
export const ERASURE_BATCH = 50;

/**
 * W7 account deletion, REL-01 (docs/api/account-deletion.md). A customer deletes his own account from
 * حسابي: `check` says what stands in the way, `start` sends a code to his own number, `confirm` checks
 * the code and the blockers again, closes the account in one transaction (identity's own rows), then
 * runs every module's erasure step. Steps that fail or can't run yet are retried by `AccountErasureJob`
 * (`resume`) until all have finished and `people.erased_at` is set.
 *
 * Only plain customer accounts delete themselves. Anyone who works or worked with us (driver, courier,
 * restaurant, staff) is closed by support, whose records have their own retention.
 */
export class AccountDeletionService {
  private readonly log = new Logger('AccountDeletion');

  constructor(
    private readonly repo: IdentityRepository,
    private readonly otp: OtpService,
    private readonly events: IdentityEventEmitter,
    private readonly clock: Clock,
    private readonly uow: UnitOfWork,
    private readonly registry: ErasureRegistry,
    private readonly enabled: boolean,
  ) {}

  async check(personId: string): Promise<DeletionCheckView> {
    const [blockers, points] = await Promise.all([this.blockers(personId), this.points(personId)]);
    return { available: this.enabled, blockers, points };
  }

  async start(personId: string): Promise<DeletionStartOutput> {
    await this.assertMayDelete(personId);
    return this.uow.run(async (tx) => {
      const idn = await this.repo.readIdentity(personId, tx);
      if (!idn) throw new DriverError('person_not_found');
      await this.repo.logVaultAccess({ personId, accessorId: personId, purpose: 'account_delete', fieldsRead: ['phone_e164'], now: this.clock.now() }, tx);
      const sent = await this.otp.request(idn.phoneE164, idn.phoneHash, 'account_delete', tx);
      return { phoneMasked: maskPhone(idn.phoneE164), expiresAt: sent.expiresAt, resendAfterSec: sent.resendAfterSec };
    });
  }

  async confirm(personId: string, code: string): Promise<DeletionConfirmOutput> {
    await this.assertMayDelete(personId);
    const now = this.clock.now();
    const idn = await this.repo.readIdentity(personId);
    if (!idn) throw new DriverError('person_not_found');
    // Each guess spends one of the code's attempts on its own (SEC-01); the code is used up only with
    // the account's closing, in one transaction.
    const challenge = await this.otp.check(idn.phoneHash, 'account_delete', code);
    await this.uow.run(async (tx) => {
      await this.otp.consume(challenge, tx);
      if (!(await this.repo.closeAccount(personId, now, tx))) throw new DriverError('person_not_found');
      await this.events.emit(tx, { actorId: personId, type: 'person.deleted', occurredAt: now, payload: { personId } }, { name: 'person', id: personId });
    });
    // The account is closed; what each module keeps about him goes now, or on the job's next pass.
    await this.erase(personId, now);
    return { deletedAt: now };
  }

  /** One pass of the erasure job: deleted people some step still has to erase. Returns how many finished. */
  async resume(limit = ERASURE_BATCH): Promise<number> {
    let done = 0;
    for (const p of await this.repo.deletedNotErased(limit)) if (await this.erase(p.id, p.deletedAt)) done += 1;
    return done;
  }

  /**
   * Runs every step for a deleted person; marks him erased once all succeed. A step that throws is
   * logged and left for the next pass (steps are idempotent, so the ones that worked just run again).
   */
  async erase(personId: string, deletedAt: Date): Promise<boolean> {
    let complete = true;
    for (const step of this.registry.steps()) {
      if (!step.erase) continue;
      try {
        await step.erase(personId, deletedAt);
      } catch (err) {
        complete = false;
        if (err instanceof ErasureNotReady) this.log.log(`${step.owner}: ${err.message} (person ${personId})`);
        else this.log.error(`${step.owner} erasure failed for person ${personId}: ${(err as Error).message}`, (err as Error).stack);
      }
    }
    if (complete) await this.repo.markErased(personId, this.clock.now());
    return complete;
  }

  private async assertMayDelete(personId: string): Promise<void> {
    if (!this.enabled) throw new DriverError('account_deletion_off');
    if ((await this.blockers(personId)).length > 0) throw new DriverError('account_delete_blocked');
  }

  private async blockers(personId: string): Promise<DeletionBlocker[]> {
    const kinds = await this.repo.roleKindsEver(personId);
    const own: DeletionBlocker[] = kinds.some((k) => k !== 'customer') ? [{ kind: 'work_role' }] : [];
    const fromSteps = await Promise.all(this.registry.steps().map((s) => (s.blockers ? s.blockers(personId) : Promise.resolve([]))));
    return [...own, ...fromSteps.flat()];
  }

  private async points(personId: string): Promise<number> {
    const all = await Promise.all(this.registry.steps().map((s): Promise<{ points?: number }> => (s.forfeits ? s.forfeits(personId) : Promise.resolve({}))));
    return all.reduce((sum: number, f) => sum + (f.points ?? 0), 0);
  }
}
