import type { EventLogEntry, Order, OrderLedgerLine, OrderLine, OrderSearchInput, OrderState, OrderSummary, OrderType, Participant, PaymentMethod } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { periodRange, type Period } from './periods';

/** Pure helpers for the orders list and the order detail page. */

export type StateTone = 'live' | 'ready' | 'done' | 'bad' | 'warn' | 'neutral';

/**
 * Tone by phase (K-17), so the table scans for trouble: waiting on someone `warn`, moving `live`,
 * finished well `done`, a problem `bad`. Cancelled by the customer is an outcome, not trouble, so it
 * stays `neutral`; so does a refund after the fact.
 */
export const ORDER_STATE_TONE: Readonly<Record<OrderState, StateTone>> = {
  placed: 'warn',
  merchant_accepted: 'live',
  preparing: 'live',
  ready: 'live',
  picked_up: 'live',
  matched: 'live',
  delivered: 'done',
  completed: 'done',
  closed: 'done',
  merchant_rejected: 'bad',
  customer_cancelled: 'neutral',
  platform_cancelled: 'bad',
  refunded: 'neutral',
  disputed: 'bad',
  failed: 'bad',
};

/**
 * The stage an order is in, which picks the status chip's icon (K-17: colour, word and shape
 * together): waiting on the kitchen, in the kitchen, on the road, done, cancelled, or a problem.
 */
export type OrderPhase = 'waiting' | 'kitchen' | 'road' | 'done' | 'cancelled' | 'problem';

export const ORDER_PHASE: Readonly<Record<OrderState, OrderPhase>> = {
  placed: 'waiting',
  merchant_accepted: 'kitchen',
  preparing: 'kitchen',
  ready: 'kitchen',
  picked_up: 'road',
  matched: 'road',
  delivered: 'done',
  completed: 'done',
  closed: 'done',
  merchant_rejected: 'cancelled',
  customer_cancelled: 'cancelled',
  platform_cancelled: 'cancelled',
  refunded: 'cancelled',
  disputed: 'problem',
  failed: 'problem',
};

// ───────────────────────── saved views (/orders) ─────────────────────────

export const ACTIVE_STATES: readonly OrderState[] = ['placed', 'merchant_accepted', 'preparing', 'ready', 'picked_up', 'matched'];

/** The saved views over the list: each is a set of states (or the late rule) the server filters on. */
export const ORDER_VIEWS = {
  all: { states: null, late: false },
  active: { states: ACTIVE_STATES, late: false },
  late: { states: null, late: true },
  cancelled: { states: ['merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'failed'], late: false },
  disputes: { states: ['disputed', 'refunded'], late: false },
} as const satisfies Record<string, { states: readonly OrderState[] | null; late: boolean }>;
export type OrderView = keyof typeof ORDER_VIEWS;
export const ORDER_VIEW_KEYS = Object.keys(ORDER_VIEWS) as OrderView[];

export interface ListFilter {
  view: OrderView;
  period: Period;
  type: OrderType | 'all';
  merchantOrgId: string;
  zoneKey: string;
  payment: PaymentMethod | 'all';
  q: string;
}

export const EMPTY_FILTER: ListFilter = { view: 'all', period: { preset: 'today' }, type: 'all', merchantOrgId: '', zoneKey: '', payment: 'all', q: '' };

/** How many of the narrowing filters (not the view or the period) are set: "مسح" shows from 1. */
export function activeFilterCount(f: ListFilter): number {
  return [f.type !== 'all', Boolean(f.merchantOrgId), Boolean(f.zoneKey), f.payment !== 'all'].filter(Boolean).length;
}

/**
 * `orders.search` input for a view + filters. An order number ("1284", "#1284") ignores the period:
 * the API then looks over today and yesterday, the way people ask about an order on the phone. The
 * late view ignores it too: an order is late now, whenever it was placed.
 */
export function listInput(cityId: string, f: ListFilter, now: Date, ticket: boolean, limit = 50): OrderSearchInput {
  const view = ORDER_VIEWS[f.view];
  const text = f.q.trim();
  // An order number, or the late view (lateness is about now), ignores the period.
  const range = ticket || view.late ? {} : periodRange(f.period, now);
  return {
    cityId,
    limit,
    ...(view.states ? { states: [...view.states] } : {}),
    ...(view.late ? { late: true } : {}),
    ...(f.type !== 'all' ? { type: f.type } : {}),
    ...(f.merchantOrgId ? { merchantOrgId: f.merchantOrgId } : {}),
    ...(f.zoneKey ? { zoneKey: f.zoneKey } : {}),
    ...(f.payment !== 'all' ? { paymentMethod: f.payment } : {}),
    ...(text ? { text } : {}),
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
  };
}

export type ListSort = 'newest' | 'late';

/** Newest first (the server's order), or the latest first and the rest after them, newest first. */
export function sortSummaries(rows: readonly OrderSummary[], sort: ListSort): OrderSummary[] {
  if (sort === 'newest') return [...rows];
  return [...rows].sort((a, b) => (b.lateMin ?? -1) - (a.lateMin ?? -1) || b.placedAt.getTime() - a.placedAt.getTime());
}

/** Filter chips on the list, each a set of states. */
export const STATE_FILTERS = {
  all: null,
  waiting_merchant: ['placed'],
  kitchen: ['merchant_accepted', 'preparing', 'ready'],
  on_the_way: ['picked_up', 'matched'],
  delivered: ['delivered', 'completed', 'closed'],
  problem: ['disputed', 'failed', 'merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'refunded'],
} as const satisfies Record<string, readonly OrderState[] | null>;
export type StateFilter = keyof typeof STATE_FILTERS;

export interface OrderFilter {
  state: StateFilter;
  type: OrderType | 'all';
  /** Matches order id, merchant id or orderer id (case-insensitive substring). */
  q: string;
}

export function filterOrders(orders: readonly Order[], f: OrderFilter): Order[] {
  const states = STATE_FILTERS[f.state] as readonly OrderState[] | null;
  const q = f.q.trim().toLowerCase();
  return orders
    .filter((o) => (states ? states.includes(o.state) : true))
    .filter((o) => (f.type === 'all' ? true : o.type === f.type))
    .filter((o) => (q ? [o.id, o.merchantOrgId ?? '', o.ordererId].some((s) => s.toLowerCase().includes(q)) : true))
    .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime());
}

/** The history filter: the chips and search box plus an optional placement window. */
export interface HistoryFilter extends OrderFilter {
  from: Date | null;
  to: Date | null;
}

/** `orders.search` input for the list's filter (server-side: history, not only active orders). */
export function searchInput(cityId: string, f: HistoryFilter, limit = 50): OrderSearchInput {
  const states = STATE_FILTERS[f.state] as readonly OrderState[] | null;
  const text = f.q.trim();
  return {
    cityId,
    limit,
    ...(states ? { states: [...states] } : {}),
    ...(f.type !== 'all' ? { type: f.type } : {}),
    ...(text ? { text } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
  };
}

/** Count per filter chip, for the chip badges. */
export function countByFilter(orders: readonly Order[]): Record<StateFilter, number> {
  const out = {} as Record<StateFilter, number>;
  for (const key of Object.keys(STATE_FILTERS) as StateFilter[]) {
    const states = STATE_FILTERS[key] as readonly OrderState[] | null;
    out[key] = states ? orders.filter((o) => states.includes(o.state)).length : orders.length;
  }
  return out;
}

// ───────────────────────── timeline ─────────────────────────

export const TIMELINE_STEPS = [
  'scheduled',
  'placed',
  'merchant_offered',
  'accepted',
  'preparing',
  'ready',
  'picked_up',
  'delivered',
  'closed',
  'cancelled',
] as const;
export type TimelineStep = (typeof TIMELINE_STEPS)[number];

export interface TimelineEntry {
  step: TimelineStep;
  at: Date;
  /** Minutes from `placed`; negative for a schedule ahead of placement. */
  offsetMin: number;
}

/**
 * The order's history from its timestamps (the API exposes no per-order event log yet), oldest
 * first. Ties keep the machine order.
 */
export function orderTimeline(o: Order): TimelineEntry[] {
  const raw: [TimelineStep, Date | null][] = [
    ['scheduled', o.scheduledFor],
    ['placed', o.placedAt],
    ['merchant_offered', o.merchantOfferedAt],
    ['accepted', o.acceptedAt],
    ['preparing', o.preparingAt],
    ['ready', o.readyAt],
    ['picked_up', o.pickedUpAt],
    ['delivered', o.deliveredAt],
    ['closed', o.closedAt],
    ['cancelled', o.cancelledAt],
  ];
  const t0 = o.placedAt.getTime();
  return raw
    .filter((r): r is [TimelineStep, Date] => r[1] !== null)
    .map(([step, at]) => ({ step, at, offsetMin: Math.round((at.getTime() - t0) / 60_000) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || TIMELINE_STEPS.indexOf(a.step) - TIMELINE_STEPS.indexOf(b.step));
}

// ───────────────────────── lines by person ─────────────────────────

export interface LineGroup {
  /** null = the orderer's own lines (untagged). */
  participant: Participant | null;
  lines: OrderLine[];
  subtotalIqd: number;
}

export function lineTotal(l: Pick<OrderLine, 'qty' | 'unitPriceIqd' | 'availability'>): number {
  return l.availability === 'removed' ? 0 : l.qty * l.unitPriceIqd;
}

/** Lines grouped by the participant they're tagged to; the orderer's untagged lines come first. */
export function groupLinesByParticipant(o: Pick<Order, 'lines' | 'participants'>): LineGroup[] {
  const groups = new Map<string | null, LineGroup>();
  const known = new Map(o.participants.map((p) => [p.id, p]));
  for (const line of o.lines) {
    const key = line.participantId && known.has(line.participantId) ? line.participantId : null;
    let g = groups.get(key);
    if (!g) {
      g = { participant: key ? known.get(key)! : null, lines: [], subtotalIqd: 0 };
      groups.set(key, g);
    }
    g.lines.push(line);
    g.subtotalIqd += lineTotal(line);
  }
  // Participants with no lines still show (a rider, a parcel recipient).
  for (const p of o.participants) if (!groups.has(p.id)) groups.set(p.id, { participant: p, lines: [], subtotalIqd: 0 });
  const own = groups.get(null);
  return [...(own ? [own] : []), ...[...groups.entries()].filter(([k]) => k !== null).map(([, g]) => g)];
}

// ───────────────────────── price components ─────────────────────────

export type PriceKey = 'items' | 'delivery' | 'service' | 'small_order' | 'discount' | 'points' | 'tip' | 'cancellation_fee';

export interface PriceRow {
  key: PriceKey;
  amountIqd: number;
}

/** The money rows on the order, signed (discount negative), zero rows dropped except items. */
export function priceRows(o: Order): PriceRow[] {
  const rows: PriceRow[] = [
    { key: 'items', amountIqd: o.itemsTotalIqd },
    { key: 'delivery', amountIqd: o.deliveryFeeIqd },
    { key: 'service', amountIqd: o.serviceFeeIqd },
    // J-D6 small-order fee and W-02 points spent (delivery first, then service fee).
    { key: 'small_order', amountIqd: o.smallOrderFeeIqd ?? 0 },
    { key: 'discount', amountIqd: -Math.abs(o.discountIqd) },
    { key: 'points', amountIqd: -Math.abs(o.pointsIqd ?? 0) },
    { key: 'tip', amountIqd: o.tipIqd },
    { key: 'cancellation_fee', amountIqd: o.cancellationFeeIqd },
  ];
  return rows.filter((r) => r.key === 'items' || r.amountIqd !== 0);
}

/** Sum of the shown rows, excluding the cancellation fee, vs the order's stored total. */
export function priceCheck(o: Order): { sumIqd: number; matches: boolean } {
  const sumIqd = priceRows(o)
    .filter((r) => r.key !== 'cancellation_fee')
    .reduce((s, r) => s + r.amountIqd, 0);
  return { sumIqd, matches: sumIqd === o.totalIqd };
}

// ───────────────────────── event log ─────────────────────────

export interface LogEntry {
  id: string;
  type: string;
  /** Arabic label, or the raw type when no string exists yet. */
  label: string;
  /** Device time of the action (what the actor saw). */
  at: Date;
  recordedAt: Date;
  /** Minutes from the first entry. */
  offsetMin: number;
  actorId: string;
  quarantined: boolean;
  quarantineReason: string | null;
  flagged: boolean;
  flagReason: string | null;
  tripId: string | null;
}

/** `order.picked_up` → "استلم السايق الطلب", falling back to the type itself. */
export function eventLabel(type: string): string {
  const key = `console.ev_${type.replace(/[^a-z0-9]+/gi, '_')}` as MessageKey;
  const label = t(key);
  return label === key ? type : label;
}

/**
 * The actor event log as a timeline: merged (order + trip logs share events), de-duplicated by id,
 * in recording order. Quarantined late replays stay in, marked.
 */
export function eventTimeline(...logs: ReadonlyArray<readonly EventLogEntry[]>): LogEntry[] {
  const byId = new Map<string, EventLogEntry>();
  for (const log of logs) for (const e of log) if (!byId.has(e.id)) byId.set(e.id, e);
  const events = [...byId.values()].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime() || a.id.localeCompare(b.id));
  const t0 = events[0]?.occurredAt.getTime() ?? 0;
  return events.map((e) => ({
    id: e.id,
    type: e.type,
    label: eventLabel(e.type),
    at: e.occurredAt,
    recordedAt: e.recordedAt,
    offsetMin: Math.round((e.occurredAt.getTime() - t0) / 60_000),
    actorId: e.actorId,
    quarantined: e.quarantined,
    quarantineReason: e.quarantineReason ?? null,
    flagged: e.flagged,
    flagReason: e.flagReason ?? null,
    tripId: e.tripId ?? null,
  }));
}

// ───────────────────────── the order's story (K-22) ─────────────────────────

export type StoryKey = 'placed' | 'accepted' | 'picked_up' | 'delivered' | 'cancelled';

export interface StoryStep {
  key: StoryKey;
  /** Null: not yet (the next thing the order is waiting for). */
  at: Date | null;
  /** Minutes since the step before (null for the first one and for steps not reached). */
  sinceMin: number | null;
}

const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60_000));

/**
 * The four moments people ask about, from the order's own timestamps: انطلب · قبله المطعم · طلع
 * الدليفري · وصل. Orders without a kitchen (rides, parcels) skip the second. A cancelled order ends at
 * the cancellation; an open one ends with the next step, waiting (`at: null`).
 */
export function orderStory(o: Pick<Order, 'merchantOrgId' | 'placedAt' | 'acceptedAt' | 'pickedUpAt' | 'deliveredAt' | 'cancelledAt'>): StoryStep[] {
  const raw: Array<[StoryKey, Date | null]> = [['placed', o.placedAt]];
  if (o.merchantOrgId !== null) raw.push(['accepted', o.acceptedAt]);
  raw.push(['picked_up', o.pickedUpAt], ['delivered', o.deliveredAt]);
  const steps: StoryStep[] = [];
  let prev: Date | null = null;
  for (const [key, at] of raw) {
    if (o.cancelledAt && !at) break;
    steps.push({ key, at, sinceMin: at && prev ? minutesBetween(prev, at) : null });
    if (!at) break;
    prev = at;
  }
  if (o.cancelledAt) steps.push({ key: 'cancelled', at: o.cancelledAt, sinceMin: prev ? minutesBetween(prev, o.cancelledAt) : null });
  return steps;
}

/** Placement to the door (or to the cancellation), in minutes; null while the order is open. */
export function storyTotalMin(steps: readonly StoryStep[]): number | null {
  const first = steps[0]?.at;
  const last = steps.at(-1);
  if (!first || !last?.at || (last.key !== 'delivered' && last.key !== 'cancelled')) return null;
  return minutesBetween(first, last.at);
}

export interface DispatchSummary {
  /** Offers sent. */
  offered: number;
  /** Offers that ran out or were declined. */
  missed: number;
  /** Who took it, and how long after dispatch started; null while nobody has. */
  acceptedBy: string | null;
  acceptedAfterSec: number | null;
  /** A dispatcher assigned it by hand. */
  manual: boolean;
}

/** K-22: the dispatch noise as one line ("عرضناه على 3 سواق · 2 ما قبلوا · قبله حيدر بعد 40 ثانية"). */
export function dispatchSummary(entries: readonly Pick<LogEntry, 'type' | 'at' | 'actorId'>[]): DispatchSummary | null {
  const started = entries.find((e) => e.type === 'dispatch.requested' || e.type === 'trip.created');
  const offers = entries.filter((e) => e.type === 'dispatch.offer_sent');
  const missed = entries.filter((e) => e.type === 'dispatch.offer_timed_out' || e.type === 'dispatch.offer_declined');
  const accepted = entries.find((e) => e.type === 'trip.accepted');
  if (!started && offers.length === 0 && !accepted) return null;
  return {
    offered: Math.max(offers.length, accepted ? 1 : 0),
    missed: missed.length,
    acceptedBy: accepted?.actorId ?? null,
    acceptedAfterSec: accepted && started ? Math.max(0, Math.round((accepted.at.getTime() - started.at.getTime()) / 1000)) : null,
    manual: entries.some((e) => e.type === 'dispatch.override'),
  };
}

// ───────────────────────── money in words (K-16) ─────────────────────────

export type MoneyParty = 'merchant' | 'courier' | 'courier_cash' | 'platform' | 'customer' | 'bank' | 'other';

/** Which side of the order a ledger account is. */
export function partyOf(account: string): MoneyParty {
  if (account.startsWith('merchant_cash:') || account.startsWith('merchant:')) return 'merchant';
  if (account.startsWith('cash:')) return 'courier_cash';
  if (account.startsWith('driver:')) return 'courier';
  if (account === 'platform' || account === 'rounding' || account.startsWith('promo:')) return 'platform';
  if (account.startsWith('customer:') || account.startsWith('household:')) return 'customer';
  if (account === 'bank') return 'bank';
  return 'other';
}

export type MoneyHead = 'on_courier' | 'commission' | 'to_merchant' | 'to_courier' | 'to_customer' | 'to_platform' | 'other';

export interface MoneyLine {
  id: string;
  head: MoneyHead;
  /** The ledger's own label for the line ("مستحق المطعم"). */
  label: string;
  amountIqd: number;
  at: Date;
}

/**
 * Each posting of the order said as where the money ends up, never with a minus sign: cash the
 * courier took from the customer is "على الدليفري" (he owes it on), the platform's take "عمولة درايفر",
 * what the kitchen is owed "للمطعم", a refund "للزبون". Points lines are not money and are left out.
 */
export function moneyLines(lines: readonly OrderLedgerLine[]): MoneyLine[] {
  const out: MoneyLine[] = [];
  for (const l of lines) {
    if (l.type.startsWith('points') || l.type === 'organizer_bonus' || l.type === 'referral_bonus') continue;
    const to = partyOf(l.toAccount);
    const from = partyOf(l.fromAccount);
    let head: MoneyHead;
    if (l.type === 'cash_collected' || from === 'courier_cash') head = 'on_courier';
    else if (l.type === 'commission_accrued' || (to === 'platform' && from !== 'customer')) head = 'commission';
    else if (to === 'merchant') head = 'to_merchant';
    else if (to === 'courier' || to === 'courier_cash') head = 'to_courier';
    else if (to === 'customer') head = 'to_customer';
    else if (to === 'platform') head = 'to_platform';
    else head = 'other';
    out.push({ id: l.id, head, label: l.label_ar, amountIqd: l.amountIqd, at: l.at });
  }
  return out;
}
