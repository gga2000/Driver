import { AZIZIYAH_ZONES, type LatLng } from '@driver/contracts';
import { haversineMeters } from '../trips/index.js';
import { createRand, type Rand } from './prng.js';
import { pinIn, zoneSeed, type World } from './world.js';

/**
 * The demand plan (plan Step 7): when each order is placed, by whom, for what, and how its
 * customer behaves. Default mix 70 % food (auto-assign), 25 % city rides (broadcast), 5 % orders
 * the customer cancels at a random stage; about one ride in ten is booked «بعدين» (step 4, c10). «دوّرلي»
 * errands come on top (3 % of the orders, from their own stream). City peaks shape the day: lunch 13:00–15:00 and dinner
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

/** One «دوّرلي» item on the customer's list: his words, how many, and what he guesses it costs. */
export interface PlannedErrandLine {
  freeText: string;
  qty: number;
  estimateIqd: number;
}

/** A «دوّرلي» run: the shops, the list, and what really happens at the shops (sim truth, from the seed). */
export interface PlannedErrand {
  pickupZone: string;
  pickupPin: LatLng;
  lines: PlannedErrandLine[];
  /** The whole list's ceiling the customer set (over it the shopper calls first; the receipt still records). */
  listMaxIqd: number;
  /** Minutes the shopper spends buying the list once he is at the shops. */
  shopMin: number;
  /** What the receipt says: the estimate, off by what the shops really charged (a multiple of 250). */
  receiptIqd: number;
  /** The customer's tip at checkout (0 most of the time). */
  tipIqd: number;
  /** The receipt photo would not send: the shopper reads the amount out and ops record it (`orders.ops.recordErrandReceipt`). */
  photoFails: boolean;
}

export interface PlannedOrder {
  key: string;
  /** Minutes after the day opens. */
  atMin: number;
  kind: 'food' | 'ride' | 'errand';
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
  /** Ride booked «بعدين» (step 4, c10): this many minutes ahead (on the 5-minute grid); null = now. */
  bookAheadMin: number | null;
  /** What the kitchen will do with it (food): exactly 3 % rejected, 2 % partially accepted. */
  kitchen: 'accept' | 'reject' | 'partial';
  /** «دوّرلي» only: the shops, the list and the receipt. */
  errand: PlannedErrand | null;
}

export interface ScenarioOptions {
  orders: number;
  /** Shares of the mix; default 0.70 food / 0.25 rides / 0.05 cancellations. */
  foodShare?: number;
  rideShare?: number;
  /** Share of the rides not cancelled that are booked ahead; default 0.1. */
  bookedShare?: number;
  /**
   * «دوّرلي» errands on top of the mix, as a share of `orders` (default 0.03, at least one when
   * above 0; 0 when the city has not opened errands). Planned from their own stream, so the rest of
   * the plan is the same with or without them.
   */
  errandShare?: number;
}

/** What people send a shopper for in Aziziyah, with a fair guess of the price (dinars, per unit). */
const ERRAND_ITEMS: ReadonlyArray<{ freeText: string; estimateIqd: number; maxQty: number }> = [
  { freeText: 'صمون', estimateIqd: 250, maxQty: 20 },
  { freeText: 'معجون أسنان', estimateIqd: 1_500, maxQty: 3 },
  { freeText: 'حليب نيدو', estimateIqd: 9_000, maxQty: 2 },
  { freeText: 'طماطة كيلو', estimateIqd: 1_000, maxQty: 3 },
  { freeText: 'بيض طبقة', estimateIqd: 5_500, maxQty: 2 },
  { freeText: 'دفتر وقلم', estimateIqd: 1_500, maxQty: 4 },
  { freeText: 'رصيد آسيا', estimateIqd: 5_000, maxQty: 2 },
  { freeText: 'شاي محمود', estimateIqd: 3_500, maxQty: 2 },
  { freeText: 'ركي', estimateIqd: 3_000, maxQty: 1 },
  { freeText: 'شاحن موبايل', estimateIqd: 4_000, maxQty: 1 },
];

/** «دوّرلي» runs from their own stream (`scenario:errands`): when, who, which shops, the list and the receipt. */
function planErrands(world: World, n: number): PlannedOrder[] {
  const rand = createRand(world.seed).fork('scenario:errands');
  const shopsZones = AZIZIYAH_ZONES.filter((z) => z.tier !== 'edge');
  const out: PlannedOrder[] = [];
  for (let i = 0; i < n; i += 1) {
    const customer = rand.int(0, world.customers.length - 1);
    const c = world.customers[customer]!;
    const shops = rand.pick(shopsZones);
    const count = rand.int(1, 4);
    const lines: PlannedErrandLine[] = [];
    for (let k = 0; k < count; k += 1) {
      const item = rand.pick(ERRAND_ITEMS);
      if (lines.some((l) => l.freeText === item.freeText)) continue;
      lines.push({ freeText: item.freeText, qty: rand.int(1, item.maxQty), estimateIqd: item.estimateIqd });
    }
    const estimate = lines.reduce((sum, l) => sum + l.qty * l.estimateIqd, 0);
    // The shops charge a little more or less than he guessed; now and then a lot more (over his ceiling).
    const factor = rand.chance(0.06) ? rand.range(1.6, 2) : rand.range(0.85, 1.2);
    const receiptIqd = Math.max(250, Math.round((estimate * factor) / 250) * 250);
    out.push({
      key: `e${i + 1}`,
      atMin: sampleMinute(rand, 'ride'),
      kind: 'errand',
      customer,
      payment: 'cash',
      restaurant: null,
      lines: [],
      rideVertical: null,
      dropoffZone: c.zoneId,
      dropoffPin: c.home,
      cancel: null,
      unreachableSec: 0,
      boardingSec: 0,
      bookAheadMin: null,
      kitchen: 'accept',
      errand: {
        pickupZone: shops.id,
        pickupPin: pinIn(shops.id, rand),
        lines,
        listMaxIqd: Math.ceil((estimate * 1.5) / 1000) * 1000,
        shopMin: rand.int(5, 20),
        receiptIqd,
        tipIqd: rand.chance(0.2) ? 1_000 : 0,
        photoFails: rand.chance(0.15),
      },
    });
  }
  return out;
}

/** Rides booked ahead are booked 30–90 minutes ahead (some get the half-hour reminder, some do not). */
export const BOOK_AHEAD_MIN = { from: 30, to: 90 } as const;

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
      bookAheadMin: null,
      kitchen: 'accept' as const,
      errand: null,
    };
  });

  // «بعدين» (step 4, c10): from its own stream, so the rest of the plan is the same as before. The ride
  // and its search fit before the day closes.
  const later = createRand(world.seed).fork('scenario:booked');
  const bookedShare = opts.bookedShare ?? 0.1;
  for (const p of planned) {
    if (p.kind !== 'ride' || p.cancel || !later.chance(bookedShare)) continue;
    const ahead = later.int(BOOK_AHEAD_MIN.from / 5, BOOK_AHEAD_MIN.to / 5) * 5;
    if (p.atMin + ahead + 5 <= DAY_MINUTES - 20) p.bookAheadMin = ahead;
  }

  // Kitchen behaviour (plan Step 7): exactly 3 % of food orders rejected, 2 % partially accepted
  // (those need two lines or more).
  const food = planned.filter((p) => p.kind === 'food' && !p.cancel);
  shuffle(food, rand);
  const nReject = Math.round(food.length * 0.03);
  food.slice(0, nReject).forEach((p) => (p.kitchen = 'reject'));
  food.slice(nReject).filter((p) => p.lines.length >= 2).slice(0, Math.round(food.length * 0.02)).forEach((p) => (p.kitchen = 'partial'));

  // «دوّرلي»: on top of the mix, merged in by time (a stable sort keeps the others in their order).
  const errandShare = opts.errandShare ?? 0.03;
  const nErrands = errandShare > 0 ? Math.max(1, Math.round(opts.orders * errandShare)) : 0;
  if (nErrands === 0) return planned;
  return [...planned, ...planErrands(world, nErrands)].sort((a, b) => a.atMin - b.atMin);
}

function shuffle<T>(items: T[], rand: Rand): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = rand.int(0, i);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
}
