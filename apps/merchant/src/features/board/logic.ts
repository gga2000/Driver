import { PREP_CHOICES, mentionsAllergy, type BoardColumn, type PrepKind, type StoreStatusView, type BoardCourier, type BoardOrder } from '@driver/contracts';
import type { TKey } from '@/lib/i18n-core';
import { minutesBetween, minutesLeft } from '@/lib/time';
import { arriving } from './radar';

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

/**
 * Spec: accept with a prep-time choice of 10 / 15 / 25 or a custom number. Ali 2026-10-08 (t5): a juice
 * bar or café (drinks only) picks 3 / 5 / 8 instead; a shop selling food as well keeps 10 / 15 / 25.
 */
export const PREP_OPTIONS = PREP_CHOICES.food;
export function prepOptions(kind: PrepKind | undefined): readonly number[] {
  return PREP_CHOICES[kind ?? 'food'];
}
/** The custom stepper's floor: a drink can honestly be 1 minute, a meal never under 5. */
export const PREP_MIN = 5;
export const PREP_MIN_DRINKS = 1;
export const PREP_MAX = 120;
export function prepMin(kind: PrepKind | undefined): number {
  return kind === 'drinks' ? PREP_MIN_DRINKS : PREP_MIN;
}

/** The chip to preselect: the store's usual prep time rounded to the nearest option (ties go up — be honest). */
export function defaultPrepChoice(usualMinutes: number, kind?: PrepKind): number {
  const options = prepOptions(kind);
  let best: number = options[0]!;
  for (const o of options) if (Math.abs(o - usualMinutes) <= Math.abs(best - usualMinutes)) best = o;
  return best;
}

export function clampPrep(minutes: number, kind?: PrepKind): number {
  return Math.min(PREP_MAX, Math.max(prepMin(kind), Math.round(minutes)));
}

/** The busy minutes in force (r5: +10 or +20 picked when switched on; 0 when busy mode is off). */
export function busyExtra(status: Pick<StoreStatusView, 'busy'> | null | undefined): number {
  return status?.busy.on ? status.busy.extraPrepMinutes : 0;
}

/** What the customer will see: the kitchen's pick plus the busy minutes while busy mode is on. */
export function committedPrep(picked: number, busyMinutes: number): number {
  return picked + Math.max(0, busyMinutes);
}

/**
 * One-tap accept (M-12, approved by Ali): "اقبل · 15 د" accepts with the store's usual prep time. The
 * server adds the busy minutes itself, so we send the usual time and show what the customer will see.
 */
export function oneTapPrep(usualMinutes: number, busyMinutes: number, kind?: PrepKind): { prepMinutes: number; shown: number } {
  const prepMinutes = clampPrep(usualMinutes, kind);
  return { prepMinutes, shown: committedPrep(prepMinutes, busyMinutes) };
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
      // About to walk in (maps program SP7a): the card turns green with the chime.
      if (arriving(c)) return c.firstName ? { key: 'merchant.courier.arriving', params: { name: c.firstName }, tone: 'success', live: true } : { key: 'merchant.courier.arriving_anon', tone: 'success', live: true };
      if (c.etaMinutes === null) return { key: 'merchant.courier.on_the_way_no_eta', tone: 'neutral', live: true };
      return c.firstName
        ? { key: 'merchant.courier.on_the_way_named', params: { name: c.firstName, minutes: c.etaMinutes }, tone: 'neutral', live: true }
        : { key: 'merchant.courier.on_the_way', params: { minutes: c.etaMinutes }, tone: 'neutral', live: true };
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

// ───────────────────────── rush (M-05, M-06, M-10) ─────────────────────────

/**
 * M-10: the one "new" number — orders in the جديد column. The column header, the rail/tab badge and
 * the banner all show this; the banner adds the state ("1 مسكّت", "1 ينتظر الزبون") after it.
 */
export function newCount(orders: readonly Pick<BoardOrder, 'column'>[]): number {
  return orders.filter((o) => o.column === 'new').length;
}

export interface NewOrderSummary {
  /** Every order in جديد (= `newCount`). */
  total: number;
  /** Quiet under "سكّت 30 ثانية". */
  snoozed: number;
  /** A partial accept waiting for the customer's answer. */
  withCustomer: number;
}

export function newOrderSummary(orders: readonly Pick<BoardOrder, 'id' | 'column' | 'partial'>[], snoozedIds: readonly string[]): NewOrderSummary {
  const fresh = orders.filter((o) => o.column === 'new');
  return {
    total: fresh.length,
    snoozed: fresh.filter((o) => o.partial === null && snoozedIds.includes(o.id)).length,
    withCustomer: fresh.filter((o) => o.partial !== null).length,
  };
}

/**
 * The جديد column in answer order (M-05): least time left first; orders without a running clock
 * (a partial waiting for the customer, scheduled and not yet offered) after them, oldest first.
 */
export function byTimeLeft<T extends Pick<BoardOrder, 'acceptBy' | 'placedAt' | 'partial' | 'id'>>(orders: readonly T[]): T[] {
  const clock = (o: T) => (o.partial === null && o.acceptBy ? o.acceptBy.getTime() : Number.POSITIVE_INFINITY);
  return [...orders].sort((a, b) => clock(a) - clock(b) || a.placedAt.getTime() - b.placedAt.getTime() || a.id.localeCompare(b.id));
}

/** Tablet rush (S-M2): more than two orders waiting → the queue strip and compact tickets. */
export const RUSH_FROM = 3;
export function isRush(waiting: number): boolean {
  return waiting >= RUSH_FROM;
}

/**
 * Busy mode suggested (r4): from six orders waiting the busy chip in the status bar pulses once with
 * «زحمة؟» (no strip over the board), unless busy mode is on already.
 */
export const BUSY_SUGGEST_FROM = 6;
export function suggestBusy(waiting: number, busyOn: boolean): boolean {
  return !busyOn && waiting >= BUSY_SUGGEST_FROM;
}

/**
 * Rush rows (r2): above six orders waiting, every new ticket but the open one shrinks to one line with
 * its own button, so ten orders fit on one tablet screen.
 */
export const ROWS_FROM = 7;
export function rushRows(waiting: number): boolean {
  return waiting >= ROWS_FROM;
}

/** An order the kitchen must read before accepting: an allergy or any note. It is never accepted in bulk (t4). */
export function needsReading(o: Pick<BoardOrder, 'note' | 'groups'>): boolean {
  return kitchenNotes(o).length > 0;
}

/**
 * «اقبل الكل» (t4), in busy mode only: every order waiting for the kitchen (ringing or snoozed, not a
 * partial waiting for the customer) that has no allergy and no note. `skipped` counts the waiting ones
 * left to open one by one. Offered from two orders up.
 */
export function acceptAllTargets<T extends Pick<BoardOrder, 'id' | 'column' | 'partial' | 'note' | 'groups'>>(orders: readonly T[], waitingIds: readonly string[], busyOn: boolean): { targets: T[]; skipped: number } {
  if (!busyOn) return { targets: [], skipped: 0 };
  const waiting = orders.filter((o) => o.column === 'new' && o.partial === null && waitingIds.includes(o.id));
  const targets = waiting.filter((o) => !needsReading(o));
  return targets.length >= 2 ? { targets, skipped: waiting.length - targets.length } : { targets: [], skipped: 0 };
}

/**
 * A ticket that pushes its own Accept below the fold on a phone: a group order (a header per person)
 * or more than four dishes. Four dishes still fit under the bar and the ribbon at 390 × 844.
 */
export function isLongOrder(o: Pick<BoardOrder, 'groups' | 'itemCount'>): boolean {
  return o.groups.length > 1 || o.itemCount > 4;
}

/**
 * The phone's «هسة» view (o2): one order in full at the top — the one the kitchen picked, else the
 * one with least time left — and every other new order as a one-line row under it, in answer order.
 * The sticky accept bar (M-06) follows the top order while it is still the kitchen's to answer and
 * long enough to push its own Accept below the fold.
 */
export function phoneNow<T extends Pick<BoardOrder, 'column' | 'acceptBy' | 'placedAt' | 'partial' | 'id' | 'groups' | 'itemCount'>>(orders: readonly T[], pickedId: string | null): { first: T | null; rest: T[]; sticky: T | null } {
  const sorted = byTimeLeft(orders.filter((o) => o.column === 'new'));
  const first = sorted.find((o) => o.id === pickedId) ?? sorted[0] ?? null;
  const rest = sorted.filter((o) => o !== first);
  return { first, rest, sticky: first && first.partial === null && isLongOrder(first) ? first : null };
}

/** Every customer note on the order: the order's (kitchen) note, each person's note, each line's. */
export function kitchenNotes(o: Pick<BoardOrder, 'note' | 'groups'>): string[] {
  const out: string[] = [];
  if (o.note) out.push(o.note);
  for (const g of o.groups) {
    if (g.note) out.push(g.note);
    for (const l of g.lines) if (l.note) out.push(l.note);
  }
  return out;
}

/** M-09: any note on the order mentions an allergy → the card shows a "حساسية" pill. Display only. */
export function hasAllergy(o: Pick<BoardOrder, 'note' | 'groups'>): boolean {
  return mentionsAllergy(...kitchenNotes(o));
}

// ───────────────────────── the counter board (redesign step 2) ─────────────────────────

/**
 * «على النار» in cooking order (o6): the ticket due first at the top, so a late one is always first;
 * tickets without a promised time (not expected) after them, oldest first.
 */
export function byDueFirst<T extends Pick<BoardOrder, 'promisedReadyAt' | 'placedAt' | 'id'>>(orders: readonly T[]): T[] {
  const due = (o: T) => o.promisedReadyAt?.getTime() ?? Number.POSITIVE_INFINITY;
  return [...orders].sort((a, b) => due(a) - due(b) || a.placedAt.getTime() - b.placedAt.getTime() || a.id.localeCompare(b.id));
}

/**
 * How much of the prep time is left on a cooking ticket (o5), 1 → 0, for the bar that drains along
 * it; `late` once the promised time has passed. Null without both times (nothing to drain).
 */
export function prepLeft(o: Pick<BoardOrder, 'column' | 'acceptedAt' | 'promisedReadyAt'>, now: number): { fraction: number; late: boolean } | null {
  if (o.column !== 'preparing' || !o.acceptedAt || !o.promisedReadyAt) return null;
  const total = o.promisedReadyAt.getTime() - o.acceptedAt.getTime();
  const left = o.promisedReadyAt.getTime() - now;
  if (left < 0) return { fraction: 0, late: true };
  if (total <= 0) return { fraction: 0, late: false };
  return { fraction: Math.min(1, left / total), late: false };
}

/** The key for one dish line the kitchen ticked off (o10). */
export function tickKey(orderId: string, lineId: string): string {
  return `${orderId}:${lineId}`;
}

export interface CookingTotal {
  name: string;
  qty: number;
}

/**
 * «على النار» added up (o11): every dish still to make across the cooking tickets, by name, biggest
 * first — the grill cook reads one line. Lines the kitchen ticked off, and lines that are out or
 * removed, don't count.
 */
export function cookingTotals(orders: readonly Pick<BoardOrder, 'id' | 'column' | 'groups'>[], ticked: ReadonlySet<string>): CookingTotal[] {
  const sum = new Map<string, number>();
  for (const o of orders) {
    if (o.column !== 'preparing') continue;
    for (const g of o.groups)
      for (const l of g.lines) {
        if (l.availability !== 'available' || ticked.has(tickKey(o.id, l.lineId))) continue;
        sum.set(l.name, (sum.get(l.name) ?? 0) + l.qty);
      }
  }
  return [...sum.entries()].map(([name, qty]) => ({ name, qty })).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
}

/** The dishes of an order in one line for the new-order ribbon (a1): «2× لفة تكة، 1× ماي». */
export function dishLine(o: Pick<BoardOrder, 'groups'>, max = 3): { shown: { qty: number; name: string }[]; more: number } {
  const lines = o.groups.flatMap((g) => g.lines).filter((l) => l.availability !== 'removed');
  return { shown: lines.slice(0, max).map((l) => ({ qty: l.qty, name: l.name })), more: Math.max(0, lines.length - max) };
}
