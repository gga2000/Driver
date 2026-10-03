import type {
  ErrorCode,
  Order,
  PartnerDemand,
  PartnerMerchantPrep,
  PartnerOnlineGate,
  PartnerPay,
  PartnerPayComponent,
  PartnerPayKey,
  QuoteComponent,
  Vertical,
} from '@driver/contracts';

/**
 * Pure rules behind the Partner reads: named pay, the demand hint, today's window, prep state.
 * No Nest, no I/O — unit-tested on their own.
 */

/** Quote components that belong to the courier's delivery pay, by the name the driver sees. */
const DELIVERY_KEY: Partial<Record<QuoteComponent['key'], PartnerPayKey>> = {
  night: 'night',
  weather: 'weather',
  peak: 'peak',
  door_pickup: 'door_pickup',
  wait: 'wait',
};

export const RIDE_VERTICALS: ReadonlySet<Vertical> = new Set<Vertical>(['taxi', 'tuktuk']);

export interface TakeRule {
  rate: number;
  minIqd?: number | undefined;
  fixedIqd?: number | undefined;
}

export interface PayInput {
  vertical: Vertical;
  /** The orders this trip carries for him (one, or the batch). */
  orders: ReadonlyArray<Pick<Order, 'deliveryFeeIqd' | 'tipIqd' | 'totalIqd' | 'type'>>;
  /** Quote components of the delivery fee (night, rain, door…) when known; the rest reads as "delivery". */
  feeComponents?: readonly QuoteComponent[];
  /** The job rides along one he already has: he earns `batchShare` of the delivery fee (money §2). */
  batchedSecond: boolean;
  batchShare: number;
  /** +500 re-broadcast compensation on this offer (edge-case §6). */
  compensationIqd: number;
  /** Ride take rule (tuktuk / car); ignored for deliveries, which pass through in full. */
  take: TakeRule | null;
}

function add(list: PartnerPayComponent[], key: PartnerPayKey, amountIqd: number): void {
  if (amountIqd === 0) return;
  const existing = list.find((c) => c.key === key);
  if (existing) existing.amountIqd += amountIqd;
  else list.push({ key, amountIqd });
}

/** The platform's share of a ride fare under its take rule (rounded down to whole dinars). */
export function rideTake(fareIqd: number, take: TakeRule): number {
  const pct = Math.floor(fareIqd * take.rate);
  return Math.min(fareIqd, Math.max(pct, take.minIqd ?? 0) + (take.fixedIqd ?? 0));
}

/**
 * What the driver earns on a job, every component named (money & ops §2 and §3):
 * deliveries pass the fee through (night/rain/door split out of it), a batched second order pays
 * 70 % of its fee as "batch_bonus", rides pay the fare minus the open take; tips and the
 * re-broadcast compensation are their own lines.
 */
export function buildPay(input: PayInput): PartnerPay {
  const components: PartnerPayComponent[] = [];
  const ride = RIDE_VERTICALS.has(input.vertical);
  let takePct: number | null = null;
  for (const o of input.orders) {
    if (ride || o.type === 'ride') {
      const fare = Math.max(0, o.totalIqd - o.tipIqd);
      const take = input.take ? rideTake(fare, input.take) : 0;
      takePct = input.take ? Math.round(input.take.rate * 100) : null;
      add(components, 'fare', fare - take);
    } else if (input.batchedSecond) {
      add(components, 'batch_bonus', Math.floor((o.deliveryFeeIqd * input.batchShare) / 50) * 50);
    } else {
      let rest = o.deliveryFeeIqd;
      for (const c of input.feeComponents ?? []) {
        const key = DELIVERY_KEY[c.key];
        if (!key || c.visibility !== 'shown' || c.amount <= 0 || c.amount > rest) continue;
        add(components, key, c.amount);
        rest -= c.amount;
      }
      // Base by zone pair (plus any street-handover discount) is the delivery line; it leads.
      if (rest !== 0) components.unshift({ key: 'delivery', amountIqd: rest });
    }
    add(components, 'tip', o.tipIqd);
  }
  add(components, 'pickup_compensation', input.compensationIqd);
  return { totalIqd: components.reduce((s, c) => s + c.amountIqd, 0), components, takePct };
}

/** Board statuses that mean "a job is waiting for a driver". */
export const WAITING_STATUSES: ReadonlySet<string> = new Set(['searching', 'rebroadcast', 'needs_dispatcher', 'awaiting_dispatcher']);

/**
 * The waiting-screen hint ("الطلب عالي بالمركز"): the zone with the most jobs waiting per online
 * driver, preferring the driver's own zone on ties. High when that zone has ≥ 2 jobs waiting and at
 * least one per driver there; quiet when nothing waits anywhere.
 */
export function demandHint(waitingZones: readonly string[], driverZones: ReadonlyArray<string | null>, myZone: string | null): PartnerDemand {
  const waiting = new Map<string, number>();
  for (const z of waitingZones) waiting.set(z, (waiting.get(z) ?? 0) + 1);
  const drivers = new Map<string, number>();
  for (const z of driverZones) if (z) drivers.set(z, (drivers.get(z) ?? 0) + 1);

  if (waiting.size === 0) {
    return { level: 'quiet', zoneId: myZone, waitingJobs: 0, driversNearby: myZone ? (drivers.get(myZone) ?? 0) : 0 };
  }
  let best: { zoneId: string; score: number; jobs: number } | null = null;
  for (const [zoneId, jobs] of waiting) {
    const score = jobs / Math.max(1, drivers.get(zoneId) ?? 0);
    const better = !best || score > best.score || (score === best.score && (zoneId === myZone || jobs > best.jobs));
    if (better) best = { zoneId, score, jobs };
  }
  const b = best!;
  const nearby = drivers.get(b.zoneId) ?? 0;
  const level = b.jobs >= 2 && b.jobs >= nearby ? 'high' : 'normal';
  return { level, zoneId: b.zoneId, waitingJobs: b.jobs, driversNearby: nearby };
}

/** Baghdad is UTC+3 all year: "today" for earnings starts at local midnight. */
export const BAGHDAD_OFFSET_MIN = 180;

export function startOfLocalDay(now: Date, offsetMin = BAGHDAD_OFFSET_MIN): Date {
  const day = 86_400_000;
  const shifted = now.getTime() + offsetMin * 60_000;
  return new Date(Math.floor(shifted / day) * day - offsetMin * 60_000);
}

/** Ledger line types on the driver's account that are not earnings (payouts move his money out). */
const NOT_EARNINGS: ReadonlySet<string> = new Set(['driver_payout']);

/** Today's money from his `driver:` statement lines: net earned, and how many jobs paid him. */
export function todayFromLines(lines: ReadonlyArray<{ type: string; amountIqd: number; tripId?: string | undefined; orderId?: string | undefined }>): { earningsIqd: number; jobs: number } {
  let earningsIqd = 0;
  const jobs = new Set<string>();
  for (const l of lines) {
    if (NOT_EARNINGS.has(l.type)) continue;
    earningsIqd += l.amountIqd;
    const key = l.tripId ?? l.orderId;
    if (key && l.amountIqd > 0 && l.type !== 'tip' && l.type !== 'driver_incentive') jobs.add(key);
  }
  return { earningsIqd, jobs: jobs.size };
}

/** The kitchen as the courier sees it on the offer and the pickup task. */
export function merchantPrep(name: string, order: Pick<Order, 'state' | 'promisedReadyAt' | 'readyAt' | 'pickedUpAt'>, now: Date): PartnerMerchantPrep {
  const state: PartnerMerchantPrep['state'] = order.pickedUpAt
    ? 'picked_up'
    : order.readyAt || order.state === 'ready'
      ? 'ready'
      : order.state === 'preparing'
        ? 'preparing'
        : 'waiting';
  const readyInMin =
    state === 'ready' || state === 'picked_up' ? 0 : order.promisedReadyAt ? Math.max(0, Math.ceil((order.promisedReadyAt.getTime() - now.getTime()) / 60_000)) : null;
  return { name, state, readyInMin };
}

/** Straight-line km between two points (town scale), one decimal. */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const k = 111.32;
  const dx = (b.lng - a.lng) * k * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dy = (b.lat - a.lat) * k;
  return Math.round(Math.sqrt(dx * dx + dy * dy) * 10) / 10;
}

/** Cap share at which the app starts warning (money §4 / partner.cap_warning). */
export const NEAR_CAP_SHARE = 0.8;

/**
 * The typed error `partner.goOnline` answers with when the online gate is closed, worst reason
 * first: a lock-out (ops must call him) over an expired document over a missing check-in.
 */
export function gateErrorCode(reasons: PartnerOnlineGate['reasons']): ErrorCode {
  const codes = new Set(reasons.map((r) => r.code));
  if (codes.has('checkin_locked')) return 'checkin_locked';
  if (codes.has('document_expired')) return 'online_document_expired';
  return 'online_checkin_required';
}

/**
 * Whether a closed gate still lets this `goOnline` through: the app re-sends `goOnline` every 30 s
 * as a heartbeat, so a driver already online when the local day turns keeps his shift until he next
 * goes online (check-in is "at first online each day"). A lock-out or an expired document ends it.
 */
export function gateAllowsHeartbeat(gate: PartnerOnlineGate, alreadyOnline: boolean): boolean {
  if (gate.canGoOnline) return true;
  return alreadyOnline && gate.reasons.every((r) => r.code === 'checkin_required');
}
