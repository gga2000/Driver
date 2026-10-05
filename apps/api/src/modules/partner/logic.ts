import { CAP_WARN_SHARE } from '@driver/contracts';
import type {
  ErrorCode,
  Order,
  PartnerDemand,
  PartnerDemandMap,
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

/**
 * Integer share of an amount at a rate, half rounding up — the ledger's `pct` (ledger/postings.ts),
 * so what an offer promises is what the ledger posts.
 */
export function shareOf(amountIqd: number, rate: number): number {
  return Math.round(Math.round(amountIqd * rate * 1e6) / 1e6);
}

/** The platform's share of a ride fare under its take rule (the ledger's `takeOf`). */
export function rideTake(fareIqd: number, take: TakeRule): number {
  if (fareIqd <= 0) return 0;
  return Math.min(fareIqd, Math.max(shareOf(fareIqd, take.rate), take.minIqd ?? 0) + (take.fixedIqd ?? 0));
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
      add(components, 'batch_bonus', shareOf(o.deliveryFeeIqd, input.batchShare));
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

/**
 * The driver map's busy zones (maps program d5): per zone, the jobs waiting now plus the pickups this
 * hour usually brings (`expected`, the weekly average), against the online drivers there. Hot when
 * that demand is at least 2 and more than the drivers can take; warm from 1; calm otherwise. Zones
 * with nothing going on are left out.
 */
export function demandZones(waitingZones: readonly string[], driverZones: ReadonlyArray<string | null>, expected: ReadonlyMap<string, number>): PartnerDemandMap['zones'] {
  const waiting = new Map<string, number>();
  for (const z of waitingZones) waiting.set(z, (waiting.get(z) ?? 0) + 1);
  const drivers = new Map<string, number>();
  for (const z of driverZones) if (z) drivers.set(z, (drivers.get(z) ?? 0) + 1);
  const ids = new Set([...waiting.keys(), ...drivers.keys(), ...[...expected].filter(([, n]) => n >= 0.5).map(([z]) => z)]);
  return [...ids].sort().map((zoneId) => {
    const w = waiting.get(zoneId) ?? 0;
    const e = Math.round((expected.get(zoneId) ?? 0) * 10) / 10;
    const d = drivers.get(zoneId) ?? 0;
    const demand = w + e;
    const level = demand >= 2 && demand > d ? 'hot' : demand >= 1 ? 'warm' : 'calm';
    return { zoneId, waiting: w, expected: e, drivers: d, level };
  });
}

/** The forecast windows: this coming hour on the same weekday, `weeks` weeks back. */
export function forecastWindows(now: Date, weeks: number): Array<{ from: Date; to: Date }> {
  const WEEK = 7 * 86_400_000;
  return Array.from({ length: weeks }, (_, i) => ({ from: new Date(now.getTime() - (i + 1) * WEEK), to: new Date(now.getTime() - (i + 1) * WEEK + 3_600_000) }));
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

/** Cap share at which the app starts warning (money §4 / partner.cap_warning; UI/UX audit P-05: amber from 70 %). */
export const NEAR_CAP_SHARE = CAP_WARN_SHARE;

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

/** Local hour (Baghdad) until which a shift that crossed midnight runs on yesterday's check-in. */
export const MIDNIGHT_GRACE_UNTIL_HOUR = 4;

/**
 * Whether a closed gate still lets this `goOnline` through: the app re-sends `goOnline` every 30 s
 * as a heartbeat, so a driver already online when the local day turns keeps his night shift on
 * yesterday's check-in until 04:00 local; after that the heartbeat needs today's check-in like any
 * first online (scoring §2), so staying online can never skip it. A lock-out or an expired document
 * ends it at once.
 */
export function gateAllowsHeartbeat(gate: PartnerOnlineGate, alreadyOnline: boolean, now: Date, offsetMin = BAGHDAD_OFFSET_MIN): boolean {
  if (gate.canGoOnline) return true;
  const localHour = new Date(now.getTime() + offsetMin * 60_000).getUTCHours();
  return alreadyOnline && localHour < MIDNIGHT_GRACE_UNTIL_HOUR && gate.reasons.every((r) => r.code === 'checkin_required');
}
