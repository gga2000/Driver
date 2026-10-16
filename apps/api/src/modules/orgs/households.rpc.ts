import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  baghdadMonth,
  DriverError,
  HOUSEHOLD_SPEND_EXCLUDED,
  householdMonthSpend,
  type Actor,
  type ApprovalIdInput,
  type ApprovalOrderContext,
  type CreateHouseholdInput,
  type HouseholdIdInput,
  type HouseholdsPort,
  type HouseholdTableOrder,
  type HouseholdView,
  type InviteMemberInput,
  type MonthKey,
  type OrderState,
  type PayerApprovalView,
  type SetBudgetInput,
  type SetLimitInput,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, SystemClock, type Clock } from '../../shared/clock.js';
import { OrgsService, type Org, type PayerApprovalRequest } from './orgs.service.js';

/** What households need from identity: people by phone and their (logged) member cards. */
export interface HouseholdPeople {
  ensurePersonByPhone(rawPhone: string, actorId: string, via: string): Promise<string>;
  memberCards(personIds: readonly string[], accessorId: string): Promise<Record<string, { name: string | null; phoneMasked: string }>>;
}
export const HOUSEHOLD_PEOPLE = Symbol('HOUSEHOLD_PEOPLE');

/** w5: reads the order behind an approval (bound by the module that can read orders and menus). */
export type ApprovalContextReader = (orderId: string) => Promise<ApprovalOrderContext | null>;

/**
 * Joy w4: one order of the household's month — on its wallet, or a «للسفرة» order of a member — with
 * the kitchen's name. Read by the module that owns orders (bound at start).
 */
export interface HouseholdMonthOrder {
  orderId: string;
  ordererId: string;
  householdOrgId: string | null;
  familyTable: boolean;
  heldForPayer: boolean;
  merchantName: string | null;
  totalIqd: number;
  state: OrderState;
  placedAt: Date;
}
export type HouseholdMonthReader = (input: { householdId: string; memberIds: readonly string[]; month: MonthKey }) => Promise<HouseholdMonthOrder[]>;
/** Called once a payer said yes or no, so the held order moves (orders binds it). */
export type HouseholdDecisionHook = (request: PayerApprovalRequest) => Promise<void>;

const STATE_AR: Record<PayerApprovalRequest['state'], string> = { pending: 'بانتظار موافقتك', approved: 'وافقت', declined: 'رفضت', withdrawn: 'انلغى الطلب' };
const DONE_STATES: ReadonlySet<OrderState> = new Set(['delivered', 'closed', 'completed']);

/**
 * What the hub shows as spent: orders still waiting for the payer's yes are left out (they are not
 * spent yet). Placement counts them, so two orders can't slip under the budget together.
 */
const settled = (orders: readonly HouseholdMonthOrder[]): HouseholdMonthOrder[] => orders.filter((o) => !(o.heldForPayer && o.state === 'placed'));

/**
 * `ctx.households` (domain §12). Only members see a household; only payers invite, set limits and
 * resolve approvals. A non-member asking about a household gets `not_household_member`.
 */
@Injectable()
export class HouseholdsRpc implements HouseholdsPort {
  private readonly logger = new Logger(HouseholdsRpc.name);
  private readonly clock: Clock;

  constructor(
    private readonly orgs: OrgsService,
    @Inject(HOUSEHOLD_PEOPLE) private readonly people: HouseholdPeople,
    @Optional() @Inject(CLOCK) clock?: Clock,
  ) {
    this.clock = clock ?? new SystemClock();
  }

  private orderContext: ApprovalContextReader | null = null;
  private monthOrders: HouseholdMonthReader | null = null;
  private decided: HouseholdDecisionHook | null = null;

  /** Joy w5: approvals say what was ordered, from where, for where (tracking binds this at start). */
  bindOrderContext(reader: ApprovalContextReader): void {
    this.orderContext = reader;
  }

  /** Joy w4: the month's household orders (the insights module binds this at start). */
  bindMonthOrders(reader: HouseholdMonthReader): void {
    this.monthOrders = reader;
  }

  /** Joy w4: the held order moves when the payer answers (orders binds this at start). */
  bindDecision(hook: HouseholdDecisionHook): void {
    this.decided = hook;
  }

  async mine(actor: Actor): Promise<HouseholdView | null> {
    const home = (await this.orgs.householdsOf(actor.personId))[0];
    return home ? this.view(home, actor.personId) : null;
  }

  async create(actor: Actor, input: z.infer<typeof CreateHouseholdInput>): Promise<HouseholdView> {
    // Checked and created under a lock on the payer: a double tap makes one household (RDB-05).
    const home = await this.orgs.createOwnHousehold({ name: input.name.trim(), cityId: input.cityId, payerId: actor.personId });
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

  async setBudget(actor: Actor, input: SetBudgetInput): Promise<HouseholdView> {
    const home = await this.asPayer(actor, input.householdId);
    const m = await this.orgs.member(home.id, input.personId);
    if (m.role === 'payer') throw new DriverError('invalid_input');
    await this.orgs.setMonthlyBudget(home.id, input.personId, input.monthlyBudgetIqd, actor.personId);
    return this.view(await this.orgs.get(home.id), actor.personId);
  }

  async approvals(actor: Actor, input: HouseholdIdInput): Promise<PayerApprovalView[]> {
    const home = await this.asMember(actor, input.householdId);
    const payer = this.isPayer(home, actor.personId);
    const list = (await this.orgs.approvalsOf(home.id)).filter((a) => payer || a.requestedBy === actor.personId);
    return this.approvalViews(home, list, actor.personId, await this.readMonth(home));
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
    if (req.state === 'pending' && done.state === decision && this.decided) {
      // The decision is stored; the order's own timer settles it if this hand-off fails now.
      await this.decided(done).catch((err: unknown) => this.logger.error(`household decision ${done.id}: ${(err as Error).message}`, (err as Error).stack));
    }
    return (await this.approvalViews(home, [done], actor.personId, await this.readMonth(home)))[0]!;
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

  /** This Baghdad month's household orders, or null when nothing can read them (no binding, a failure). */
  private async readMonth(home: Org): Promise<{ month: MonthKey; orders: HouseholdMonthOrder[] } | null> {
    if (!this.monthOrders) return null;
    const month = baghdadMonth(this.clock.now());
    try {
      return { month, orders: await this.monthOrders({ householdId: home.id, memberIds: home.members.map((m) => m.personId), month }) };
    } catch (err) {
      this.logger.warn(`household month ${home.id}: ${(err as Error).message}`);
      return null;
    }
  }

  private async approvalViews(home: Org, list: readonly PayerApprovalRequest[], viewerId: string, month: { orders: HouseholdMonthOrder[] } | null): Promise<PayerApprovalView[]> {
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
      reason: a.reason ?? null,
      monthBudgetIqd: home.members.find((m) => m.personId === a.requestedBy)?.monthlyBudgetIqd ?? null,
      // What they spent this month before this order (the card says «هالشهر 46,000 من 50,000»).
      monthSpentIqd: month
        ? householdMonthSpend(
            settled(month.orders).filter((o) => o.orderId !== a.orderId),
            home.id,
            a.requestedBy,
          )
        : null,
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
    const payer = me.role === 'payer';
    const month = await this.readMonth(home);
    const members = home.members
      .map((m) => ({
        personId: m.personId,
        name: cards[m.personId]?.name ?? null,
        phoneMasked: cards[m.personId]?.phoneMasked ?? '',
        role: m.role,
        spendingLimitIqd: m.spendingLimitIqd,
        isMe: m.personId === viewerId,
        monthlyBudgetIqd: m.role === 'payer' ? null : (m.monthlyBudgetIqd ?? null),
        // Privacy between adults: the payer sees everyone's month, a member only their own.
        monthSpentIqd: month && (payer || m.personId === viewerId) ? householdMonthSpend(settled(month.orders), home.id, m.personId) : null,
      }))
      .sort((a, b) => rank[a.role] - rank[b.role] || Number(b.isMe) - Number(a.isMe));
    const pending = (await this.orgs.pendingApprovals(home.id)).filter((a) => payer || a.requestedBy === viewerId);
    return {
      id: home.id,
      name: home.name,
      cityId: home.cityId,
      myRole: me.role,
      members,
      pendingApprovals: await this.approvalViews(home, pending, viewerId, month),
      month: month ? { month: month.month, tableOrders: tableOrders(month.orders, home.id, viewerId, payer, cards) } : null,
    };
  }
}

/**
 * «سفرة البيت» (joy w4): the month's «للسفرة» orders of every member, and the orders on the household
 * wallet — everyone's for a payer, a member's own otherwise. Refused and cancelled ones are left out;
 * newest first.
 */
export function tableOrders(
  orders: readonly HouseholdMonthOrder[],
  householdId: string,
  viewerId: string,
  payer: boolean,
  cards: Record<string, { name: string | null } | undefined>,
): HouseholdTableOrder[] {
  return orders
    .filter((o) => !HOUSEHOLD_SPEND_EXCLUDED.includes(o.state))
    .filter((o) => o.familyTable || (o.householdOrgId === householdId && (payer || o.ordererId === viewerId)))
    .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime() || b.orderId.localeCompare(a.orderId))
    .map((o) => ({
      orderId: o.orderId,
      orderedBy: o.ordererId,
      orderedByName: cards[o.ordererId]?.name ?? null,
      merchantName: o.merchantName,
      totalIqd: o.totalIqd,
      placedAt: o.placedAt,
      onHouseholdWallet: o.householdOrgId === householdId,
      familyTable: o.familyTable,
      status: o.heldForPayer && o.state === 'placed' ? 'waiting' : DONE_STATES.has(o.state) ? 'done' : 'live',
    }));
}
