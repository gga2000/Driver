import type { Order, OrderLine, OrderState, OrderType, Participant } from '@driver/contracts';

/** Pure helpers for the orders list and the order detail page. */

export type StateTone = 'live' | 'ready' | 'done' | 'bad' | 'warn';

export const ORDER_STATE_TONE: Readonly<Record<OrderState, StateTone>> = {
  placed: 'warn',
  merchant_accepted: 'live',
  preparing: 'live',
  ready: 'ready',
  picked_up: 'live',
  matched: 'live',
  delivered: 'done',
  completed: 'done',
  closed: 'done',
  merchant_rejected: 'bad',
  customer_cancelled: 'bad',
  platform_cancelled: 'bad',
  refunded: 'warn',
  disputed: 'warn',
  failed: 'bad',
};

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

export type PriceKey = 'items' | 'delivery' | 'service' | 'discount' | 'tip' | 'cancellation_fee';

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
    { key: 'discount', amountIqd: -Math.abs(o.discountIqd) },
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
