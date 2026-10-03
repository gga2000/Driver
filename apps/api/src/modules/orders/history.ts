import { OrderState, TERMINAL_ORDER_STATES, type OrderSummary } from '@driver/contracts';
import type { OrderRecord } from './orders.repository.js';

/**
 * Read-side helpers for the Console's order history: the lateness rule, the summary row and the
 * keyset cursor. Pure.
 */

/** Past the kitchen's promised ready time by this much and still not picked up → late. */
export const LATE_PICKUP_GRACE_MIN = 5;
/** Not delivered this long after placement (or after its scheduled time) → late. */
export const LATE_DELIVERY_MIN = 60;

/** States in which lateness no longer applies: done, failed, cancelled or under dispute. */
const SETTLED: ReadonlySet<OrderState> = new Set<OrderState>([...TERMINAL_ORDER_STATES, 'delivered', 'completed', 'disputed']);

/** Every state that is not terminal (the live board's orders). */
export const ACTIVE_ORDER_STATES: readonly OrderState[] = OrderState.options.filter((s) => !TERMINAL_ORDER_STATES.includes(s));

type LateFields = Pick<OrderRecord, 'state' | 'placedAt' | 'scheduledFor' | 'promisedReadyAt' | 'pickedUpAt'>;

export function isLate(o: LateFields, now: Date): boolean {
  if (SETTLED.has(o.state)) return false;
  const t = now.getTime();
  if (o.promisedReadyAt && !o.pickedUpAt && t > o.promisedReadyAt.getTime() + LATE_PICKUP_GRACE_MIN * 60_000) return true;
  const start = Math.max(o.placedAt.getTime(), o.scheduledFor?.getTime() ?? 0);
  return t > start + LATE_DELIVERY_MIN * 60_000;
}

export function toSummary(o: OrderRecord, now: Date): OrderSummary {
  return {
    id: o.id,
    cityId: o.cityId,
    type: o.type,
    state: o.state,
    ordererId: o.ordererId,
    merchantOrgId: o.merchantOrgId,
    paymentMethod: o.paymentMethod,
    totalIqd: o.totalIqd,
    placedAt: o.placedAt,
    acceptedAt: o.acceptedAt,
    promisedReadyAt: o.promisedReadyAt,
    pickedUpAt: o.pickedUpAt,
    deliveredAt: o.deliveredAt,
    closedAt: o.closedAt,
    cancelledAt: o.cancelledAt,
    late: isLate(o, now),
  };
}

/** Keyset position in the newest-first order: (placedAt, id), both descending. */
export interface OrderCursor {
  placedAt: Date;
  id: string;
}

export function encodeCursor(o: Pick<OrderRecord, 'placedAt' | 'id'>): string {
  return `${o.placedAt.getTime().toString(36)}.${o.id}`;
}

/** Null for anything that is not a cursor this module issued (treated as "from the start"). */
export function decodeCursor(raw: string | undefined): OrderCursor | null {
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;
  const ms = parseInt(raw.slice(0, dot), 36);
  if (!Number.isFinite(ms)) return null;
  return { placedAt: new Date(ms), id: raw.slice(dot + 1) };
}

/** True when `o` comes strictly after `c` in newest-first order. */
export function isAfterCursor(o: Pick<OrderRecord, 'placedAt' | 'id'>, c: OrderCursor): boolean {
  const a = o.placedAt.getTime();
  const b = c.placedAt.getTime();
  return a < b || (a === b && o.id < c.id);
}

export function newestFirst(a: Pick<OrderRecord, 'placedAt' | 'id'>, b: Pick<OrderRecord, 'placedAt' | 'id'>): number {
  return b.placedAt.getTime() - a.placedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}
