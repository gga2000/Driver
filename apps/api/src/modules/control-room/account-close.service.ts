import { Inject, Injectable, Logger } from '@nestjs/common';
import { DriverError, type AccountCloseBlocker, type AccountClosePort, type AccountCloseView, type Actor, type CloseAccountInput, type CloseAccountOutput } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { AuditLogService } from '../controls/index.js';
import { IdentityService } from '../identity/index.js';
import { Accounts, LedgerService } from '../ledger/index.js';
import { BLOB_STORE, type BlobStore } from '../places/index.js';
import { DeparturesService } from '../routes/index.js';
import { SupportService } from '../support/index.js';
import { TripsService } from '../trips/index.js';

/**
 * Console › close a partner's or merchant's account (docs/api/account-close.md), admin only. Owns no
 * tables: it asks the owning modules what stands in the way (cash he holds, a job he is on, money not
 * settled), deletes his document, selfie and photo files, then has identity close the account (vault
 * rows, sessions, roles) with the audit row and the deletion case's resolution in one transaction.
 * The ledger, trips, departures and documents' status rows stay, under his opaque id.
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
    // The bytes go first: once the vault row is gone nothing points at them any more.
    const refs = await this.identity.storedFileRefs(input.personId, actor.personId);
    for (const ref of refs) await this.blobs.remove(ref);
    const closedAt = await this.uow.run(async (tx) => {
      if (!(await this.identity.closeAccount(input.personId, actor.personId))) return null;
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
      return now;
    });
    if (!closedAt) {
      // Another admin closed it a moment ago; report what is there now.
      const now = await this.identity.accountCloseState(input.personId);
      return { personId: input.personId, closable: true, closedAt: now.closedAt, blockers: [], filesRemoved: refs.length };
    }
    this.log.log(`account ${input.personId} closed by ${actor.personId} (${refs.length} files)`);
    return { personId: input.personId, closable: true, closedAt, blockers: [], filesRemoved: refs.length };
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
    for (const s of stores) {
      const [now, old] = await Promise.all([this.ledger.balance(Accounts.merchantCash(s.orgId)), this.ledger.balance(Accounts.merchant(s.orgId))]);
      unsettled += Math.abs(now.amount + old.amount);
    }
    if (unsettled > 0) out.push({ kind: 'unpaid_settlement', amountIqd: unsettled });
    // A customer account is negative once he paid cash (contracts ledger.ts); only money we hold for him stops the close.
    if (wallet.amount > 0) out.push({ kind: 'wallet_balance', amountIqd: wallet.amount });
    return out;
  }
}
