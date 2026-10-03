import type { BoardCard, BoardPolicy, DispatchBoard, RightNow as ServerRightNow, SetPolicyInput, Trip, Vertical } from '@driver/contracts';
import { formatCountdown, formatIqd } from './format';

/**
 * Pure helpers for the dispatch board (console spec "Dispatch board"). The API returns one flat,
 * sorted card list; the Console groups it into the four queue columns and derives the right-now bar.
 */

export const BOARD_COLUMNS = ['searching', 'offered', 'assigned', 'needs_dispatcher'] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

/** Offer states that are still waiting on the driver. */
const OPEN_OFFER_STATES = new Set(['sent', 'seen']);

export function hasOpenOffer(card: BoardCard): boolean {
  return card.offers.some((o) => OPEN_OFFER_STATES.has(o.state));
}

/**
 * Which column a card belongs to, or null when it leaves the board (cancelled).
 * - يحتاج موزّع: passes/waves exhausted, or suggest-only waiting on a human.
 * - مُعيَّن: a driver accepted.
 * - معروض: at least one offer is out and unanswered.
 * - يبحث: everything else still looking (scheduled, searching, rebroadcast between waves).
 */
export function columnOf(card: BoardCard): BoardColumn | null {
  switch (card.status) {
    case 'cancelled':
      return null;
    case 'needs_dispatcher':
    case 'awaiting_dispatcher':
      return 'needs_dispatcher';
    case 'assigned':
      return 'assigned';
    default:
      return hasOpenOffer(card) ? 'offered' : 'searching';
  }
}

/** Red first, then the longest-waiting first (same order the API sorts by). */
export function compareCards(a: BoardCard, b: BoardCard): number {
  return Number(b.red) - Number(a.red) || b.elapsedSec - a.elapsedSec || a.tripId.localeCompare(b.tripId);
}

export type GroupedBoard = Record<BoardColumn, BoardCard[]>;

export function groupBoard(cards: readonly BoardCard[]): GroupedBoard {
  const out: GroupedBoard = { searching: [], offered: [], assigned: [], needs_dispatcher: [] };
  for (const c of cards) {
    const col = columnOf(c);
    if (col) out[col].push(c);
  }
  for (const col of BOARD_COLUMNS) out[col].sort(compareCards);
  return out;
}

/** A card shows red when the API flags it or when it needs a dispatcher. */
export function isRedCard(card: BoardCard): boolean {
  return card.red || columnOf(card) === 'needs_dispatcher';
}

export interface RightNow {
  searching: number;
  offered: number;
  assigned: number;
  needsDispatcher: number;
  red: number;
  /** Mean elapsed seconds of cards still without a driver; null when none. */
  avgWaitSec: number | null;
  /** Distinct drivers holding an assignment or an open offer. */
  activeDrivers: number;
  /** Cards paying the +500 rebroadcast compensation. */
  compensated: number;
}

export function rightNow(cards: readonly BoardCard[]): RightNow {
  const g = groupBoard(cards);
  const waiting = [...g.searching, ...g.offered, ...g.needs_dispatcher];
  const drivers = new Set<string>();
  for (const c of cards) {
    if (c.status === 'cancelled') continue;
    if (c.assignedDriverId) drivers.add(c.assignedDriverId);
    for (const o of c.offers) if (OPEN_OFFER_STATES.has(o.state)) drivers.add(o.driverId);
  }
  return {
    searching: g.searching.length,
    offered: g.offered.length,
    assigned: g.assigned.length,
    needsDispatcher: g.needs_dispatcher.length,
    red: cards.filter((c) => c.status !== 'cancelled' && isRedCard(c)).length,
    avgWaitSec: waiting.length ? Math.round(waiting.reduce((s, c) => s + c.elapsedSec, 0) / waiting.length) : null,
    activeDrivers: drivers.size,
    compensated: cards.filter((c) => c.status !== 'cancelled' && c.compensationLabel_ar !== null).length,
  };
}

// ───────────────────────── right-now bar (server half) ─────────────────────────

export type OutboxHealth = 'ok' | 'backlog' | 'failing';

/** Failed rows need a human; a pending backlog above `backlogAt` means the publisher is behind. */
export function outboxHealth(o: { pending: number; failed: number }, backlogAt = 100): OutboxHealth {
  if (o.failed > 0) return 'failing';
  return o.pending >= backlogAt ? 'backlog' : 'ok';
}

export interface NowTile {
  key: 'orders_hour' | 'drivers' | 'time_to_accept' | 'late' | 'cash_field' | 'outbox';
  value: string;
  alert: boolean;
}

/** The `console.rightNow` tiles; `—` while it has not loaded (or failed). */
export function serverNowTiles(now: ServerRightNow | undefined): NowTile[] {
  const dash = '—';
  const health = now ? outboxHealth(now.outbox) : 'ok';
  return [
    { key: 'orders_hour', value: now ? String(now.ordersLastHour) : dash, alert: false },
    { key: 'drivers', value: now ? String(now.activeDrivers) : dash, alert: false },
    { key: 'time_to_accept', value: now ? formatCountdown(now.avgTimeToAcceptSec) : dash, alert: false },
    { key: 'late', value: now ? String(now.lateOrders) : dash, alert: (now?.lateOrders ?? 0) > 0 },
    { key: 'cash_field', value: now ? formatIqd(now.cashInFieldIqd) : dash, alert: false },
    { key: 'outbox', value: now ? `${now.outbox.pending} / ${now.outbox.failed}` : dash, alert: health !== 'ok' },
  ];
}

// ───────────────────────── policy switches ─────────────────────────

/** The three switch positions per vertical, plus `fixed` for scheduled / pre-assigned verticals. */
export const POLICY_MODES = ['broadcast', 'auto', 'suggest'] as const;
export type PolicyMode = (typeof POLICY_MODES)[number] | 'fixed';

export function policyMode(p: Pick<BoardPolicy, 'policy' | 'suggestOnly'>): PolicyMode {
  if (p.suggestOnly) return 'suggest';
  if (p.policy === 'smart_broadcast') return 'broadcast';
  if (p.policy === 'auto_assign') return 'auto';
  return 'fixed';
}

/** The `dispatch.setPolicy` input that moves a vertical to a switch position. */
export function setPolicyInput(cityId: string, vertical: Vertical, mode: (typeof POLICY_MODES)[number]): SetPolicyInput {
  switch (mode) {
    case 'broadcast':
      return { cityId, vertical, policy: 'smart_broadcast', suggestOnly: false };
    case 'auto':
      return { cityId, vertical, policy: 'auto_assign', suggestOnly: false };
    case 'suggest':
      return { cityId, vertical, suggestOnly: true };
  }
}

// ───────────────────────── drivers seen on the board ─────────────────────────

export type BoardDriverState = 'on_job' | 'offered' | 'suggested';

export interface BoardDriver {
  driverId: string;
  state: BoardDriverState;
  tripIds: string[];
}

const RANK: Record<BoardDriverState, number> = { on_job: 0, offered: 1, suggested: 2 };

/**
 * Every driver the board and the active trips mention, with the "busiest" state seen. This is the
 * Console's only driver list until a presence/roster procedure exists.
 */
export function driversFromBoard(board: Pick<DispatchBoard, 'cards'> | undefined, trips: readonly Trip[] = []): BoardDriver[] {
  const map = new Map<string, BoardDriver>();
  const see = (driverId: string, state: BoardDriverState, tripId: string) => {
    const cur = map.get(driverId);
    if (!cur) {
      map.set(driverId, { driverId, state, tripIds: [tripId] });
      return;
    }
    if (RANK[state] < RANK[cur.state]) cur.state = state;
    if (!cur.tripIds.includes(tripId)) cur.tripIds.push(tripId);
  };
  for (const t of trips) if (t.courierId) see(t.courierId, 'on_job', t.id);
  for (const c of board?.cards ?? []) {
    if (c.status === 'cancelled') continue;
    if (c.assignedDriverId) see(c.assignedDriverId, 'on_job', c.tripId);
    for (const o of c.offers) if (OPEN_OFFER_STATES.has(o.state)) see(o.driverId, 'offered', c.tripId);
    for (const d of c.suggestion) see(d, 'suggested', c.tripId);
  }
  return [...map.values()].sort((a, b) => RANK[a.state] - RANK[b.state] || a.driverId.localeCompare(b.driverId));
}
