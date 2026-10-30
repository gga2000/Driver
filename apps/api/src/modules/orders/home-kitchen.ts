import { HOME_KITCHEN_RULES, isReserveSlot, readyLeft, slotKey, type HomeSale, type HomeTally } from '@driver/contracts';
import type { OrderAggregate } from './orders.repository.js';

/** Orders that did not happen give their plates back. */
const NOT_COUNTED = new Set(['merchant_rejected', 'customer_cancelled', 'platform_cancelled', 'refunded', 'failed']);

/** How far back a kitchen's orders can still hold plates: the booking window and the day before it. */
export function homeTallySince(now: Date): Date {
  return new Date(now.getTime() - (HOME_KITCHEN_RULES.bookDays + 1) * 86_400_000);
}

/**
 * أكل بيت: the plates a home kitchen's live orders hold — a pre-order still to come holds its plates
 * at its pickup time (`slotKey`), an order for now holds ready plates from when it was placed.
 */
export function homeTally(orders: readonly OrderAggregate[], now: Date): HomeTally {
  const slots = new Map<string, Map<string, number>>();
  const sold = new Map<string, { at: Date; qty: number }[]>();
  for (const agg of orders) {
    if (NOT_COUNTED.has(agg.order.state)) continue;
    const at = agg.order.scheduledFor;
    if (at && at.getTime() < now.getTime()) continue;
    for (const l of agg.lines) {
      if (!l.catalogItemId || l.substitution?.state === 'removed') continue;
      if (at) {
        const key = slotKey(at);
        const byTime = slots.get(l.catalogItemId) ?? new Map<string, number>();
        byTime.set(key, (byTime.get(key) ?? 0) + l.qty);
        slots.set(l.catalogItemId, byTime);
      } else {
        const list = sold.get(l.catalogItemId) ?? [];
        list.push({ at: agg.order.placedAt, qty: l.qty });
        sold.set(l.catalogItemId, list);
      }
    }
  }
  return { slots, sold };
}

/** One dish of an order at a home kitchen, as its menu sells it. */
export interface HomeOrderLine {
  itemId: string;
  qty: number;
  sale: HomeSale | null;
  stock: number | null;
}

/**
 * Why an order at a home kitchen can't go in; null when it can. A ready dish comes now, only from the
 * plates still free today; a reserved dish comes at one of its own pickup times, never past the plates
 * she takes for that time. One order is all ready or all reserved (they come at different times).
 */
export function homeOrderProblem(lines: readonly HomeOrderLine[], scheduledFor: Date | null, now: Date, tally: HomeTally): 'order_schedule_invalid' | 'catalog_item_unavailable' | null {
  if (lines.length === 0) return null;
  const qty = new Map<string, { sale: HomeSale | null; stock: number | null; qty: number }>();
  for (const l of lines) {
    const prev = qty.get(l.itemId);
    qty.set(l.itemId, { sale: l.sale, stock: l.stock, qty: (prev?.qty ?? 0) + l.qty });
  }
  const modes = new Set([...qty.values()].map((d) => d.sale?.mode ?? 'none'));
  if (modes.size !== 1 || modes.has('none')) return 'order_schedule_invalid';
  for (const [itemId, d] of qty) {
    const sale = d.sale!;
    if (sale.mode === 'ready') {
      if (scheduledFor) return 'order_schedule_invalid';
      if (d.qty > readyLeft(sale, d.stock, now, tally.sold.get(itemId))) return 'catalog_item_unavailable';
    } else {
      if (!scheduledFor || !isReserveSlot(sale.rule, now, scheduledFor)) return 'order_schedule_invalid';
      const booked = tally.slots.get(itemId)?.get(slotKey(scheduledFor)) ?? 0;
      if (booked + d.qty > sale.rule.maxPerSlot) return 'order_schedule_invalid';
    }
  }
  return null;
}

/** The pickup times a home kitchen has to cook for: per time and dish, the plates and how many orders. */
export function homeReservations(orders: readonly OrderAggregate[], now: Date): Array<{ at: Date; itemId: string; plates: number; orders: number }> {
  const byKey = new Map<string, { at: Date; itemId: string; plates: number; orders: Set<string> }>();
  for (const agg of orders) {
    const at = agg.order.scheduledFor;
    if (!at || at.getTime() < now.getTime() || NOT_COUNTED.has(agg.order.state)) continue;
    for (const l of agg.lines) {
      if (!l.catalogItemId || l.substitution?.state === 'removed') continue;
      const key = `${slotKey(at)}|${l.catalogItemId}`;
      const row = byKey.get(key) ?? { at, itemId: l.catalogItemId, plates: 0, orders: new Set<string>() };
      row.plates += l.qty;
      row.orders.add(agg.order.id);
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].map((r) => ({ at: r.at, itemId: r.itemId, plates: r.plates, orders: r.orders.size })).sort((a, b) => a.at.getTime() - b.at.getTime() || a.itemId.localeCompare(b.itemId));
}
