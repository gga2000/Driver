import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import {
  DisputeKind,
  DriverError,
  TERMINAL_ORDER_STATES,
  type Actor,
  type CannedResponse,
  type ChatThreadKind,
  type EventLogEntry,
  type FaultParty,
  type LedgerLineView,
  type OpenTicketInput,
  type Order,
  type RefundLimits,
  type SlaState,
  type SupportCustomer,
  type SupportList,
  type SupportListInput,
  type SupportPort,
  type TicketCase,
  type TicketEntry,
  type TicketEscalateInput,
  type TicketFaultInput,
  type TicketOrderView,
  type TicketRefundInput,
  type TicketReplyInput,
  type TicketResolveInput,
  type TicketStatus,
  type TicketSummary,
  ledgerLineLabel,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { nextLocalMidnight, startOfLocalDay } from '../../shared/local-time.js';
import { CatalogService } from '../catalog/index.js';
import { AuditLogService, StaffNames } from '../controls/index.js';
import { EventsService, type PublishedEvent, type StoredEvent } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import { LedgerService, SupportCreditService, type SupportCreditFunder } from '../ledger/index.js';
import { OrdersService } from '../orders/index.js';
import { OrgsService } from '../orgs/index.js';
import { TripsService } from '../trips/index.js';
import { CANNED_RESPONSES, DISPUTE_SUBJECT_AR, HOSTILE_WORDS, KIND_AR, STATUS_AR, SUGGESTED_BY_DISPUTE } from './canned.js';
import { SUPPORT_REPOSITORY, type EntryRecord, type SupportRepository, type TicketRecord } from './support.repository.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Refund limits (edge-case review 101, O.144–148; support spec §2 escalation to Ali above 25,000). */
export const SUPPORT_LIMITS = {
  /** Per support agent / dispatcher per local day; above it finance approves. */
  agentDailyCapIqd: 10_000,
  /** Per customer per 30 days, all agents together (admin may override). */
  customerMonthlyCapIqd: 25_000,
  /** One refund above this needs the escalation owner (admin: Ali or the deputy on duty). */
  escalateAboveIqd: 25_000,
  /** Above this a refund defaults to cash via the next courier (edge-case 83); the desk says so. */
  cashAboveIqd: 10_000,
  /** Customers with more disputes than this in 30 days go to manual review (domain §9). */
  manualReviewDisputes: 3,
} as const;

/** Never less than this between opening and the same-day deadline (a 23:50 ticket still gets 2 h). */
const SLA_MIN_MS = 2 * HOUR_MS;
const SLA_DUE_SOON_MS = HOUR_MS;
const NAME_TTL_MS = 5 * 60_000;
const ACTIVE: readonly TicketStatus[] = ['open', 'waiting', 'escalated'];

/** Same-day rule (launch playbook §4: every complaint answered the day it came): local midnight, ≥ 2 h, ≤ 24 h. */
export function slaDueAt(openedAt: Date): Date {
  const t = openedAt.getTime();
  return new Date(Math.min(t + DAY_MS, Math.max(nextLocalMidnight(openedAt).getTime(), t + SLA_MIN_MS)));
}

export function slaStateOf(t: { status: TicketStatus; slaDueAt: Date; resolvedAt: Date | null }, now: Date): SlaState {
  if (t.status === 'resolved') return t.resolvedAt && t.resolvedAt.getTime() <= t.slaDueAt.getTime() ? 'met' : 'breached';
  const left = t.slaDueAt.getTime() - now.getTime();
  return left < 0 ? 'breached' : left < SLA_DUE_SOON_MS ? 'due_soon' : 'ok';
}

/** Queue rank (support spec §3: active trip, money, tone) plus safety, escalation, SLA and age. */
export function urgencyOf(t: TicketRecord, ctx: { activeOrder: boolean; orderTotalIqd: number | null; text: string }, now: Date): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => {
    score += n;
    reasons.push(why);
  };
  if (t.kind === 'incident') add(50, 'سلامة');
  if (ctx.activeOrder) add(40, 'طلب شغّال هسة');
  if (t.status === 'escalated') add(30, 'مصعّدة');
  if (t.status !== 'resolved' && now.getTime() - t.openedAt.getTime() > DAY_MS) add(30, 'أكثر من 24 ساعة');
  const sla = slaStateOf(t, now);
  if (sla === 'breached') add(25, 'فات موعدها');
  else if (sla === 'due_soon') add(10, 'موعدها قريب');
  if ((ctx.orderTotalIqd ?? 0) >= SUPPORT_LIMITS.escalateAboveIqd) add(20, 'مبلغ كبير');
  if (HOSTILE_WORDS.some((w) => ctx.text.includes(w))) add(15, 'زعلان');
  if (t.status === 'waiting') score -= 15;
  score += Math.min(20, Math.floor((now.getTime() - t.openedAt.getTime()) / (10 * 60_000)));
  return { score: Math.max(0, score), reasons };
}

const DELIVERED_STATES: readonly Order['state'][] = ['delivered', 'completed', 'closed'];
const CANCELLED_STATES: readonly Order['state'][] = ['merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'failed'];

/** The customer card's order numbers: only orders this person placed (not ones they carried). */
export function customerOrderStats(orders: readonly Pick<Order, 'ordererId' | 'state' | 'totalIqd' | 'placedAt'>[], customerId: string) {
  const mine = orders.filter((o) => o.ordererId === customerId);
  const delivered = mine.filter((o) => DELIVERED_STATES.includes(o.state));
  const times = mine.map((o) => o.placedAt.getTime());
  return {
    orders: mine.length,
    delivered: delivered.length,
    cancelled: mine.filter((o) => CANCELLED_STATES.includes(o.state)).length,
    lifetimeIqd: delivered.reduce((a, o) => a + o.totalIqd, 0),
    firstOrderAt: times.length ? new Date(Math.min(...times)) : null,
    lastOrderAt: times.length ? new Date(Math.max(...times)) : null,
  };
}

function chatKindsFor(order: Order | null): ChatThreadKind[] {
  if (!order) return [];
  if (order.type === 'ride') return ['customer_courier'];
  if (order.merchantOrgId) return ['customer_courier', 'merchant_courier', 'customer_merchant'];
  return ['customer_courier'];
}

/**
 * The support desk (notifications & support spec §2–3). Tickets and their history live in Postgres
 * (`support_tickets`, `support_ticket_entries`); an order dispute opens one by itself through the
 * outbox (`support:disputes`), and an offline contradiction opens an incident. Refunds go through the
 * ledger's public API (`SupportCreditService`) in the ticket's unit of work, funded by the party at
 * fault, and are capped per agent (10,000 a day), per customer (25,000 a month) and per refund
 * (above 25,000 only the escalation owner). Every action writes the console audit log.
 */
@Injectable()
export class SupportService implements SupportPort, OnModuleInit, OnModuleDestroy {
  private readonly customerNames = new Map<string, { name: string | null; at: number }>();
  private unsubscribe: Array<() => void> = [];

  constructor(
    @Inject(SUPPORT_REPOSITORY) private readonly repo: SupportRepository,
    private readonly orders: OrdersService,
    private readonly trips: TripsService,
    private readonly catalog: CatalogService,
    private readonly orgs: OrgsService,
    private readonly ledger: LedgerService,
    private readonly credits: SupportCreditService,
    private readonly identity: IdentityService,
    private readonly events: EventsService,
    private readonly audits: AuditLogService,
    private readonly staff: StaffNames,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    // A customer dispute (or the unreachable protocol's default dispute) opens a ticket by itself.
    this.unsubscribe.push(this.events.subscribe('support:disputes', ['order.disputed'], (e, ctx) => this.onDispute(e, ctx.tx)));
    // Offline contradictions open an incident for a human (quarantined late replays included).
    this.unsubscribe.push(this.events.subscribe('support:contradictions', ['dispute.opened'], (e, ctx) => this.onContradiction(e, ctx.tx), { quarantined: true }));
  }

  onModuleDestroy(): void {
    for (const off of this.unsubscribe) off();
  }

  canned(): CannedResponse[] {
    return [...CANNED_RESPONSES];
  }

  // ───────────────────────── opening ─────────────────────────

  private async create(
    input: { cityId: string; kind: TicketRecord['kind']; channel: TicketRecord['channel']; subject: string; note: string | null; orderId: string | null; tripId: string | null; customerId: string | null; openedById: string; sourceKey: string | null },
    tx: Tx,
  ): Promise<TicketRecord> {
    const now = this.clock.now();
    const ticket = await this.repo.create(
      {
        cityId: input.cityId,
        kind: input.kind,
        status: 'open',
        channel: input.channel,
        subject: input.subject,
        orderId: input.orderId,
        tripId: input.tripId,
        customerId: input.customerId,
        openedById: input.openedById,
        openedAt: now,
        firstResponseAt: null,
        resolvedAt: null,
        slaDueAt: slaDueAt(now),
        assigneeId: null,
        faultParty: 'none',
        refundedIqd: 0,
        escalatedTo: null,
        escalatedAt: null,
        resolution: null,
        sourceKey: input.sourceKey,
        reopenCount: 0,
        lastActivityAt: now,
      },
      tx,
    );
    await this.repo.addEntry({ ticketId: ticket.id, actorId: input.openedById, kind: 'opened', text: input.note ?? input.subject, amountIqd: null, meta: { channel: input.channel }, idempotencyKey: null, at: now }, tx);
    await this.events.emit(
      tx,
      { actorId: input.openedById, type: 'support.ticket_opened', occurredAt: now, ...(input.orderId ? { orderId: input.orderId } : {}), payload: { ticketId: ticket.id, kind: ticket.kind, channel: ticket.channel, slaDueAt: ticket.slaDueAt.toISOString() } },
      { name: 'support_ticket', id: ticket.id },
    );
    return ticket;
  }

  private async onDispute(e: PublishedEvent, tx: Tx): Promise<void> {
    if (!e.orderId) return;
    const key = `dispute:${e.orderId}`;
    if (await this.repo.bySourceKey(key, tx)) return;
    const order = await this.orders.get(e.orderId).catch(() => null);
    const parsed = DisputeKind.safeParse(e.payload['kind']);
    const kind = parsed.success ? parsed.data : 'other';
    const note = typeof e.payload['note'] === 'string' ? e.payload['note'] : null;
    const courier = await this.trips.courierOf(e.orderId).catch(() => null);
    await this.create(
      {
        cityId: order?.cityId ?? 'aziziyah',
        kind: 'dispute',
        channel: e.payload['openedBy'] === 'system' ? 'system' : 'in_app',
        subject: DISPUTE_SUBJECT_AR[kind],
        note: note ? `${DISPUTE_SUBJECT_AR[kind]}: ${note}` : DISPUTE_SUBJECT_AR[kind],
        orderId: e.orderId,
        tripId: courier?.tripId ?? e.tripId ?? null,
        customerId: order?.ordererId ?? null,
        openedById: e.actorId,
        sourceKey: key,
      },
      tx,
    );
  }

  private async onContradiction(e: PublishedEvent, tx: Tx): Promise<void> {
    const key = `contradiction:${e.id}`;
    if (await this.repo.bySourceKey(key, tx)) return;
    const order = e.orderId ? await this.orders.get(e.orderId).catch(() => null) : null;
    await this.create(
      {
        cityId: order?.cityId ?? 'aziziyah',
        kind: 'incident',
        channel: 'system',
        subject: 'تعارض بالأحداث (تسجيل من جهاز بدون نت)',
        note: `الحدث ${String(e.payload['eventId'] ?? '')} يناقض اللي سجّله غيره. راجع قبل أي تسوية.`,
        orderId: e.orderId ?? null,
        tripId: e.tripId ?? null,
        customerId: order?.ordererId ?? null,
        openedById: e.actorId,
        sourceKey: key,
      },
      tx,
    );
  }

  async open(actor: Actor, input: z.output<typeof OpenTicketInput>): Promise<TicketSummary> {
    const order = input.orderId ? await this.orders.get(input.orderId) : null;
    const courier = input.orderId ? await this.trips.courierOf(input.orderId).catch(() => null) : null;
    const ticket = await this.uow.run(async (tx) => {
      const t = await this.create(
        {
          cityId: order?.cityId ?? input.cityId,
          kind: input.kind,
          channel: input.channel,
          subject: input.subject,
          note: input.note ?? null,
          orderId: order?.id ?? null,
          tripId: courier?.tripId ?? null,
          customerId: input.customerId ?? order?.ordererId ?? null,
          openedById: actor.personId,
          sourceKey: null,
        },
        tx,
      );
      await this.audits.record({ cityId: t.cityId, actorId: actor.personId, action: 'ticket.open', subjectKind: 'ticket', subjectId: t.id, summaryAr: `فتح تذكرة (${KIND_AR[t.kind]}): ${t.subject}` }, tx);
      return t;
    });
    return (await this.summaries([ticket]))[0]!;
  }

  /** Incidents keep a trip's safety data while open (scoring & safety retention). */
  async hasOpenIncident(tripId: string): Promise<boolean> {
    return (await this.repo.forTrip(tripId)).some((t) => t.kind === 'incident' && t.status !== 'resolved');
  }

  // ───────────────────────── reads ─────────────────────────

  private async customerNamesOf(ids: readonly string[]): Promise<Record<string, string | null>> {
    const now = this.clock.now().getTime();
    const out: Record<string, string | null> = {};
    const missing: string[] = [];
    for (const id of new Set(ids)) {
      const hit = this.customerNames.get(id);
      if (hit && now - hit.at < NAME_TTL_MS) out[id] = hit.name;
      else missing.push(id);
    }
    if (missing.length > 0) {
      const names = await this.identity.firstNamesFor(missing, 'system:support', 'support_queue').catch(() => ({}) as Record<string, string | null>);
      for (const id of missing) {
        out[id] = names[id] ?? null;
        this.customerNames.set(id, { name: out[id] ?? null, at: now });
      }
    }
    return out;
  }

  private async summaries(rows: TicketRecord[]): Promise<TicketSummary[]> {
    const now = this.clock.now();
    const names = await this.customerNamesOf(rows.map((r) => r.customerId).filter((x): x is string => Boolean(x)));
    const out: TicketSummary[] = [];
    for (const t of rows) {
      const order = t.orderId ? await this.orders.get(t.orderId).catch(() => null) : null;
      const firstEntry = t.status === 'resolved' ? null : (await this.repo.entries(t.id))[0];
      const u = urgencyOf(t, { activeOrder: order !== null && !TERMINAL_ORDER_STATES.includes(order.state) && order.state !== 'disputed', orderTotalIqd: order?.totalIqd ?? null, text: `${t.subject} ${firstEntry?.text ?? ''}` }, now);
      out.push({
        id: t.id,
        cityId: t.cityId,
        kind: t.kind,
        kind_ar: KIND_AR[t.kind],
        status: t.status,
        status_ar: STATUS_AR[t.status],
        channel: t.channel,
        subject: t.subject,
        orderId: t.orderId,
        tripId: t.tripId,
        customerId: t.customerId,
        customerName: t.customerId ? (names[t.customerId] ?? null) : null,
        openedAt: t.openedAt,
        firstResponseAt: t.firstResponseAt,
        resolvedAt: t.resolvedAt,
        slaDueAt: t.slaDueAt,
        slaState: slaStateOf(t, now),
        overdue24h: t.status !== 'resolved' && now.getTime() - t.openedAt.getTime() > DAY_MS,
        urgency: u.score,
        urgencyReasons: u.reasons,
        assigneeId: t.assigneeId,
        faultParty: t.faultParty,
        refundedIqd: t.refundedIqd,
        escalatedTo: t.escalatedTo,
        lastActivityAt: t.lastActivityAt,
      });
    }
    return out;
  }

  async list(_actor: Actor, input: z.output<typeof SupportListInput>): Promise<SupportList> {
    const now = this.clock.now();
    const today = startOfLocalDay(now);
    const active = await this.repo.list({ cityId: input.cityId, statuses: ACTIVE, limit: 500 });
    const resolvedToday = await this.repo.list({ cityId: input.cityId, statuses: [], resolvedSince: today, limit: 500 });
    let rows: TicketRecord[];
    if (input.status === 'active') rows = active;
    else if (input.status === 'escalated') rows = active.filter((t) => t.status === 'escalated');
    else if (input.status === 'resolved') rows = await this.repo.list({ cityId: input.cityId, statuses: ['resolved'], limit: input.limit });
    else rows = await this.repo.list({ cityId: input.cityId, limit: input.limit });
    if (input.kind) rows = rows.filter((t) => t.kind === input.kind);
    const summaries = (await this.summaries(rows.slice(0, input.limit))).sort((a, b) =>
      a.status === 'resolved' || b.status === 'resolved' ? b.lastActivityAt.getTime() - a.lastActivityAt.getTime() : b.urgency - a.urgency || a.openedAt.getTime() - b.openedAt.getTime(),
    );
    return {
      at: now,
      rows: summaries,
      counts: {
        open: active.length,
        breached: active.filter((t) => slaStateOf(t, now) === 'breached').length,
        overdue24h: active.filter((t) => now.getTime() - t.openedAt.getTime() > DAY_MS).length,
        escalated: active.filter((t) => t.status === 'escalated').length,
        resolvedToday: resolvedToday.length,
      },
    };
  }

  /** Unresolved tickets older than 24 h in a city (launch wall: target zero). */
  async overdue(cityId: string): Promise<{ overdue24h: number; open: number }> {
    const now = this.clock.now();
    const active = await this.repo.list({ cityId, statuses: ACTIVE, limit: 2000 });
    return { open: active.length, overdue24h: active.filter((t) => now.getTime() - t.openedAt.getTime() > DAY_MS).length };
  }

  private async load(id: string, tx?: Tx): Promise<TicketRecord> {
    const t = await this.repo.get(id, tx);
    if (!t) throw new DriverError('ticket_not_found');
    return t;
  }

  private async orderView(order: Order): Promise<TicketOrderView> {
    const ids = order.lines.map((l) => l.catalogItemId).filter((x): x is string => Boolean(x));
    const items = order.merchantOrgId && ids.length > 0 ? await this.catalog.itemsOf(order.merchantOrgId, ids).catch(() => []) : [];
    const nameOf = new Map(items.map((i) => [i.id, i.nameAr]));
    const merchantName = order.merchantOrgId ? await this.orgs.get(order.merchantOrgId).then((o) => o.name).catch(() => null) : null;
    const courier = await this.trips.courierOf(order.id).catch(() => null);
    return {
      id: order.id,
      type: order.type,
      state: order.state,
      totalIqd: order.totalIqd,
      paymentMethod: order.paymentMethod,
      merchantOrgId: order.merchantOrgId,
      merchantName,
      placedAt: order.placedAt,
      deliveredAt: order.deliveredAt,
      courierId: courier?.courierId ?? null,
      lines: order.lines.filter((l) => l.availability !== 'removed').map((l) => ({ name: (l.catalogItemId ? nameOf.get(l.catalogItemId) : null) ?? l.freeText ?? 'غرض', qty: l.qty, totalIqd: l.unitPriceIqd * l.qty })),
    };
  }

  private async limitsFor(actor: Actor, ticket: TicketRecord, order: Order | null): Promise<RefundLimits> {
    const now = this.clock.now();
    const tier = await this.tierOf(actor.personId);
    const usedToday = (await this.repo.refundsBy(actor.personId, startOfLocalDay(now))).reduce((a, e) => a + (e.amountIqd ?? 0), 0);
    const customerUsed = ticket.customerId ? await this.customerCredits(ticket.customerId, now) : 0;
    const agentLeft = tier === 'agent' ? Math.max(0, SUPPORT_LIMITS.agentDailyCapIqd - usedToday) : Number.MAX_SAFE_INTEGER;
    const singleLeft = tier === 'admin' ? Number.MAX_SAFE_INTEGER : SUPPORT_LIMITS.escalateAboveIqd;
    const customerLeft = tier === 'admin' ? Number.MAX_SAFE_INTEGER : Math.max(0, SUPPORT_LIMITS.customerMonthlyCapIqd - customerUsed);
    const orderLeft = order ? Math.max(0, order.totalIqd - (await this.refundedOnOrder(order.id))) : Number.MAX_SAFE_INTEGER;
    const available = ticket.customerId ? Math.min(agentLeft, singleLeft, customerLeft, orderLeft) : 0;
    return {
      agentDailyCapIqd: tier === 'agent' ? SUPPORT_LIMITS.agentDailyCapIqd : 0,
      agentUsedTodayIqd: usedToday,
      customerMonthlyCapIqd: SUPPORT_LIMITS.customerMonthlyCapIqd,
      customerUsedMonthIqd: customerUsed,
      escalateAboveIqd: SUPPORT_LIMITS.escalateAboveIqd,
      availableIqd: Math.floor((available === Number.MAX_SAFE_INTEGER ? 500_000 : available) / 250) * 250,
      cashAboveIqd: SUPPORT_LIMITS.cashAboveIqd,
    };
  }

  private async customerCredits(customerId: string, now: Date, tx?: Tx): Promise<number> {
    const since = new Date(now.getTime() - 30 * DAY_MS);
    const tickets = await this.repo.forCustomer(customerId, new Date(since.getTime() - 30 * DAY_MS), tx);
    return (await this.repo.refundsOn(tickets.map((t) => t.id), since, tx)).reduce((a, e) => a + (e.amountIqd ?? 0), 0);
  }

  private async refundedOnOrder(orderId: string, tx?: Tx): Promise<number> {
    const tickets = await this.repo.forOrder(orderId, tx);
    return tickets.reduce((a, t) => a + t.refundedIqd, 0);
  }

  /** admin = the escalation owner (no caps); finance = no daily agent cap; everyone else an agent. */
  private async tierOf(personId: string): Promise<'admin' | 'finance' | 'agent'> {
    if (await this.identity.hasRole(personId, 'admin')) return 'admin';
    if (await this.identity.hasRole(personId, 'finance')) return 'finance';
    return 'agent';
  }

  private ledgerLine(e: Awaited<ReturnType<LedgerService['eventsForOrder']>>[number]): LedgerLineView {
    return {
      id: e.id,
      at: e.occurredAt,
      type: e.type,
      label_ar: ledgerLineLabel(e.type, 'ar-IQ'),
      amountIqd: e.amount,
      fromAccount: e.fromAccount,
      toAccount: e.toAccount,
      memo: e.memo ?? null,
    };
  }

  private async entryViews(rows: EntryRecord[]): Promise<TicketEntry[]> {
    const names = await this.staff.of(rows.map((r) => r.actorId));
    return rows.map((e) => ({ id: e.id, at: e.at, actorId: e.actorId, actorName: names[e.actorId] ?? null, kind: e.kind, text: e.text, amountIqd: e.amountIqd, meta: e.meta }));
  }

  async get(actor: Actor, input: { ticketId: string }): Promise<TicketCase> {
    const ticket = await this.load(input.ticketId);
    const order = ticket.orderId ? await this.orders.get(ticket.orderId).catch(() => null) : null;
    const [summary] = await this.summaries([ticket]);
    const entries = await this.entryViews(await this.repo.entries(ticket.id));
    let timeline: StoredEvent[] = [];
    if (ticket.orderId) timeline = await this.events.forOrder(ticket.orderId);
    if (ticket.tripId) {
      const seen = new Set(timeline.map((e) => e.id));
      timeline = [...timeline, ...(await this.events.forTrip(ticket.tripId)).filter((e) => !seen.has(e.id))];
    }
    timeline.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const ledger = ticket.orderId ? (await this.ledger.eventsForOrder(ticket.orderId)).map((e) => this.ledgerLine(e)) : [];
    const disputeKind = DisputeKind.safeParse(timeline.find((e) => e.type === 'order.disputed')?.payload['kind']);
    const disputes30d = ticket.customerId ? (await this.repo.forCustomer(ticket.customerId, new Date(this.clock.now().getTime() - 30 * DAY_MS))).filter((t) => t.kind === 'dispute').length : 0;
    return {
      ticket: summary!,
      entries,
      order: order ? await this.orderView(order) : null,
      timeline: timeline.map(toLog),
      ledger,
      chatKinds: chatKindsFor(order),
      limits: await this.limitsFor(actor, ticket, order),
      canned: this.canned(),
      suggestion: disputeKind.success ? (SUGGESTED_BY_DISPUTE[disputeKind.data] ?? null) : null,
      customerDisputes30d: disputes30d,
    };
  }

  /**
   * The customer behind a ticket, for the case's context panel: the first name (a logged
   * identity-vault read with the agent as accessor, purpose "support_case"), their orders and lifetime
   * value, support credits and disputes in the last 30 days, and their other tickets. Scoped to a
   * ticket so the desk can only look up people who wrote in.
   */
  async customer(actor: Actor, input: { ticketId: string }): Promise<SupportCustomer | null> {
    const ticket = await this.load(input.ticketId);
    const customerId = ticket.customerId;
    if (!customerId) return null;
    const now = this.clock.now();
    const names = await this.identity.firstNamesFor([customerId], actor.personId, 'support_case').catch(() => ({}) as Record<string, string | null>);
    const orders = await this.orders.listForPerson(customerId).catch(() => [] as Order[]);
    const tickets = await this.repo.forCustomer(customerId, new Date(now.getTime() - 365 * DAY_MS));
    const since30 = now.getTime() - 30 * DAY_MS;
    return {
      customerId,
      firstName: names[customerId] ?? null,
      ...customerOrderStats(orders, customerId),
      refunded30dIqd: await this.customerCredits(customerId, now),
      disputes30d: tickets.filter((t) => t.kind === 'dispute' && t.openedAt.getTime() >= since30).length,
      recentTickets: tickets
        .filter((t) => t.id !== ticket.id)
        .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())
        .slice(0, 5)
        .map((t) => ({ id: t.id, subject: t.subject, kind: t.kind, kind_ar: KIND_AR[t.kind], status: t.status, status_ar: STATUS_AR[t.status], openedAt: t.openedAt, refundedIqd: t.refundedIqd })),
    };
  }

  // ───────────────────────── actions ─────────────────────────

  private async touch(ticket: TicketRecord, actor: Actor, patch: Parameters<SupportRepository['update']>[1], tx: Tx): Promise<TicketRecord> {
    const now = this.clock.now();
    return this.repo.update(ticket.id, { lastActivityAt: now, assigneeId: ticket.assigneeId ?? actor.personId, ...patch }, tx);
  }

  async reply(actor: Actor, input: z.output<typeof TicketReplyInput>): Promise<TicketCase> {
    const ticket = await this.load(input.ticketId);
    if (ticket.status === 'resolved') throw new DriverError('ticket_closed');
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      await this.repo.addEntry({ ticketId: ticket.id, actorId: actor.personId, kind: input.internal ? 'note' : 'reply', text: input.text, amountIqd: null, meta: input.cannedKey ? { cannedKey: input.cannedKey } : {}, idempotencyKey: null, at: now }, tx);
      await this.touch(ticket, actor, input.internal ? {} : { firstResponseAt: ticket.firstResponseAt ?? now, status: ticket.status === 'open' ? 'waiting' : ticket.status }, tx);
      if (!input.internal) {
        // The customer gets the answer through notify (push / WhatsApp per the channel policy).
        await this.events.emit(
          tx,
          { actorId: actor.personId, type: 'support.replied', occurredAt: now, ...(ticket.orderId ? { orderId: ticket.orderId } : {}), payload: { ticketId: ticket.id, customerId: ticket.customerId, channel: ticket.channel, text: input.text } },
          { name: 'support_ticket', id: ticket.id },
        );
      }
      await this.audits.record({ cityId: ticket.cityId, actorId: actor.personId, action: input.internal ? 'ticket.note' : 'ticket.reply', subjectKind: 'ticket', subjectId: ticket.id, summaryAr: `${input.internal ? 'ملاحظة' : 'رد'}: ${input.text.slice(0, 80)}` }, tx);
    });
    return this.get(actor, { ticketId: ticket.id });
  }

  async refund(actor: Actor, input: z.output<typeof TicketRefundInput>): Promise<TicketCase> {
    const prior = await this.repo.entryByKey(`refund:${input.idempotencyKey}`);
    if (prior) return this.get(actor, { ticketId: prior.ticketId });
    const ticket = await this.load(input.ticketId);
    if (ticket.status === 'resolved') throw new DriverError('ticket_closed');
    if (!ticket.customerId) throw new DriverError('refund_no_customer');
    const customerId = ticket.customerId;
    const order = ticket.orderId ? await this.orders.get(ticket.orderId).catch(() => null) : null;
    const tier = await this.tierOf(actor.personId);
    if (tier !== 'admin' && input.amountIqd > SUPPORT_LIMITS.escalateAboveIqd) throw new DriverError('refund_needs_escalation');
    const funder = await this.funderFor(input.faultParty, order, input.method);
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      await this.repo.lockCustomer(customerId, tx);
      if (await this.repo.entryByKey(`refund:${input.idempotencyKey}`, tx)) return;
      if (tier === 'agent') {
        const used = (await this.repo.refundsBy(actor.personId, startOfLocalDay(now), tx)).reduce((a, e) => a + (e.amountIqd ?? 0), 0);
        if (used + input.amountIqd > SUPPORT_LIMITS.agentDailyCapIqd) throw new DriverError('refund_over_agent_limit');
      }
      if (tier !== 'admin' && (await this.customerCredits(customerId, now, tx)) + input.amountIqd > SUPPORT_LIMITS.customerMonthlyCapIqd) throw new DriverError('refund_customer_cap');
      if (order && (await this.refundedOnOrder(order.id, tx)) + input.amountIqd > order.totalIqd) throw new DriverError('refund_exceeds_order');
      const groupId = `support:${ticket.id}:${input.idempotencyKey}`;
      const posted = await this.credits.credit({ groupId, ticketId: ticket.id, customerId, orderId: order?.id ?? null, amountIqd: input.amountIqd, method: input.method, funder, occurredAt: now }, tx);
      const text = input.method === 'points' ? `${posted.points ?? 0} نقطة (${input.amountIqd.toLocaleString('en-US')} دينار)` : `${input.amountIqd.toLocaleString('en-US')} دينار رصيد بالمحفظة`;
      await this.repo.addEntry(
        { ticketId: ticket.id, actorId: actor.personId, kind: 'refund', text: input.note ? `${text} — ${input.note}` : text, amountIqd: input.amountIqd, meta: { method: input.method, faultParty: input.faultParty, funder: funder.kind, ledgerGroupId: groupId, points: posted.points }, idempotencyKey: `refund:${input.idempotencyKey}`, at: now },
        tx,
      );
      await this.touch(ticket, actor, { refundedIqd: ticket.refundedIqd + input.amountIqd, ...(input.faultParty !== 'platform' ? { faultParty: input.faultParty } : {}) }, tx);
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'support.refunded', occurredAt: now, ...(order ? { orderId: order.id } : {}), payload: { ticketId: ticket.id, customerId, amountIqd: input.amountIqd, method: input.method, faultParty: input.faultParty, ledgerGroupId: groupId } },
        { name: 'support_ticket', id: ticket.id },
      );
      await this.audits.record(
        { cityId: ticket.cityId, actorId: actor.personId, action: 'ticket.refund', subjectKind: 'ticket', subjectId: ticket.id, summaryAr: `تعويض ${text} على ${faultAr(input.faultParty)}`, detail: { amountIqd: input.amountIqd, method: input.method, faultParty: input.faultParty, ledgerGroupId: groupId } },
        tx,
      );
    });
    return this.get(actor, { ticketId: ticket.id });
  }

  /** Wallet refunds are funded by the party at fault (the courier's earnings, the merchant's cash account); points always by the platform. */
  private async funderFor(fault: FaultParty, order: Order | null, method: 'wallet' | 'points'): Promise<SupportCreditFunder> {
    if (method === 'points' || !order) return { kind: 'platform' };
    if (fault === 'courier') {
      const c = await this.trips.courierOf(order.id).catch(() => null);
      if (c) return { kind: 'courier', driverId: c.courierId };
    }
    if (fault === 'merchant' && order.merchantOrgId) return { kind: 'merchant', merchantId: order.merchantOrgId };
    return { kind: 'platform' };
  }

  async attributeFault(actor: Actor, input: z.output<typeof TicketFaultInput>): Promise<TicketCase> {
    const ticket = await this.load(input.ticketId);
    const now = this.clock.now();
    const courier = ticket.orderId ? await this.trips.courierOf(ticket.orderId).catch(() => null) : null;
    const order = ticket.orderId ? await this.orders.get(ticket.orderId).catch(() => null) : null;
    await this.uow.run(async (tx) => {
      await this.repo.addEntry({ ticketId: ticket.id, actorId: actor.personId, kind: 'fault', text: input.note, amountIqd: null, meta: { faultParty: input.faultParty }, idempotencyKey: null, at: now }, tx);
      await this.touch(ticket, actor, { faultParty: input.faultParty }, tx);
      // Scores and the merchant's dispute rate read this (scoring & safety; edge-case 593).
      await this.events.emit(
        tx,
        {
          actorId: actor.personId,
          type: 'support.fault_attributed',
          occurredAt: now,
          ...(ticket.orderId ? { orderId: ticket.orderId } : {}),
          ...(ticket.tripId ? { tripId: ticket.tripId } : {}),
          payload: { ticketId: ticket.id, faultParty: input.faultParty, courierId: input.faultParty === 'courier' ? (courier?.courierId ?? null) : null, merchantOrgId: input.faultParty === 'merchant' ? (order?.merchantOrgId ?? null) : null, note: input.note },
        },
        { name: 'support_ticket', id: ticket.id },
      );
      await this.audits.record({ cityId: ticket.cityId, actorId: actor.personId, action: 'ticket.fault', subjectKind: 'ticket', subjectId: ticket.id, summaryAr: `الخطأ على ${faultAr(input.faultParty)}: ${input.note}` }, tx);
    });
    return this.get(actor, { ticketId: ticket.id });
  }

  async escalate(actor: Actor, input: z.output<typeof TicketEscalateInput>): Promise<TicketCase> {
    const ticket = await this.load(input.ticketId);
    if (ticket.status === 'resolved') throw new DriverError('ticket_closed');
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      await this.repo.addEntry({ ticketId: ticket.id, actorId: actor.personId, kind: 'escalate', text: input.reason, amountIqd: null, meta: { to: 'admin' }, idempotencyKey: null, at: now }, tx);
      await this.touch(ticket, actor, { status: 'escalated', escalatedTo: 'admin', escalatedAt: now }, tx);
      // Paged to the escalation owner (Ali or the deputy on duty, edge-case 146) through notify.
      await this.events.emit(tx, { actorId: actor.personId, type: 'support.escalated', occurredAt: now, ...(ticket.orderId ? { orderId: ticket.orderId } : {}), payload: { ticketId: ticket.id, to: 'admin', reason: input.reason } }, { name: 'support_ticket', id: ticket.id });
      await this.audits.record({ cityId: ticket.cityId, actorId: actor.personId, action: 'ticket.escalate', subjectKind: 'ticket', subjectId: ticket.id, summaryAr: `صعّد التذكرة: ${input.reason}` }, tx);
    });
    return this.get(actor, { ticketId: ticket.id });
  }

  async resolve(actor: Actor, input: z.output<typeof TicketResolveInput>): Promise<TicketCase> {
    const ticket = await this.load(input.ticketId);
    if (ticket.status === 'resolved') throw new DriverError('ticket_closed');
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      await this.repo.addEntry({ ticketId: ticket.id, actorId: actor.personId, kind: 'resolve', text: input.resolution, amountIqd: null, meta: {}, idempotencyKey: null, at: now }, tx);
      await this.touch(ticket, actor, { status: 'resolved', resolvedAt: now, resolution: input.resolution, firstResponseAt: ticket.firstResponseAt ?? now }, tx);
      // "هل انحلت مشكلتك؟" goes to the customer with the resolution (support spec §2).
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'support.resolved', occurredAt: now, ...(ticket.orderId ? { orderId: ticket.orderId } : {}), payload: { ticketId: ticket.id, customerId: ticket.customerId, refundedIqd: ticket.refundedIqd, faultParty: ticket.faultParty, survey: true } },
        { name: 'support_ticket', id: ticket.id },
      );
      await this.audits.record({ cityId: ticket.cityId, actorId: actor.personId, action: 'ticket.resolve', subjectKind: 'ticket', subjectId: ticket.id, summaryAr: `حلّ التذكرة: ${input.resolution.slice(0, 80)}` }, tx);
    });
    return this.get(actor, { ticketId: ticket.id });
  }
}

function faultAr(f: FaultParty): string {
  return { none: 'ماكو طرف', courier: 'المندوب', merchant: 'المطعم', platform: 'درايفر', customer: 'الزبون' }[f];
}

function toLog(e: StoredEvent): EventLogEntry {
  return {
    id: e.id,
    actorId: e.actorId,
    type: e.type,
    occurredAt: e.occurredAt,
    recordedAt: e.recordedAt,
    ...(e.location ? { location: e.location } : {}),
    ...(e.tripId ? { tripId: e.tripId } : {}),
    ...(e.orderId ? { orderId: e.orderId } : {}),
    payload: e.payload,
    aggregate: e.aggregate,
    aggregateId: e.aggregateId,
    skewMs: e.skewMs,
    flagged: e.flagged,
    quarantined: e.quarantined,
  };
}
