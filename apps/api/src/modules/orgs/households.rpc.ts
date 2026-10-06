import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  type Actor,
  type ApprovalIdInput,
  type ApprovalOrderContext,
  type CreateHouseholdInput,
  type HouseholdIdInput,
  type HouseholdsPort,
  type HouseholdView,
  type InviteMemberInput,
  type PayerApprovalView,
  type SetLimitInput,
} from '@driver/contracts';
import type { z } from 'zod';
import { OrgsService, type Org, type PayerApprovalRequest } from './orgs.service.js';

/** What households need from identity: people by phone and their (logged) member cards. */
export interface HouseholdPeople {
  ensurePersonByPhone(rawPhone: string, actorId: string, via: string): Promise<string>;
  memberCards(personIds: readonly string[], accessorId: string): Promise<Record<string, { name: string | null; phoneMasked: string }>>;
}
export const HOUSEHOLD_PEOPLE = Symbol('HOUSEHOLD_PEOPLE');

/** w5: reads the order behind an approval (bound by the module that can read orders and menus). */
export type ApprovalContextReader = (orderId: string) => Promise<ApprovalOrderContext | null>;

const STATE_AR: Record<PayerApprovalRequest['state'], string> = { pending: 'بانتظار موافقتك', approved: 'وافقت', declined: 'رفضت' };

/**
 * `ctx.households` (domain §12). Only members see a household; only payers invite, set limits and
 * resolve approvals. A non-member asking about a household gets `not_household_member`.
 */
@Injectable()
export class HouseholdsRpc implements HouseholdsPort {
  constructor(
    private readonly orgs: OrgsService,
    @Inject(HOUSEHOLD_PEOPLE) private readonly people: HouseholdPeople,
  ) {}

  private orderContext: ApprovalContextReader | null = null;

  /** Joy w5: approvals say what was ordered, from where, for where (tracking binds this at start). */
  bindOrderContext(reader: ApprovalContextReader): void {
    this.orderContext = reader;
  }

  async mine(actor: Actor): Promise<HouseholdView | null> {
    const home = (await this.orgs.householdsOf(actor.personId))[0];
    return home ? this.view(home, actor.personId) : null;
  }

  async create(actor: Actor, input: z.infer<typeof CreateHouseholdInput>): Promise<HouseholdView> {
    if ((await this.orgs.householdsOf(actor.personId)).length > 0) throw new DriverError('household_exists');
    const home = await this.orgs.createHousehold({ name: input.name.trim(), cityId: input.cityId, payerId: actor.personId });
    return this.view(home, actor.personId);
  }

  async inviteMember(actor: Actor, input: z.infer<typeof InviteMemberInput>): Promise<HouseholdView> {
    const home = await this.asPayer(actor, input.householdId);
    const personId = await this.people.ensurePersonByPhone(input.phone, actor.personId, 'household_invite');
    if (personId === actor.personId) throw new DriverError('invalid_input');
    const after = await this.orgs.addMember(home.id, personId, { role: input.role, spendingLimitIqd: input.spendingLimitIqd, actorId: actor.personId });
    return this.view(after, actor.personId);
  }

  async setLimit(actor: Actor, input: SetLimitInput): Promise<HouseholdView> {
    const home = await this.asPayer(actor, input.householdId);
    const m = await this.orgs.member(home.id, input.personId);
    if (m.role === 'payer') throw new DriverError('invalid_input');
    await this.orgs.setSpendingLimit(home.id, input.personId, input.spendingLimitIqd, actor.personId);
    return this.view(await this.orgs.get(home.id), actor.personId);
  }

  async approvals(actor: Actor, input: HouseholdIdInput): Promise<PayerApprovalView[]> {
    const home = await this.asMember(actor, input.householdId);
    const payer = this.isPayer(home, actor.personId);
    const list = (await this.orgs.approvalsOf(home.id)).filter((a) => payer || a.requestedBy === actor.personId);
    return this.approvalViews(home, list, actor.personId);
  }

  approve(actor: Actor, input: ApprovalIdInput): Promise<PayerApprovalView> {
    return this.resolve(actor, input.requestId, 'approved');
  }

  decline(actor: Actor, input: ApprovalIdInput): Promise<PayerApprovalView> {
    return this.resolve(actor, input.requestId, 'declined');
  }

  // ───────────────────────── internals ─────────────────────────

  private async resolve(actor: Actor, requestId: string, decision: 'approved' | 'declined'): Promise<PayerApprovalView> {
    const req = await this.approvalVisibleTo(actor, requestId);
    const home = await this.asPayer(actor, req.orgId);
    const done = await this.orgs.resolvePayerApproval(req.id, actor.personId, decision);
    return (await this.approvalViews(home, [done], actor.personId))[0]!;
  }

  /** Unknown and other households' requests look the same: not found. */
  private async approvalVisibleTo(actor: Actor, requestId: string): Promise<PayerApprovalRequest> {
    let req: PayerApprovalRequest;
    try {
      req = await this.orgs.approval(requestId);
    } catch {
      throw new DriverError('not_found');
    }
    if (!(await this.orgs.get(req.orgId)).members.some((m) => m.personId === actor.personId)) throw new DriverError('not_found');
    return req;
  }

  private async household(orgId: string): Promise<Org> {
    const org = await this.orgs.get(orgId);
    if (org.type !== 'household') throw new DriverError('org_not_found');
    return org;
  }

  private async asMember(actor: Actor, orgId: string): Promise<Org> {
    const home = await this.household(orgId);
    if (!home.members.some((m) => m.personId === actor.personId)) throw new DriverError('not_household_member');
    return home;
  }

  private async asPayer(actor: Actor, orgId: string): Promise<Org> {
    const home = await this.asMember(actor, orgId);
    if (!this.isPayer(home, actor.personId)) throw new DriverError('household_payer_only');
    return home;
  }

  private isPayer(home: Org, personId: string): boolean {
    return home.members.some((m) => m.personId === personId && m.role === 'payer');
  }

  private async approvalViews(home: Org, list: readonly PayerApprovalRequest[], viewerId: string): Promise<PayerApprovalView[]> {
    const cards = await this.people.memberCards(
      list.map((a) => a.requestedBy),
      viewerId,
    );
    const payer = this.isPayer(home, viewerId);
    const contexts = await Promise.all(list.map((a) => (this.orderContext ? this.orderContext(a.orderId).catch(() => null) : Promise.resolve(null))));
    return list.map((a, i) => ({
      id: a.id,
      householdId: a.orgId,
      orderId: a.orderId,
      requestedBy: a.requestedBy,
      requestedByName: cards[a.requestedBy]?.name ?? null,
      amountIqd: a.amountIqd,
      limitIqd: home.members.find((m) => m.personId === a.requestedBy)?.spendingLimitIqd ?? null,
      state: a.state,
      state_ar: a.state === 'pending' && !payer ? 'بانتظار الموافقة' : STATE_AR[a.state],
      createdAt: a.createdAt,
      canResolve: payer && a.state === 'pending',
      context: contexts[i] ?? null,
    }));
  }

  private async view(home: Org, viewerId: string): Promise<HouseholdView> {
    const me = home.members.find((m) => m.personId === viewerId);
    if (!me) throw new DriverError('not_household_member');
    const cards = await this.people.memberCards(
      home.members.map((m) => m.personId),
      viewerId,
    );
    const rank = { payer: 0, orderer: 1, member: 2 } as const;
    const members = home.members
      .map((m) => ({
        personId: m.personId,
        name: cards[m.personId]?.name ?? null,
        phoneMasked: cards[m.personId]?.phoneMasked ?? '',
        role: m.role,
        spendingLimitIqd: m.spendingLimitIqd,
        isMe: m.personId === viewerId,
      }))
      .sort((a, b) => rank[a.role] - rank[b.role] || Number(b.isMe) - Number(a.isMe));
    const payer = me.role === 'payer';
    const pending = (await this.orgs.pendingApprovals(home.id)).filter((a) => payer || a.requestedBy === viewerId);
    return {
      id: home.id,
      name: home.name,
      cityId: home.cityId,
      myRole: me.role,
      members,
      pendingApprovals: await this.approvalViews(home, pending, viewerId),
    };
  }
}
