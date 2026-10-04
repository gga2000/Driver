import type { BoardCard, DriverPin, DriverPinState, Order, Trip, VehicleClass, Vertical } from '@driver/contracts';
import { columnOf, compareCards, isRedCard, type BoardColumn } from './board';
import { stepIndex } from './hotkeys';

/**
 * The dispatch desk's pure parts (K-03, K-04, K-07): the queue order (exceptions first), the
 * ranked candidate list a dispatcher assigns from, wave history and wait severity at a glance, and
 * the keyboard reducer (j/k, a, 1–5, Enter, Esc). The ranking is a reading aid only: the server
 * still validates every manual assign (`dispatch.override`) and the driver still accepts or declines.
 */

// ───────────────────────── queue ─────────────────────────

/** Queue sections top to bottom: the one that needs a human first, the quiet one last (collapsed). */
export const QUEUE_ORDER = ['needs_dispatcher', 'offered', 'searching', 'assigned'] as const satisfies readonly BoardColumn[];

export type Queue = Record<BoardColumn, BoardCard[]>;

export function buildQueue(cards: readonly BoardCard[]): Queue {
  const out: Queue = { needs_dispatcher: [], offered: [], searching: [], assigned: [] };
  for (const c of cards) {
    const col = columnOf(c);
    if (col) out[col].push(c);
  }
  for (const col of QUEUE_ORDER) out[col].sort(compareCards);
  return out;
}

/** Trip ids in the order j/k walks them (collapsed sections are skipped). */
export function queueOrder(queue: Queue, collapsed: ReadonlySet<BoardColumn> = new Set()): string[] {
  return QUEUE_ORDER.filter((col) => !collapsed.has(col)).flatMap((col) => queue[col].map((c) => c.tripId));
}

export type WaitTone = 'bad' | 'warn' | 'neutral';

/** Seconds a card may wait before its clock turns amber (red is the server's call: `red` / needs). */
export const WAIT_WARN_SEC = 180;

export function waitTone(card: BoardCard, elapsedSec: number): WaitTone {
  // Assigned is handled; scheduled (pre-orders, T−30) isn't late however long ago it was placed.
  if (card.status === 'assigned' || card.status === 'scheduled') return 'neutral';
  if (isRedCard(card)) return 'bad';
  return elapsedSec >= WAIT_WARN_SEC ? 'warn' : 'neutral';
}

export interface Triage {
  needs: number;
  /** The longest-waiting card that needs a dispatcher (the "خذه" target); null when none. */
  oldest: BoardCard | null;
  red: number;
}

export function triage(queue: Queue): Triage {
  const needs = queue.needs_dispatcher;
  const oldest = needs.reduce<BoardCard | null>((a, c) => (a === null || c.elapsedSec > a.elapsedSec ? c : a), null);
  const red = QUEUE_ORDER.reduce((n, col) => n + queue[col].filter((c) => col !== 'assigned' && isRedCard(c)).length, 0);
  return { needs: needs.length, oldest, red };
}

// ───────────────────────── wave history ─────────────────────────

export interface WaveHistory {
  /** Current wave (broadcast) or pass (auto-assign); 0 before the first. */
  current: number;
  /** How many waves the policy runs (3 for smart broadcast, else at least the current one). */
  total: number;
  declined: number;
  timedOut: number;
  /** Offers still out (sent or seen). */
  open: number;
}

export function waveHistory(card: BoardCard): WaveHistory {
  const current = Math.max(card.wave, card.pass);
  const total = card.policy === 'smart_broadcast' ? Math.max(3, current) : Math.max(current, 1);
  let declined = 0;
  let timedOut = 0;
  let open = 0;
  for (const o of card.offers) {
    if (o.state === 'declined') declined += 1;
    else if (o.state === 'timed_out') timedOut += 1;
    else if (o.state === 'sent' || o.state === 'seen') open += 1;
  }
  return { current, total, declined, timedOut, open };
}

// ───────────────────────── geometry ─────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

/** Great-circle distance in km. */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Town streets are not straight lines: crow-flies × 1.3 is close to the road distance in Aziziyah. */
export const ROAD_FACTOR = 1.3;
const SPEED_KMH: Record<VehicleClass, number> = { bike: 24, tuktuk: 20, car: 28, suv: 28, van: 24, intercity: 32 };

/** Road km for a crow-flies distance. */
export function roadKm(km: number): number {
  return km * ROAD_FACTOR;
}

/** Minutes to cover `km` (crow-flies) in town by this vehicle; at least 1. */
export function etaMinutes(km: number, vehicle: VehicleClass): number {
  return Math.max(1, Math.round((roadKm(km) / SPEED_KMH[vehicle]) * 60));
}

/** Where the driver has to go first: the first pickup stop with a pin, else the first pinned stop. */
export function pickupOf(trip: Trip | undefined): LatLng | null {
  if (!trip) return null;
  const pinned = [...trip.stops].sort((a, b) => a.seq - b.seq).filter((s) => s.target !== null);
  const first = pinned.find((s) => s.type === 'pickup') ?? pinned[0];
  return first?.target ?? null;
}

// ───────────────────────── candidates ─────────────────────────

/** Spec ranking (dispatch & pricing detail): distance 40%, tier/score 30%, load 20%, vehicle fit 10%. */
export const RANK_WEIGHTS = { distance: 0.4, tier: 0.3, load: 0.2, fit: 0.1 } as const;
/** Beyond this the distance part scores 0 (wave 3 is "all city", roughly this far). */
export const RANK_MAX_KM = 5;

const TIER_SCORE: Record<DriverPin['tier'], number> = { gold: 1, silver: 0.66, bronze: 0.33 };
const LOAD_SCORE: Record<DriverPinState, number> = { free: 1, offered: 0.4, on_job: 0.25, over_cap: 0, offline_recent: 0 };

const DELIVERY: Partial<Record<VehicleClass, number>> = { bike: 1, tuktuk: 0.8, van: 0.7, car: 0.6, suv: 0.5 };
const FIT: Record<Vertical, Partial<Record<VehicleClass, number>>> = {
  food: DELIVERY,
  grocery: DELIVERY,
  errand: DELIVERY,
  parcel: DELIVERY,
  taxi: { car: 1, suv: 1, van: 0.6, intercity: 0.4 },
  tuktuk: { tuktuk: 1, car: 0.5, suv: 0.5 },
  intercity: { intercity: 1, suv: 0.7, car: 0.6, van: 0.6 },
  khat: { van: 1, suv: 0.8, car: 0.6 },
};

/** 0–1: how well this vehicle suits the job; 0 means it can't take it (a bike can't take a taxi ride). */
export function vehicleFit(vertical: Vertical, vehicle: VehicleClass): number {
  return FIT[vertical][vehicle] ?? 0;
}

/** Reasons the server would refuse a plain assign; each needs "force" plus a written reason. */
export type Blocker = 'over_cap' | 'offline' | 'vehicle';

export interface Candidate {
  driverId: string;
  /** Presence pin; null for a suggested driver who isn't online right now. */
  pin: DriverPin | null;
  /** Crow-flies km to the pickup; null when either end has no position. */
  km: number | null;
  etaMin: number | null;
  /** 0–100, higher is better. */
  score: number;
  blockers: Blocker[];
  /** In the server's suggestion list (suggest-only verticals). */
  suggested: boolean;
  /** Already declined or let this card's offer time out. */
  declined: boolean;
}

/** Owed share of the cash cap, 0–100+ (not clamped: over cap reads over 100). */
export function capShare(pin: Pick<DriverPin, 'owedIqd' | 'capIqd'>): number {
  return pin.capIqd > 0 ? Math.round((pin.owedIqd / pin.capIqd) * 100) : 0;
}

export function rankCandidates(
  card: BoardCard,
  pickup: LatLng | null,
  pins: readonly DriverPin[],
  opts: { limit?: number } = {},
): Candidate[] {
  const limit = opts.limit ?? 5;
  const suggested = new Set(card.suggestion);
  const declined = new Set(card.offers.filter((o) => o.state === 'declined' || o.state === 'timed_out').map((o) => o.driverId));
  const exclude = card.assignedDriverId;
  const out: Candidate[] = [];
  const seen = new Set<string>();

  for (const pin of pins) {
    if (pin.driverId === exclude || seen.has(pin.driverId)) continue;
    seen.add(pin.driverId);
    const km = pickup ? distanceKm(pickup, pin) : null;
    const fit = vehicleFit(card.vertical, pin.vehicleClass);
    const blockers: Blocker[] = [];
    if (pin.overCap || pin.state === 'over_cap') blockers.push('over_cap');
    if (pin.state === 'offline_recent') blockers.push('offline');
    if (fit === 0) blockers.push('vehicle');
    const distPart = km === null ? 0.5 : 1 - Math.min(km, RANK_MAX_KM) / RANK_MAX_KM;
    let s =
      RANK_WEIGHTS.distance * distPart +
      RANK_WEIGHTS.tier * TIER_SCORE[pin.tier] +
      RANK_WEIGHTS.load * LOAD_SCORE[pin.state] +
      RANK_WEIGHTS.fit * fit;
    if (suggested.has(pin.driverId)) s += 0.05;
    if (declined.has(pin.driverId)) s -= 0.15;
    out.push({
      driverId: pin.driverId,
      pin,
      km,
      etaMin: km === null ? null : etaMinutes(km, pin.vehicleClass),
      score: Math.round(Math.max(0, Math.min(1, s)) * 100),
      blockers,
      suggested: suggested.has(pin.driverId),
      declined: declined.has(pin.driverId),
    });
  }
  // Suggested drivers the presence feed doesn't have (offline): still pickable, flagged.
  for (const id of card.suggestion) {
    if (seen.has(id) || id === exclude) continue;
    seen.add(id);
    out.push({ driverId: id, pin: null, km: null, etaMin: null, score: 0, blockers: ['offline'], suggested: true, declined: declined.has(id) });
  }

  return out
    .sort(
      (a, b) =>
        Number(a.blockers.length > 0) - Number(b.blockers.length > 0) ||
        b.score - a.score ||
        (a.km ?? Infinity) - (b.km ?? Infinity) ||
        a.driverId.localeCompare(b.driverId),
    )
    .slice(0, limit);
}

/** Restaurant of a trip: the merchant of its first order still on it (null for rides). */
export function merchantOfTrip(orderIds: readonly string[], orders: ReadonlyMap<string, Pick<Order, 'merchantOrgId'>>): string | null {
  for (const id of orderIds) {
    const m = orders.get(id)?.merchantOrgId;
    if (m) return m;
  }
  return null;
}

// ───────────────────────── keyboard ─────────────────────────

export interface DeskState {
  /** Selected card (trip id); its candidates show under it. */
  selected: string | null;
  /** Picked candidate index (0-based) or -1. */
  pick: number;
}

export const DESK_START: DeskState = { selected: null, pick: -1 };

export type DeskKey = 'j' | 'k' | 'a' | 'enter' | 'escape' | '1' | '2' | '3' | '4' | '5';

export interface DeskContext {
  /** Trip ids in queue order. */
  order: readonly string[];
  /** The "خذه" target (oldest card needing a dispatcher), if any. */
  oldest: string | null;
  /** Candidates of the selected card. */
  candidates: number;
  /** The selected card can be (re)assigned. */
  assignable: boolean;
}

export type DeskEffect = 'send' | null;

/**
 * One key press → the next desk state, plus `send` when Enter confirms a picked candidate (the page
 * then sends the offer, or asks for a reason first when the candidate needs force).
 * - j / k: next / previous card (the pick resets).
 * - a: take the oldest card that needs a dispatcher.
 * - 1–5: pick that candidate of the selected card.
 * - Enter: send to the picked candidate; with nothing selected, select the first card.
 * - Esc: drop the pick, then the selection.
 */
export function deskKey(s: DeskState, key: DeskKey, ctx: DeskContext): { state: DeskState; effect: DeskEffect } {
  const keep = { state: s, effect: null as DeskEffect };
  switch (key) {
    case 'j':
    case 'k': {
      const i = s.selected ? ctx.order.indexOf(s.selected) : -1;
      const next = stepIndex(i, ctx.order.length, key === 'j' ? 1 : -1);
      return next < 0 ? keep : { state: { selected: ctx.order[next]!, pick: next === i ? s.pick : -1 }, effect: null };
    }
    case 'a':
      return ctx.oldest ? { state: { selected: ctx.oldest, pick: -1 }, effect: null } : keep;
    case 'enter':
      if (s.selected && s.pick >= 0 && s.pick < ctx.candidates && ctx.assignable) return { state: s, effect: 'send' };
      if (!s.selected && ctx.order.length > 0) return { state: { selected: ctx.order[0]!, pick: -1 }, effect: null };
      return keep;
    case 'escape':
      if (s.pick >= 0) return { state: { ...s, pick: -1 }, effect: null };
      if (s.selected) return { state: DESK_START, effect: null };
      return keep;
    default: {
      const n = Number(key) - 1;
      if (!s.selected || !ctx.assignable || n >= ctx.candidates) return keep;
      return { state: { ...s, pick: n }, effect: null };
    }
  }
}
