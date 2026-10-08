import { Inject, Injectable, Optional } from '@nestjs/common';
import { DriverError, type HouseholdApprovalReason } from '@driver/contracts';
import { CLOCK, SystemClock, type Clock } from '../../shared/clock.js';
import { DistributedKeyedLock } from '../../shared/db/advisory-lock.js';
import { NoDatabaseRunner, UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { EventsService } from '../events/index.js';
import { InMemoryOrgsRepository, ORGS_REPOSITORY, type OrgsRepository } from './orgs.repository.js';
import {
  DEFAULT_MERCHANT_SETTINGS,
  isMerchantType,
  type MerchantOrg,
  type MerchantSettings,
  type Org,
  type OrgMember,
  type OrgMemberRole,
  type OrgType,
  type PayerApprovalRequest,
} from './orgs.types.js';

export type { MerchantOrg, MerchantPauseWindow, MerchantPickupSpot, MerchantSettings, MerchantSetupState, Org, OrgMember, OrgMemberRole, OrgType, PayerApprovalRequest } from './orgs.types.js';

/**
 * Orgs: restaurants, grocers, fleets and households (domain §12) — members, merchant order-taking
 * settings and household payer approvals. State lives behind `OrgsRepository` (Prisma with
 * DATABASE_URL, in memory otherwise); every change commits with its domain event in one unit of work.
 *
 * Constructed by hand (tests) it runs on its own in-memory repository and a database-less unit of work.
 */
/**
 * A heartbeat after this long a gap counts as a tablet coming back (x1): well under the 5 minutes
 * offline that pause a shop, so a shop that paused always reopens on the lists at once.
 */
const HEARTBEAT_GAP_MS = 2 * 60_000;

@Injectable()
export class OrgsService {
  private readonly clock: Clock;
  private readonly repo: OrgsRepository;
  private readonly uow: UnitOfWork;
  /** One household creation at a time per payer (RDB-05). */
  private readonly householdLock: DistributedKeyedLock;
  /** x1: when (epoch ms) a merchant's settings last changed through this instance; 0 when never. */
  private merchantChangedAt = 0;

  constructor(
    @Optional() private readonly events?: EventsService,
    @Optional() @Inject(CLOCK) clock?: Clock,
    @Optional() @Inject(ORGS_REPOSITORY) repo?: OrgsRepository,
    @Optional() uow?: UnitOfWork,
  ) {
    this.clock = clock ?? new SystemClock();
    this.repo = repo ?? new InMemoryOrgsRepository();
    this.uow = uow ?? new UnitOfWork(new NoDatabaseRunner());
    this.householdLock = new DistributedKeyedLock(this.uow, 'orgs.household_create');
  }

  create(input: { type: OrgType; name: string; cityId: string; ownerId: string }): Promise<Org> {
    const ownerRole: OrgMemberRole = input.type === 'household' ? 'payer' : 'member';
    return this.uow.run(async (tx) => {
      const org = await this.repo.create({ type: input.type, name: input.name, cityId: input.cityId, members: [{ personId: input.ownerId, role: ownerRole, spendingLimitIqd: null }] }, tx);
      await this.emit(tx, 'org.created', input.ownerId, { orgId: org.id, type: org.type, cityId: org.cityId }, org.id);
      return org;
    });
  }

  /** A household: the creator is its first payer. */
  createHousehold(input: { name: string; cityId: string; payerId: string }): Promise<Org> {
    return this.create({ type: 'household', name: input.name, cityId: input.cityId, ownerId: input.payerId });
  }

  /**
   * «بيتنا» created from the app (RDB-05): one household per person. The check and the insert run in
   * one transaction under a lock on the payer (Postgres advisory lock across instances), so two quick
   * taps cannot make two households. The same name again by its payer (the second tap) returns the
   * first household; any other household of the person is `household_exists`.
   */
  createOwnHousehold(input: { name: string; cityId: string; payerId: string }): Promise<Org> {
    return this.householdLock.run(input.payerId, async (tx) => {
      const mine = await this.repo.list({ types: ['household'], memberId: input.payerId }, tx);
      const replay = mine.find((o) => o.name === input.name && o.members.some((m) => m.personId === input.payerId && m.role === 'payer'));
      if (replay) return replay;
      if (mine.length > 0) throw new DriverError('household_exists');
      return this.createHousehold(input);
    });
  }

  addMember(orgId: string, personId: string, opts: { role?: OrgMemberRole; spendingLimitIqd?: number | null; actorId?: string } = {}): Promise<Org> {
    return this.uow.run(async (tx) => {
      const org = await this.get(orgId, tx);
      const existing = org.members.find((m) => m.personId === personId);
      if (existing) {
        const next: OrgMember = { ...existing, ...(opts.role ? { role: opts.role } : {}), ...(opts.spendingLimitIqd !== undefined ? { spendingLimitIqd: opts.spendingLimitIqd } : {}) };
        if (next.role !== existing.role || next.spendingLimitIqd !== existing.spendingLimitIqd) await this.repo.upsertMember(orgId, next, tx);
        return this.get(orgId, tx);
      }
      const member: OrgMember = { personId, role: opts.role ?? 'member', spendingLimitIqd: opts.spendingLimitIqd ?? null };
      await this.repo.upsertMember(orgId, member, tx);
      await this.emit(tx, 'org.member_added', opts.actorId ?? personId, { orgId, personId, role: member.role, spendingLimitIqd: member.spendingLimitIqd }, orgId);
      return this.get(orgId, tx);
    });
  }

  setSpendingLimit(orgId: string, personId: string, spendingLimitIqd: number | null, actorId?: string): Promise<OrgMember> {
    return this.uow.run(async (tx) => {
      const m = { ...(await this.member(orgId, personId, tx)), spendingLimitIqd };
      await this.repo.upsertMember(orgId, m, tx);
      if (actorId) await this.emit(tx, 'org.member_limit_set', actorId, { orgId, personId, spendingLimitIqd }, orgId);
      return m;
    });
  }

  /** Joy w4: a member's monthly budget on the household wallet (null = none). */
  setMonthlyBudget(orgId: string, personId: string, monthlyBudgetIqd: number | null, actorId?: string): Promise<OrgMember> {
    return this.uow.run(async (tx) => {
      const m = { ...(await this.member(orgId, personId, tx)), monthlyBudgetIqd };
      await this.repo.upsertMember(orgId, m, tx);
      if (actorId) await this.emit(tx, 'org.member_budget_set', actorId, { orgId, personId, monthlyBudgetIqd }, orgId);
      return m;
    });
  }

  async member(orgId: string, personId: string, tx?: Tx): Promise<OrgMember> {
    const m = (await this.get(orgId, tx)).members.find((x) => x.personId === personId);
    if (!m) throw new DriverError('not_household_member');
    return m;
  }

  async payersOf(orgId: string, tx?: Tx): Promise<OrgMember[]> {
    return (await this.get(orgId, tx)).members.filter((m) => m.role === 'payer');
  }

  /** True when `amountIqd` is within the member's limit (payers are never limited). */
  async withinLimit(orgId: string, personId: string, amountIqd: number): Promise<boolean> {
    const m = await this.member(orgId, personId);
    if (m.role === 'payer' || m.spendingLimitIqd === null) return true;
    return amountIqd <= m.spendingLimitIqd;
  }

  /** Orders over a member's limit request one-tap payer approval (domain §12). Idempotent per order. */
  requestPayerApproval(input: { orgId: string; orderId: string; requestedBy: string; amountIqd: number; reason?: HouseholdApprovalReason | null }): Promise<PayerApprovalRequest> {
    return this.uow.run(async (tx) => {
      const existing = await this.repo.approvalForOrder(input.orgId, input.orderId, tx);
      if (existing) return existing;
      await this.member(input.orgId, input.requestedBy, tx);
      const payer = (await this.payersOf(input.orgId, tx))[0];
      if (!payer) throw new DriverError('no_payer');
      const req = await this.repo.addApproval(
        { orgId: input.orgId, orderId: input.orderId, requestedBy: input.requestedBy, payerId: payer.personId, amountIqd: input.amountIqd, state: 'pending', reason: input.reason ?? null, createdAt: this.clock.now() },
        tx,
      );
      await this.emit(
        tx,
        'org.payer_approval_requested',
        input.requestedBy,
        { orgId: input.orgId, orderId: input.orderId, payerId: payer.personId, amountIqd: input.amountIqd, requestId: req.id, reason: input.reason ?? null },
        input.orgId,
      );
      return req;
    });
  }

  resolvePayerApproval(requestId: string, payerId: string, decision: 'approved' | 'declined'): Promise<PayerApprovalRequest> {
    return this.uow.run(async (tx) => {
      const req = await this.repo.approval(requestId, tx);
      if (!req) throw new DriverError('not_found');
      if (req.payerId !== payerId && !(await this.payersOf(req.orgId, tx)).some((p) => p.personId === payerId)) throw new DriverError('forbidden');
      if (req.state !== 'pending') return req;
      const done = await this.repo.resolveApproval(requestId, decision, tx);
      // Lost a race with another payer: theirs stands, nothing more to record.
      if (!done) return (await this.repo.approval(requestId, tx)) ?? req;
      await this.emit(tx, decision === 'approved' ? 'org.payer_approved' : 'org.payer_declined', payerId, { orgId: req.orgId, orderId: req.orderId, requestId }, req.orgId);
      return done;
    });
  }

  /**
   * Joy w4: the order behind a pending request went away (the orderer cancelled, or nobody answered in
   * time): the request is withdrawn so it stops asking. Null when there is none; a decided one stays.
   */
  withdrawApproval(orgId: string, orderId: string, actorId: string): Promise<PayerApprovalRequest | null> {
    return this.uow.run(async (tx) => {
      const req = await this.repo.approvalForOrder(orgId, orderId, tx);
      if (!req || req.state !== 'pending') return req;
      const done = await this.repo.resolveApproval(req.id, 'withdrawn', tx);
      if (!done) return (await this.repo.approval(req.id, tx)) ?? req;
      await this.emit(tx, 'org.payer_approval_withdrawn', actorId, { orgId, orderId, requestId: req.id }, orgId);
      return done;
    });
  }

  /** The request for an order, if any. */
  approvalForOrder(orgId: string, orderId: string): Promise<PayerApprovalRequest | null> {
    return this.repo.approvalForOrder(orgId, orderId);
  }

  async approval(requestId: string): Promise<PayerApprovalRequest> {
    const req = await this.repo.approval(requestId);
    if (!req) throw new DriverError('not_found');
    return req;
  }

  /** Every request of a household, newest first (pending and resolved). */
  approvalsOf(orgId: string): Promise<PayerApprovalRequest[]> {
    return this.repo.approvals(orgId);
  }

  pendingApprovals(orgId: string): Promise<PayerApprovalRequest[]> {
    return this.repo.approvals(orgId, { state: 'pending' });
  }

  async get(orgId: string, tx?: Tx): Promise<Org> {
    const org = await this.repo.get(orgId, tx);
    if (!org) throw new DriverError('org_not_found');
    return org;
  }

  /** The org, or null when unknown (ports that answer "no such merchant" rather than throw). */
  find(orgId: string): Promise<Org | null> {
    return this.repo.get(orgId);
  }

  inCity(cityId: string, type?: OrgType): Promise<Org[]> {
    return this.repo.list({ cityId, ...(type ? { types: [type] } : {}) });
  }

  /** Restaurants and grocers of a city (Console merchant picker), by name. */
  async merchants(cityId: string): Promise<MerchantOrg[]> {
    const rows = await this.repo.list({ cityId, types: ['restaurant', 'grocer'] });
    return rows
      .filter((o): o is Org & { type: 'restaurant' | 'grocer' } => isMerchantType(o.type))
      .map((o) => ({ id: o.id, name: o.name, type: o.type, cityId: o.cityId, lastHeartbeatAt: o.merchant?.lastHeartbeatAt ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.id.localeCompare(b.id));
  }

  /** Order-taking settings of a restaurant or grocer (defaults when never set). */
  async merchantSettings(orgId: string): Promise<MerchantSettings> {
    return { ...DEFAULT_MERCHANT_SETTINGS, ...(await this.get(orgId)).merchant };
  }

  /** Writes only the given settings and returns the result. */
  async setMerchantSettings(orgId: string, patch: Partial<Omit<MerchantSettings, 'lastHeartbeatAt'>>): Promise<MerchantSettings> {
    try {
      return await this.uow.run(async (tx) => {
        await this.get(orgId, tx);
        await this.repo.patchMerchant(orgId, patch, tx);
        return { ...DEFAULT_MERCHANT_SETTINGS, ...(await this.get(orgId, tx)).merchant };
      });
    } finally {
      this.merchantChanged();
    }
  }

  /** Merchant-app presence ping (edge-case review A.2). */
  async heartbeat(orgId: string, at: Date = this.clock.now()): Promise<void> {
    const before = (await this.get(orgId)).merchant?.lastHeartbeatAt ?? null;
    await this.repo.patchMerchant(orgId, { lastHeartbeatAt: at });
    // A tablet back after a gap (long enough to have paused the shop) reopens it on the lists at once.
    if (before === null || at.getTime() - before.getTime() > HEARTBEAT_GAP_MS) this.merchantChanged();
  }

  /**
   * x1: when a merchant's settings last changed through this instance (epoch ms, 0 = never): opened
   * or closed by hand, busy, moved, hours, or a tablet back online. The customer lists rebuild when it moves.
   */
  merchantChangeStamp(): number {
    return this.merchantChangedAt;
  }

  private merchantChanged(): void {
    this.merchantChangedAt = Math.max(this.merchantChangedAt + 1, this.clock.now().getTime());
  }

  householdsOf(personId: string): Promise<Org[]> {
    return this.repo.list({ types: ['household'], memberId: personId });
  }

  /** Events now commit with their change (unit of work); kept so callers that awaited it still compile. */
  async settled(): Promise<void> {}

  private async emit(tx: Tx, type: string, actorId: string, payload: Record<string, unknown>, orgId: string): Promise<void> {
    if (!this.events) return;
    await this.events.emit(tx, { actorId, type, occurredAt: this.clock.now(), payload }, { name: 'org', id: orgId });
  }
}
