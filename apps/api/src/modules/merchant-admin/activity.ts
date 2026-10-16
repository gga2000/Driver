import { MERCHANT_ACTIVITY_MAX, type ActivityEntry, type ActivityKind, type MerchantActivity } from '@driver/contracts';
import type { StoredEvent } from '../events/index.js';
import { ticketNumber } from '../merchant/index.js';

/**
 * «مين سوّى شنو» (owner only): who accepted, rejected, marked ready, took «+5 د», handed over, or
 * marked a dish sold out / back on. Pure, so the event → row rules are unit-tested without the API.
 * The service reads the events (orders' and the store's own), the dish names and, in one batched
 * vault read, the names of the people who acted.
 */

/** Order events the feed reads (on the indexed `order_id`). */
export const ORDER_ACTIVITY_TYPES = ['order.accepted', 'order.auto_accepted', 'order.partial_proposed', 'order.rejected', 'order.ready', 'order.prep_extended', 'order.handed_over'] as const;
/** Store events the feed reads (aggregate `org`/<merchantOrgId>). */
export const ITEM_ACTIVITY_TYPES = ['item.sold_out', 'item.restocked'] as const;

const isSystem = (actorId: string) => actorId === 'system' || actorId.startsWith('system:');
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** What one event means on the feed; null for an event the feed does not show. */
export function activityKindOf(e: StoredEvent): ActivityKind | null {
  const p = e.payload ?? {};
  switch (e.type) {
    case 'order.accepted':
      // The customer approving a partial order records `order.accepted` with himself as actor: the
      // kitchen's own action was the `order.partial_proposed` before it.
      if (p['partial'] === true) return null;
      return p['auto'] === true || isSystem(e.actorId) ? 'auto_accept' : 'accept';
    case 'order.auto_accepted':
      return 'auto_accept';
    case 'order.partial_proposed':
      return 'partial';
    case 'order.rejected':
      return p['auto'] === true || p['reason'] === 'merchant_timeout' || isSystem(e.actorId) ? 'auto_reject' : 'reject';
    case 'order.ready':
      // The courier's pickup implies «جاهز» when nobody pressed it (`implied`, the courier as actor):
      // not a kitchen action, and never a courier's id on the owner's feed.
      return p['implied'] === true ? null : 'ready';
    case 'order.prep_extended':
      return 'extend';
    case 'order.handed_over':
      return 'hand_over';
    case 'item.sold_out':
      return 'sold_out';
    case 'item.restocked':
      return 'back_on';
    default:
      return null;
  }
}

const AUTO: ReadonlySet<ActivityKind> = new Set(['auto_accept', 'auto_reject']);

/**
 * The people whose names the feed needs: the actors of the shown, non-automatic entries. Every one
 * of these actions is gated to a role at the store (orders.merchant.* checks it per order; the menu
 * calls check it per store), so these ids are the store's present or past staff, never a customer or
 * a courier. Unique, for one batched vault read.
 */
export function activityActorIds(events: readonly StoredEvent[]): string[] {
  const out = new Set<string>();
  for (const e of events) {
    const kind = activityKindOf(e);
    if (kind && !AUTO.has(kind) && !isSystem(e.actorId)) out.add(e.actorId);
  }
  return [...out];
}

export interface ActivityNames {
  /** Dish names by catalog item id. */
  itemNames: ReadonlyMap<string, string>;
  /** Names by person id (vault); missing or null → the app shows «موظف سابق». */
  people: ReadonlyMap<string, string | null>;
  /** The viewer (his own entries are `you`). */
  viewerId: string;
}

/** One event as a feed row; null when the feed does not show it. */
export function activityEntry(e: StoredEvent, names: ActivityNames): ActivityEntry | null {
  const kind = activityKindOf(e);
  if (!kind) return null;
  const p = e.payload ?? {};
  const isItem = kind === 'sold_out' || kind === 'back_on';
  const orderId = isItem ? null : (e.orderId ?? (e.aggregate === 'order' ? e.aggregateId : null));
  const itemId = isItem ? str(p['itemId']) : null;
  const until = kind === 'sold_out' ? str(p['until']) : null;
  const who = AUTO.has(kind) || isSystem(e.actorId) ? null : { personId: e.actorId, name: names.people.get(e.actorId) ?? null, you: e.actorId === names.viewerId };
  return {
    at: e.occurredAt,
    kind,
    orderId,
    orderNumber: orderId ? ticketNumber(orderId) : null,
    dishName: itemId ? (names.itemNames.get(itemId) ?? null) : null,
    until: until ? new Date(until) : null,
    who,
    reason: kind === 'reject' || kind === 'auto_reject' ? (str(p['reason']) ?? (kind === 'auto_reject' ? 'merchant_timeout' : null)) : null,
  };
}

/** Rows for `events`, in the order given; events outside [from, to) (when set) are left out. */
export function activityEntries(events: readonly StoredEvent[], names: ActivityNames, window?: { from: Date; to: Date }): ActivityEntry[] {
  const out: ActivityEntry[] = [];
  for (const e of events) {
    if (window && (e.occurredAt.getTime() < window.from.getTime() || e.occurredAt.getTime() >= window.to.getTime())) continue;
    const row = activityEntry(e, names);
    if (row) out.push(row);
  }
  return out;
}

/** The day's feed: newest first, capped at `MERCHANT_ACTIVITY_MAX`. */
export function composeActivity(input: { merchantOrgId: string; localDate: string; events: readonly StoredEvent[]; names: ActivityNames; window: { from: Date; to: Date } }): MerchantActivity {
  const rows = activityEntries(input.events, input.names, input.window)
    .map((row, i) => ({ row, i }))
    // Newest first; the same instant keeps the later-recorded event first.
    .sort((a, b) => b.row.at.getTime() - a.row.at.getTime() || b.i - a.i)
    .slice(0, MERCHANT_ACTIVITY_MAX)
    .map((x) => x.row);
  return { merchantOrgId: input.merchantOrgId, localDate: input.localDate, entries: rows };
}
