import { AZIZIYAH_ZONES, type LatLng } from '@driver/contracts';
import { haversineMeters } from '../trips/index.js';
import { createRand, type Rand } from './prng.js';
import { pinIn, zoneSeed, type World } from './world.js';

/**
 * The demand plan (plan Step 7): when each order is placed, by whom, for what, and how its
 * customer behaves. Default mix 70 % food (auto-assign), 25 % city rides (broadcast), 5 % orders
 * the customer cancels at a random stage. City peaks shape the day: lunch 13:00–15:00 and dinner
 * 19:30–22:30 (Asia/Baghdad). Built up front from the seed, so it never depends on how the run
 * unfolds.
 */

/** The simulated day opens at 10:00 and closes at 24:00 Baghdad time. */
export const DAY_OPEN_LOCAL_MIN = 10 * 60;
export const DAY_MINUTES = 14 * 60;
/** A Sunday: outside the Friday-prayer pause windows. 10:00 Baghdad = 07:00Z. */
export const DEFAULT_DAY_START = '2026-10-04T07:00:00Z';

export type CancelStage = 'before_merchant' | 'after_accept' | 'searching' | 'driver_en_route';

export interface PlannedLine {
  itemId: string;
  qty: number;
  unitPriceIqd: number;
}

export interface PlannedOrder {
  key: string;
  /** Minutes after the day opens. */
  atMin: number;
  kind: 'food' | 'ride';
  customer: number;
  payment: 'cash' | 'wallet';
  /** Food: restaurant index and lines. */
  restaurant: number | null;
  lines: PlannedLine[];
  /** Rides: taxi (car) or tuktuk, and where to. */
  rideVertical: 'taxi' | 'tuktuk' | null;
  dropoffZone: string;
  dropoffPin: LatLng;
  /** The customer cancels when the order reaches this stage (5 % of orders). */
  cancel: { stage: CancelStage; afterSec: number } | null;
  /** Seconds the customer does not answer at the door (0 = answers at once). */
  unreachableSec: number;
  /** Ride: seconds the rider takes to board once the driver has arrived. */
  boardingSec: number;
  /** What the kitchen will do with it (food): exactly 3 % rejected, 2 % partially accepted. */
  kitchen: 'accept' | 'reject' | 'partial';
}

export interface ScenarioOptions {
  orders: number;
  /** Shares of the mix; default 0.70 food / 0.25 rides / 0.05 cancellations. */
  foodShare?: number;
  rideShare?: number;
}

/** Relative demand per minute of the local day: lunch and dinner peaks. */
export function demandWeight(localMin: number, kind: 'food' | 'ride'): number {
  const h = localMin / 60;
  const lunch = h >= 13 && h < 15;
  const dinner = h >= 19.5 && h < 22.5;
  if (kind === 'ride') return lunch || dinner ? 1.6 : h < 12 ? 1.2 : 1;
  if (lunch) return 3;
  if (dinner) return 3.5;
  if (h >= 12 && h < 13) return 1.5;
  return 1;
}

function sampleMinute(rand: Rand, kind: 'food' | 'ride'): number {
  // Last orders 20 minutes before close.
  const last = DAY_MINUTES - 20;
  for (;;) {
    const m = rand.range(0, last);
    if (rand.next() * 3.5 <= demandWeight(DAY_OPEN_LOCAL_MIN + m, kind)) return Math.round(m * 60) / 60;
  }
}

interface Skeleton {
  atMin: number;
  kind: 'food' | 'ride';
  customer: number;
  payment: 'cash' | 'wallet';
  cancelled: boolean;
}

export function buildScenario(world: World, opts: ScenarioOptions): PlannedOrder[] {
  const rand = createRand(world.seed).fork('scenario');
  const foodShare = opts.foodShare ?? 0.7;
  const rideShare = opts.rideShare ?? 0.25;

  // Pass 1: the mix in exact proportions (shuffled), when, who — then sorted by time so "first three
  // cash orders" means first in time.
  const nFood = Math.round(opts.orders * foodShare);
  const nRide = Math.min(opts.orders - nFood, Math.round(opts.orders * rideShare));
  const mix: Array<'food' | 'ride' | 'cancel'> = [...Array<'food'>(nFood).fill('food'), ...Array<'ride'>(nRide).fill('ride'), ...Array<'cancel'>(opts.orders - nFood - nRide).fill('cancel')];
  shuffle(mix, rand);
  const skeletons: Skeleton[] = mix.map((m) => {
    const kind: 'food' | 'ride' = m === 'cancel' ? (rand.chance(0.6) ? 'food' : 'ride') : m;
    return { atMin: sampleMinute(rand, kind), kind, customer: rand.int(0, world.customers.length - 1), payment: rand.chance(0.92) ? 'cash' : 'wallet', cancelled: m === 'cancel' };
  });
  skeletons.sort((a, b) => a.atMin - b.atMin);

  // Pass 2: the details, in time order.
  const cashOrders = new Map<number, number>();
  const planned: PlannedOrder[] = skeletons.map((s, i) => {
    const c = world.customers[s.customer]!;
    const priorCash = cashOrders.get(s.customer) ?? 0;
    if (s.payment === 'cash') cashOrders.set(s.customer, priorCash + 1);
    // Decisions §4: the first three cash orders of a new account stay under 25,000 all in.
    const newCustomer = s.payment === 'cash' && priorCash < 3;

    let restaurant: number | null = null;
    let lines: PlannedLine[] = [];
    let rideVertical: 'taxi' | 'tuktuk' | null = null;
    let dropoffZone = c.zoneId;
    let dropoffPin = c.home;
    if (s.kind === 'food') {
      restaurant = world.restaurants.indexOf(rand.weighted(world.restaurants, (x) => 1 / (0.5 + haversineMeters(x.pin, c.home) / 1000)));
      const menu = world.restaurants[restaurant]!.menu;
      const budget = newCustomer ? 21_000 : rand.chance(0.06) ? 45_000 : 24_000;
      const n = rand.int(1, 4);
      let total = 0;
      for (let k = 0; k < n; k += 1) {
        const item = rand.pick(menu);
        const qty = rand.chance(0.25) ? 2 : 1;
        if (lines.some((l) => l.itemId === item.id) || total + item.priceIqd * qty > budget) continue;
        lines.push({ itemId: item.id, qty, unitPriceIqd: item.priceIqd });
        total += item.priceIqd * qty;
      }
      if (lines.length === 0) {
        const cheapest = [...menu].sort((a, b) => a.priceIqd - b.priceIqd)[0]!;
        lines = [{ itemId: cheapest.id, qty: 1, unitPriceIqd: cheapest.priceIqd }];
      }
    } else {
      const from = zoneSeed(c.zoneId);
      const others = AZIZIYAH_ZONES.filter((z) => z.id !== c.zoneId);
      const to = rand.weighted(others, (z) => (z.tier === 'edge' ? 0.4 : z.tier === 'far' ? 0.8 : 1.5));
      dropoffZone = to.id;
      dropoffPin = pinIn(to.id, rand);
      const edge = from.tier === 'edge' || to.tier === 'edge';
      rideVertical = !edge && rand.chance(0.45) ? 'tuktuk' : 'taxi';
    }

    let cancel: PlannedOrder['cancel'] = null;
    if (s.cancelled) {
      const stages: CancelStage[] = s.kind === 'food' ? ['before_merchant', 'after_accept', 'driver_en_route'] : ['searching', 'driver_en_route'];
      cancel = { stage: rand.pick(stages), afterSec: rand.int(5, 45) };
    }
    return {
      key: `o${i + 1}`,
      atMin: s.atMin,
      kind: s.kind,
      customer: s.customer,
      payment: s.payment,
      restaurant,
      lines,
      rideVertical,
      dropoffZone,
      dropoffPin,
      cancel,
      // "Sometimes unreachable": 4 % do not pick up at first and answer within 4 minutes.
      unreachableSec: rand.chance(0.04) ? rand.int(40, 220) : 0,
      boardingSec: rand.int(0, 60),
      kitchen: 'accept' as const,
    };
  });

  // Kitchen behaviour (plan Step 7): exactly 3 % of food orders rejected, 2 % partially accepted
  // (those need two lines or more).
  const food = planned.filter((p) => p.kind === 'food' && !p.cancel);
  shuffle(food, rand);
  const nReject = Math.round(food.length * 0.03);
  food.slice(0, nReject).forEach((p) => (p.kitchen = 'reject'));
  food.slice(nReject).filter((p) => p.lines.length >= 2).slice(0, Math.round(food.length * 0.02)).forEach((p) => (p.kitchen = 'partial'));
  return planned;
}

function shuffle<T>(items: T[], rand: Rand): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = rand.int(0, i);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
}
