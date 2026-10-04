import { MERCHANT_BUSY_RULES, type BoardColumn, type BoardCourier, type BoardOrder } from '@driver/contracts';
import type { TKey } from '@/lib/i18n-core';
import { minutesBetween, minutesLeft } from '@/lib/time';

/**
 * Orders board rules, free of React Native so they are unit-tested: columns and counts, the prep
 * choices and busy maths, card timing, the courier line, the new-order alert and reject reasons.
 */

export const COLUMNS: readonly BoardColumn[] = ['new', 'preparing', 'ready'];

export const COLUMN_LABEL: Record<BoardColumn, TKey> = {
  new: 'merchant.board.col_new',
  preparing: 'merchant.board.col_preparing',
  ready: 'merchant.board.col_ready',
};

export function splitColumns(orders: readonly BoardOrder[]): Record<BoardColumn, BoardOrder[]> {
  const out: Record<BoardColumn, BoardOrder[]> = { new: [], preparing: [], ready: [] };
  for (const o of orders) out[o.column].push(o);
  return out;
}

/** Spec: accept with a prep-time choice of 10 / 15 / 25 or a custom number. */
export const PREP_OPTIONS = [10, 15, 25] as const;
export const PREP_MIN = 5;
export const PREP_MAX = 120;

/** The chip to preselect: the store's usual prep time rounded to the nearest option (ties go up — be honest). */
export function defaultPrepChoice(usualMinutes: number): number {
  let best: number = PREP_OPTIONS[0];
  for (const o of PREP_OPTIONS) if (Math.abs(o - usualMinutes) <= Math.abs(best - usualMinutes)) best = o;
  return best;
}

export function clampPrep(minutes: number): number {
  return Math.min(PREP_MAX, Math.max(PREP_MIN, Math.round(minutes)));
}

/** What the customer will see: the kitchen's pick plus the busy buffer while busy mode is on. */
export function committedPrep(picked: number, busyOn: boolean): number {
  return picked + (busyOn ? MERCHANT_BUSY_RULES.extraPrepMinutes : 0);
}

/**
 * One-tap accept (M-12, approved by Ali): "اقبل · 15 د" accepts with the store's usual prep time. The
 * server adds the busy minutes itself, so we send the usual time and show what the customer will see.
 */
export function oneTapPrep(usualMinutes: number, busyOn: boolean): { prepMinutes: number; shown: number } {
  const prepMinutes = clampPrep(usualMinutes);
  return { prepMinutes, shown: committedPrep(prepMinutes, busyOn) };
}

/** "+5 د": once per order, on an accepted order still being prepared (the server enforces it too). */
export function canExtendPrep(o: Pick<BoardOrder, 'column' | 'promisedReadyAt' | 'prepExtended'>): boolean {
  return o.column === 'preparing' && o.promisedReadyAt !== null && o.prepExtended !== true;
}

export type CardTiming =
  | { kind: 'since'; minutes: number }
  | { kind: 'ready_in'; minutes: number }
  | { kind: 'late'; minutes: number }
  | { kind: 'ready_since'; minutes: number };

/** The time line on a card: how long a new order has waited, prep countdown/lateness, or time since ready. */
export function cardTiming(o: Pick<BoardOrder, 'column' | 'placedAt' | 'promisedReadyAt' | 'readyAt'>, now: number): CardTiming {
  if (o.column === 'preparing' && o.promisedReadyAt) {
    const left = o.promisedReadyAt.getTime() - now;
    return left >= 0 ? { kind: 'ready_in', minutes: minutesLeft(o.promisedReadyAt, now) } : { kind: 'late', minutes: Math.max(1, minutesBetween(o.promisedReadyAt, now)) };
  }
  if (o.column === 'ready' && o.readyAt) return { kind: 'ready_since', minutes: minutesBetween(o.readyAt, now) };
  return { kind: 'since', minutes: minutesBetween(o.placedAt, now) };
}

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

/** The courier line: "الدليفري بالطريق · 4 د" / "الدليفري وصل" / "ينتظر من 6 د" (warning after 3 min). */
export function courierLine(c: BoardCourier, now: number): { key: TKey; params?: Record<string, string | number>; tone: Tone; live: boolean } | null {
  switch (c.state) {
    case 'none':
      return null;
    case 'searching':
      return { key: 'merchant.courier.searching', tone: 'neutral', live: true };
    case 'on_the_way':
      if (c.etaMinutes === null) return { key: 'merchant.courier.on_the_way_no_eta', tone: 'info', live: true };
      return c.firstName
        ? { key: 'merchant.courier.on_the_way_named', params: { name: c.firstName, minutes: c.etaMinutes }, tone: 'info', live: true }
        : { key: 'merchant.courier.on_the_way', params: { minutes: c.etaMinutes }, tone: 'info', live: true };
    case 'arrived': {
      const waited = c.arrivedAt ? minutesBetween(c.arrivedAt, now) : 0;
      if (waited >= 3) return { key: 'merchant.courier.arrived_waiting', params: { minutes: waited }, tone: 'warning', live: true };
      return { key: 'merchant.courier.arrived', tone: 'success', live: true };
    }
    case 'picked_up':
      return { key: 'merchant.courier.picked_up', tone: 'neutral', live: false };
  }
}

/** New orders the kitchen hasn't acted on or silenced: they keep the sound going and the banner up. */
export function unacknowledged(orders: readonly BoardOrder[], acknowledged: ReadonlySet<string>): string[] {
  return orders.filter((o) => o.column === 'new' && o.partial === null && !acknowledged.has(o.id)).map((o) => o.id);
}

/** Reject reasons offered on the sheet (spec: خلص الأكل، زحمة، مسدودين، غيره). */
export const REJECT_REASONS = ['sold_out', 'too_busy', 'closed', 'other'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const REJECT_LABEL: Record<RejectReason, TKey> = {
  sold_out: 'merchant.reject.reason_sold_out',
  too_busy: 'merchant.reject.reason_busy',
  closed: 'merchant.reject.reason_closed',
  other: 'merchant.reject.reason_other',
};

/** The reason string stored on the order: a stable code, plus the kitchen's words for "غيره". */
export function rejectReasonValue(reason: RejectReason, other: string): string | null {
  if (reason !== 'other') return reason;
  const text = other.trim();
  return text ? `other: ${text.slice(0, 180)}` : null;
}

/** A partial accept must leave something to cook and name at least one missing line. */
export function partialValid(selected: ReadonlySet<string>, lineIds: readonly string[]): boolean {
  return selected.size > 0 && selected.size < lineIds.length && [...selected].every((id) => lineIds.includes(id));
}

/** Short Arabic/English item count etc. are copy; this is the people count for the detail header. */
export function peopleCount(o: Pick<BoardOrder, 'groups'>): number {
  return o.groups.length;
}
