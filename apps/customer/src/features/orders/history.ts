import { TERMINAL_ORDER_STATES, type Order, type OrderState } from '@driver/contracts';

/**
 * The طلباتي list as plain data (audit C-15 / C-44): what's running now pinned on top, then the rest
 * by day in Baghdad time ("اليوم", "أمس", then the weekday and date), and the short status word a
 * row shows (the full sentence stays on the order screen).
 */

/** Asia/Baghdad is UTC+3 all year (no DST). */
const BAGHDAD_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;

/** Days since the Unix epoch, in Baghdad. */
export function baghdadDay(d: Date): number {
  return Math.floor((d.getTime() + BAGHDAD_MS) / DAY_MS);
}

/** States after which an order is history (the list's "running now" section holds the rest). */
const DONE: ReadonlySet<OrderState> = new Set<OrderState>([...TERMINAL_ORDER_STATES, 'delivered', 'completed', 'disputed']);

export function isRunning(o: Pick<Order, 'state'>): boolean {
  return !DONE.has(o.state);
}

export type DayKey = { kind: 'today' } | { kind: 'yesterday' } | { kind: 'date'; weekday: number; day: number; month: number; year: number; thisYear: boolean };

/** Which day heading an order sits under, relative to `now` (both read in Baghdad time). */
export function dayKey(at: Date, now: Date): DayKey {
  const d = baghdadDay(at);
  const today = baghdadDay(now);
  if (d === today) return { kind: 'today' };
  if (d === today - 1) return { kind: 'yesterday' };
  const local = new Date(at.getTime() + BAGHDAD_MS);
  const nowLocal = new Date(now.getTime() + BAGHDAD_MS);
  return { kind: 'date', weekday: local.getUTCDay(), day: local.getUTCDate(), month: local.getUTCMonth() + 1, year: local.getUTCFullYear(), thisYear: local.getUTCFullYear() === nowLocal.getUTCFullYear() };
}

export interface HistorySection<T> {
  /** 'running' or the Baghdad day number. */
  id: string;
  running: boolean;
  day: DayKey | null;
  rows: T[];
}

/** Running orders first (newest first), then one section per Baghdad day, newest day first. */
export function sectionByDay<T extends { order: Pick<Order, 'state' | 'placedAt'> }>(rows: readonly T[], now: Date): HistorySection<T>[] {
  const sorted = [...rows].sort((a, b) => b.order.placedAt.getTime() - a.order.placedAt.getTime());
  const out: HistorySection<T>[] = [];
  const running = sorted.filter((r) => isRunning(r.order));
  if (running.length > 0) out.push({ id: 'running', running: true, day: null, rows: running });
  for (const r of sorted) {
    if (isRunning(r.order)) continue;
    const id = String(baghdadDay(r.order.placedAt));
    const last = out[out.length - 1];
    if (last && last.id === id) last.rows.push(r);
    else out.push({ id, running: false, day: dayKey(r.order.placedAt, now), rows: [r] });
  }
  return out;
}

export type ShortStatus = 'waiting' | 'accepted' | 'preparing' | 'on_the_way' | 'searching' | 'driver_coming' | 'delivered' | 'done' | 'rejected' | 'cancelled' | 'refunded' | 'disputed' | 'failed';

/** One or two words for the list pill ("وصل", "انلغى", "دا يتحضّر"). */
export function shortStatus(o: Pick<Order, 'state' | 'type'>): ShortStatus {
  const ride = o.type === 'ride';
  switch (o.state) {
    case 'placed':
      return ride ? 'searching' : 'waiting';
    case 'merchant_accepted':
      return 'accepted';
    case 'preparing':
    case 'ready':
      return 'preparing';
    case 'picked_up':
      return 'on_the_way';
    case 'matched':
      return 'driver_coming';
    case 'delivered':
    case 'completed':
      return 'delivered';
    case 'closed':
      return 'done';
    case 'merchant_rejected':
      return 'rejected';
    case 'customer_cancelled':
    case 'platform_cancelled':
      return 'cancelled';
    case 'refunded':
      return 'refunded';
    case 'disputed':
      return 'disputed';
    default:
      return 'failed';
  }
}

/** A food order that reached the customer can be ordered again (C-15). */
export function canReorder(o: Pick<Order, 'type' | 'state' | 'merchantOrgId'>): boolean {
  if ((o.type !== 'food' && o.type !== 'grocery_catalog') || !o.merchantOrgId) return false;
  return o.state === 'delivered' || o.state === 'closed' || o.state === 'completed' || o.state === 'disputed' || o.state === 'refunded';
}

/** The home "اطلب نفس الطلب" card: the newest food order that reached the door in the last 30 days. */
export const REORDER_CARD_DAYS = 30;

export function lastReorderable<T extends { order: Pick<Order, 'type' | 'state' | 'merchantOrgId' | 'placedAt' | 'ordererId'> }>(rows: readonly T[], now: Date, personId: string | null): T | null {
  const since = now.getTime() - REORDER_CARD_DAYS * DAY_MS;
  return (
    [...rows]
      .filter((r) => canReorder(r.order) && r.order.state !== 'disputed' && r.order.state !== 'refunded' && r.order.placedAt.getTime() >= since && (!personId || r.order.ordererId === personId))
      .sort((a, b) => b.order.placedAt.getTime() - a.order.placedAt.getTime())[0] ?? null
  );
}
