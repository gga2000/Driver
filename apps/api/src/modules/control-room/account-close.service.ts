import { Inject, Injectable, Logger } from '@nestjs/common';
import { DriverError, type AccountCloseBlocker, type AccountClosePort, type AccountCloseView, type Actor, type CloseAccountInput, type CloseAccountOutput } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { afterCommit, UnitOfWork } from '../../shared/db/unit-of-work.js';
import { AuditLogService } from '../controls/index.js';
import { IdentityService } from '../identity/index.js';
import { Accounts, LedgerService } from '../ledger/index.js';
import { NotifyService } from '../notify/index.js';
import { closedNow, OrgsService } from '../orgs/index.js';
import { BLOB_STORE, type BlobStore } from '../places/index.js';
import { DeparturesService } from '../routes/index.js';
import { SupportService } from '../support/index.js';
import { TripsService } from '../trips/index.js';

/**
 * Console › close a partner's or merchant's account (docs/api/account-close.md), admin only. Owns no
 * tables: it asks the owning modules what stands in the way (cash he holds, a job he is on, money not
 * settled, a store only he owns still taking orders), then in one transaction checks that again, has
 * identity close the account (vault rows, sessions, roles; each session announced as signed out), has
 * notify drop every push token of his, writes the audit row and resolves the deletion case. His
 * document, selfie and photo files are deleted once that has committed. The ledger, trips, departures
 * and documents' status rows stay, under his opaque id.
 */
@Injectable()
export class AccountCloseService implements AccountClosePort {
  private readonly log = new Logger('AccountClose');

  constructor(
    private readonly identity: IdentityService,
    private readonly ledger: LedgerService,
    private readonly trips: TripsService,
    private readonly departures: DeparturesService,
    private readonly support: SupportService,
    private readonly orgs: OrgsService,
    private readonly notify: NotifyService,
    private readonly audits: AuditLogService,
    private readonly uow: UnitOfWork,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async check(_actor: Actor, input: { personId: string }): Promise<AccountCloseView> {
    const state = await this.identity.accountCloseState(input.personId);
    const blockers = state.closable && !state.closedAt ? await this.blockers(input.personId) : [];
    return { personId: input.personId, closable: state.closable, closedAt: state.closedAt, blockers };
  }

  async close(actor: Actor, input: CloseAccountInput): Promise<CloseAccountOutput> {
    if (input.personId === actor.personId) throw new DriverError('forbidden');
    const state = await this.identity.accountCloseState(input.personId);
    if (!state.closable) throw new DriverError('account_close_not_work');
    if (state.closedAt) return { personId: input.personId, closable: true, closedAt: state.closedAt, blockers: [], filesRemoved: 0 };
    if ((await this.blockers(input.personId)).length > 0) throw new DriverError('account_close_blocked');
    if (input.ticketId && !(await this.support.deletionCaseOpen(input.ticketId, input.personId))) throw new DriverError('invalid_input');
    const done = await this.uow.run(async (tx) => {
      // Checked again inside the transaction, right before anything is erased (his roles are still live).
      if ((await this.blockers(input.personId)).length > 0) throw new DriverError('account_close_blocked');
      // The refs are read before identity deletes the vault rows that hold them.
      const refs = await this.identity.storedFileRefs(input.personId, actor.personId);
      // Identity locks the person's row, so two admins pressing at once close him once.
      if (!(await this.identity.closeAccount(input.personId, actor.personId))) return null;
      await this.notify.removePersonTokens(input.personId, tx);
      const now = this.clock.now();
      await this.audits.record(
        {
          cityId: null,
          actorId: actor.personId,
          action: 'account.close',
          subjectKind: 'person',
          subjectId: input.personId,
          summaryAr: `سكّر حساب شريك وحذف بياناته: ${input.note}`,
          detail: { roles: state.roles, filesRemoved: refs.length, ticketId: input.ticketId ?? null },
        },
        tx,
      );
      if (input.ticketId) await this.support.resolveDeletion(actor, { ticketId: input.ticketId, personId: input.personId, resolution: input.note });
      // The bytes go only once the close has committed: a rollback leaves him whole, files included.
      afterCommit(tx, () => this.removeFiles(input.personId, refs));
      return { closedAt: now, filesRemoved: refs.length };
    });
    if (!done) {
      // Another admin closed it a moment ago; report what is there now.
      const now = await this.identity.accountCloseState(input.personId);
      return { personId: input.personId, closable: true, closedAt: now.closedAt, blockers: [], filesRemoved: 0 };
    }
    this.log.log(`account ${input.personId} closed by ${actor.personId} (${done.filesRemoved} files)`);
    return { personId: input.personId, closable: true, closedAt: done.closedAt, blockers: [], filesRemoved: done.filesRemoved };
  }

  /** After the commit; a file that fails to go is logged (nothing points at it any more). */
  private async removeFiles(personId: string, refs: readonly string[]): Promise<void> {
    for (const ref of refs) {
      try {
        await this.blobs.remove(ref);
      } catch (err) {
        this.log.error(`account ${personId}: stored file not removed (${(err as Error).message})`);
      }
    }
  }

  /** What stands in the way, each with its count or amount. */
  private async blockers(personId: string): Promise<AccountCloseBlocker[]> {
    const out: AccountCloseBlocker[] = [];
    const [cash, earnings, wallet, trips, departures, stores] = await Promise.all([
      this.ledger.balance(Accounts.cash(personId)),
      this.ledger.balance(Accounts.driver(personId)),
      this.ledger.balance(Accounts.customer(personId)),
      this.trips.forDriver(personId),
      this.departures.openForDriver(personId),
      this.identity.scopedOrgs(personId, ['merchant_owner']),
    ]);
    if (cash.amount < 0) out.push({ kind: 'cash_held', amountIqd: -cash.amount });
    const jobs = trips.length + departures;
    if (jobs > 0) out.push({ kind: 'open_jobs', count: jobs });
    let unsettled = Math.abs(earnings.amount);
    let soleOpen = 0;
    const now = this.clock.now();
    for (const s of stores) {
      const [cashNow, old, owners, settings] = await Promise.all([
        this.ledger.balance(Accounts.merchantCash(s.orgId)),
        this.ledger.balance(Accounts.merchant(s.orgId)),
        this.identity.orgRoleHolders(s.orgId, ['merchant_owner']),
        this.orgs.merchantSettings(s.orgId),
      ]);
      unsettled += Math.abs(cashNow.amount + old.amount);
      // A store left with no owner must not keep taking orders: it is closed until reopened by hand, or another owner holds it.
      const otherOwner = owners.some((o) => o.personId !== personId && !o.frozen);
      const shut = closedNow(settings.closed, now);
      if (!otherOwner && !(shut && !shut.until)) soleOpen += 1;
    }
    if (unsettled > 0) out.push({ kind: 'unpaid_settlement', amountIqd: unsettled });
    if (soleOpen > 0) out.push({ kind: 'sole_owner_of_open_store', count: soleOpen });
    // A customer account is negative once he paid cash (contracts ledger.ts); only money we hold for him stops the close.
    if (wallet.amount > 0) out.push({ kind: 'wallet_balance', amountIqd: wallet.amount });
    return out;
  }
}
