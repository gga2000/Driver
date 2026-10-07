import { Inject, Injectable, Optional } from '@nestjs/common';
import { DriverError, HOUSEHOLD_INVITE_RULES, type HouseholdApprovalReason } from '@driver/contracts';
import { CLOCK, SystemClock, type Clock } from '../../shared/clock.js';
import { advisoryXactLock, DistributedKeyedLock } from '../../shared/db/advisory-lock.js';
import { NoDatabaseRunner, UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { EventsService } from '../events/index.js';
import { InMemoryOrgsRepository, ORGS_REPOSITORY, type OrgsRepository } from './orgs.repository.js';
import {
  DEFAULT_MERCHANT_SETTINGS,
  isMerchantType,
  type HouseholdInvite,
  type MerchantOrg,
  type MerchantSettings,
  type Org,
  type OrgMember,
  type OrgMemberRole,
  type OrgType,
  type PayerApprovalRequest,
} from './orgs.types.js';

export type { HouseholdInvite, MerchantOrg, MerchantPauseWindow, MerchantPickupSpot, MerchantSettings, Org, OrgMember, OrgMemberRole, OrgType, PayerApprovalRequest } from './orgs.types.js';

/**
 * Orgs: restaurants, grocers, fleets and households (domain §12) — members, merchant order-taking
 * settings and household payer approvals. State lives behind `OrgsRepository` (Prisma with
 * DATABASE_URL, in memory otherwise); every change commits with its domain event in one unit of work.
 *
 * Constructed by hand (tests) it runs on its own in-memory repository and a database-less unit of work.
 */
const DAY_MS = 86_400_000;
/** SEC-06 locks: one person's household membership, and one household's people. Always person first. */
const personLock = (personId: string) => `household.person:${personId}`;
const householdKey = (orgId: string) => `household:${orgId}`;

@Injectable()
export class OrgsService {
  private readonly clock: Clock;
  private readonly repo: OrgsRepository;
  private readonly uow: UnitOfWork;
  /** One household creation at a time per payer (RDB-05). */
  private readonly householdLock: DistributedKeyedLock;

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

  /**
   * A household: the creator is its first payer. One household per person (`household_exists`),
   * checked under the person's lock so a yes to an invite on another phone cannot race it.
   */
  createHousehold(input: { name: string; cityId: string; payerId: string }): Promise<Org> {
    return this.uow.run(async (tx) => {
      await advisoryXactLock(tx, personLock(input.payerId));
      if ((await this.repo.list({ types: ['household'], memberId: input.payerId }, tx)).length > 0) throw new DriverError('household_exists');
      return this.create({ type: 'household', name: input.name, cityId: input.cityId, ownerId: input.payerId });
    });
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

  // ───────────────────────── household invites (SEC-06) ─────────────────────────

  /** An invite still waiting: pending and younger than `HOUSEHOLD_INVITE_RULES.inviteDays`. */
  private open(inv: HouseholdInvite | null, now: Date): inv is HouseholdInvite {
    return !!inv && inv.state === 'pending' && now.getTime() - inv.invitedAt.getTime() < HOUSEHOLD_INVITE_RULES.inviteDays * DAY_MS;
  }

  /**
   * The payer invites someone: an invite that waits for their yes (nobody is added by having their
   * number typed). `member`: already in; `quiet`: they said no to this household lately, so it does not
   * ask again (the payer is not told either way); `invited`: the invite is open. The household holds at
   * most `maxMembers` people with its open invites (`household_full`), and sends at most
   * `invitesPerDay` invites a day (`rate_limited`).
   */
  inviteToHousehold(input: { orgId: string; personId: string; role: 'orderer' | 'member'; spendingLimitIqd: number | null; actorId: string }): Promise<'member' | 'quiet' | 'invited'> {
    return this.uow.run(async (tx) => {
      await advisoryXactLock(tx, householdKey(input.orgId));
      const now = this.clock.now();
      const org = await this.get(input.orgId, tx);
      if (org.members.some((m) => m.personId === input.personId)) return 'member';
      const existing = await this.repo.inviteOf(input.orgId, input.personId, tx);
      if (existing?.state === 'declined' && existing.respondedAt && now.getTime() - existing.respondedAt.getTime() < HOUSEHOLD_INVITE_RULES.declinedQuietDays * DAY_MS) return 'quiet';
      const reopened = this.open(existing, now);
      if (!reopened) {
        const others = (await this.repo.pendingInvites({ orgId: input.orgId }, tx)).filter((i) => this.open(i, now) && i.personId !== input.personId);
        if (org.members.length + others.length >= HOUSEHOLD_INVITE_RULES.maxMembers) throw new DriverError('household_full');
        if ((await this.repo.invitesSentSince(input.orgId, new Date(now.getTime() - DAY_MS), tx)) >= HOUSEHOLD_INVITE_RULES.invitesPerDay) throw new DriverError('rate_limited', { retryAfterSec: 3_600 });
      }
      // Asking again while an invite is open only changes what it offers; it keeps its date.
      const inv = await this.repo.saveInvite(
        { orgId: input.orgId, personId: input.personId, invitedById: input.actorId, role: input.role, spendingLimitIqd: input.spendingLimitIqd, state: 'pending', invitedAt: reopened ? existing.invitedAt : now, respondedAt: null },
        tx,
      );
      if (!reopened) await this.emit(tx, 'org.household_invited', input.actorId, { orgId: input.orgId, personId: input.personId, inviteId: inv.id, role: inv.role }, input.orgId);
      return 'invited';
    });
  }

  /** Open invites of a household (payer view), oldest first. */
  async openInvitesOf(orgId: string): Promise<HouseholdInvite[]> {
    const now = this.clock.now();
    return (await this.repo.pendingInvites({ orgId })).filter((i) => this.open(i, now));
  }

  /** Open invites to a person. */
  async openInvitesFor(personId: string): Promise<HouseholdInvite[]> {
    const now = this.clock.now();
    return (await this.repo.pendingInvites({ personId })).filter((i) => this.open(i, now));
  }

  /**
   * The invitee answers. Yes: they join with the role and limit the invite offered, unless they are
   * already in a household (`household_exists`) or it is full (`household_full`). An unknown, answered,
   * taken-back or expired invite, or someone else's: `household_invite_gone`.
   */
  respondToHouseholdInvite(inviteId: string, personId: string, accept: boolean): Promise<HouseholdInvite> {
    return this.uow.run(async (tx) => {
      const now = this.clock.now();
      // The person, then their household: two yeses (or a yes and a new household) cannot both pass,
      // nor two people take the last place.
      await advisoryXactLock(tx, personLock(personId));
      const inv = await this.repo.invite(inviteId, tx);
      if (!inv || inv.personId !== personId || !this.open(inv, now)) throw new DriverError('household_invite_gone');
      await advisoryXactLock(tx, householdKey(inv.orgId));
      if (!accept) {
        const done = await this.repo.closeInvite(inv.id, 'declined', now, tx);
        if (!done) throw new DriverError('household_invite_gone');
        await this.emit(tx, 'org.household_invite_declined', personId, { orgId: inv.orgId, personId, inviteId: inv.id }, inv.orgId);
        return done;
      }
      if ((await this.repo.list({ types: ['household'], memberId: personId }, tx)).length > 0) throw new DriverError('household_exists');
      const org = await this.get(inv.orgId, tx);
      if (org.members.length >= HOUSEHOLD_INVITE_RULES.maxMembers) throw new DriverError('household_full');
      const done = await this.repo.closeInvite(inv.id, 'accepted', now, tx);
      if (!done) throw new DriverError('household_invite_gone');
      const member: OrgMember = { personId, role: inv.role, spendingLimitIqd: inv.spendingLimitIqd };
      await this.repo.upsertMember(inv.orgId, member, tx);
      await this.emit(tx, 'org.member_added', personId, { orgId: inv.orgId, personId, role: member.role, spendingLimitIqd: member.spendingLimitIqd, inviteId: inv.id, invitedBy: inv.invitedById }, inv.orgId);
      return done;
    });
  }

  /** The payer takes back an open invite (`household_invite_gone` when it is not open). */
  cancelHouseholdInvite(orgId: string, inviteId: string, actorId: string): Promise<HouseholdInvite> {
    return this.uow.run(async (tx) => {
      await advisoryXactLock(tx, householdKey(orgId));
      const inv = await this.repo.invite(inviteId, tx);
      if (!inv || inv.orgId !== orgId || !this.open(inv, this.clock.now())) throw new DriverError('household_invite_gone');
      const done = await this.repo.closeInvite(inv.id, 'cancelled', this.clock.now(), tx);
      if (!done) throw new DriverError('household_invite_gone');
      await this.emit(tx, 'org.household_invite_cancelled', actorId, { orgId, personId: inv.personId, inviteId: inv.id }, orgId);
      return done;
    });
  }

  /**
   * Someone leaves the household (`left`, by themselves) or the payer takes them out (`removed`, never
   * a payer). The only payer cannot leave (`household_last_payer`): the household's wallet is theirs.
   * Requests of theirs still waiting stay with the payer, who may still say yes or no.
   */
  leaveHousehold(orgId: string, personId: string, how: { by: 'self' } | { by: 'payer'; actorId: string }): Promise<Org> {
    return this.uow.run(async (tx) => {
      await advisoryXactLock(tx, householdKey(orgId));
      const org = await this.get(orgId, tx);
      const m = org.members.find((x) => x.personId === personId);
      if (!m) throw new DriverError('not_household_member');
      if (m.role === 'payer') {
        if (how.by === 'payer') throw new DriverError('invalid_input');
        if (org.members.filter((x) => x.role === 'payer').length <= 1) throw new DriverError('household_last_payer');
      }
      await this.repo.removeMember(orgId, personId, tx);
      if (how.by === 'self') await this.emit(tx, 'org.member_left', personId, { orgId, personId }, orgId);
      else await this.emit(tx, 'org.member_removed', how.actorId, { orgId, personId }, orgId);
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
  setMerchantSettings(orgId: string, patch: Partial<Omit<MerchantSettings, 'lastHeartbeatAt'>>): Promise<MerchantSettings> {
    return this.uow.run(async (tx) => {
      await this.get(orgId, tx);
      await this.repo.patchMerchant(orgId, patch, tx);
      return { ...DEFAULT_MERCHANT_SETTINGS, ...(await this.get(orgId, tx)).merchant };
    });
  }

  /** Merchant-app presence ping (edge-case review A.2). */
  async heartbeat(orgId: string, at: Date = this.clock.now()): Promise<void> {
    await this.get(orgId);
    await this.repo.patchMerchant(orgId, { lastHeartbeatAt: at });
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
