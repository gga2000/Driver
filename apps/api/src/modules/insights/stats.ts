import {
  baghdadMonth,
  LATE_PROMISE_MEMO,
  shiftMonth,
  statsDayBand,
  STATS_DAY_BANDS,
  type LedgerEvent,
  type MonthKey,
  type OrderState,
  type OrderType,
  type StatsMonth,
  type StatsSaved,
  type WalletLine,
} from '@driver/contracts';

/** The order facts «دفترك» counts: one of the person's own orders with its lines and promise. */
export interface StatsOrder {
  id: string;
  type: OrderType;
  state: OrderState;
  merchantOrgId: string | null;
  placedAt: Date;
  deliveredAt: Date | null;
  scheduledFor: Date | null;
  promisedReadyAt: Date | null;
  promisedRideMin: number | null;
  lines: ReadonlyArray<{ catalogItemId: string | null; qty: number; removed: boolean }>;
}

/** What the trip behind a ride says: taxi or tuktuk, its driver, the wait at the pickup, where it ended. */
export interface StatsRide {
  vertical: string;
  driverId: string | null;
  acceptedAt: Date | null;
  pickupArrivedAt: Date | null;
  dropoffPlaceId: string | null;
}

/** One الرجعة booking of the person's. */
export interface StatsBooking {
  state: string;
  completedAt: Date | null;
  cityId: string | null;
  frontSeat: boolean;
  lapChildren: number;
  returnDiscountIqd: number;
}

const MEAL_TYPES: ReadonlySet<OrderType> = new Set(['food', 'grocery_catalog']);
const RIDE_DONE: ReadonlySet<OrderState> = new Set(['completed', 'closed']);
/** Wallet lines that are a purchase (what the person spent); tips, top-ups, credits and change are not. */
const SPENT_KINDS: ReadonlySet<string> = new Set(['food', 'grocery', 'errand', 'ride', 'seat', 'subscription', 'parcel', 'purchase']);
const BAGHDAD_MS = 3 * 3_600_000;
/** An all-time chart shows at most the latest two years of columns. */
export const STATS_MAX_MONTHS = 24;

const inRange = (at: Date | null, from: Date, to: Date): at is Date => at !== null && at.getTime() >= from.getTime() && at.getTime() < to.getTime();

/** A meal that reached the person (counted by when it was placed). */
export const isMeal = (o: StatsOrder): boolean => MEAL_TYPES.has(o.type) && o.deliveredAt !== null;
/** A taxi or tuktuk ride that finished. */
export const isRide = (o: StatsOrder): boolean => o.type === 'ride' && RIDE_DONE.has(o.state);

/**
 * «وفّرت» (option ①): the `promo_funded` lines paid into the person's own account — kitchen deals
 * (`deal:`), our promotions (`promo:`), points against fees (`points:`) and the الرجعة return discount
 * (`return_bundle`). `madeGoodIqd` is what we paid back when we fell short: the late-delivery credit,
 * the rider credit for a late driver, and a driver's cancel fee paid to the person. Change kept in
 * the wallet is the person's own money and counts nowhere. Pure.
 */
export function savedOffBills(account: string, events: readonly LedgerEvent[], from: Date, to: Date): StatsSaved {
  const out = { totalIqd: 0, dealsIqd: 0, promosIqd: 0, pointsIqd: 0, returnTripIqd: 0, madeGoodIqd: 0 };
  for (const e of events) {
    if (e.kind !== 'money' || e.toAccount !== account || !inRange(e.occurredAt, from, to)) continue;
    if (e.type === 'promo_funded') {
      const memo = e.memo ?? '';
      if (memo.startsWith('deal:')) out.dealsIqd += e.amount;
      else if (memo.startsWith('points:')) out.pointsIqd += e.amount;
      else if (memo === 'return_bundle') out.returnTripIqd += e.amount;
      else out.promosIqd += e.amount;
      out.totalIqd += e.amount;
    } else if (
      (e.type === 'credit_issued' && e.memo === LATE_PROMISE_MEMO) ||
      e.type === 'late_penalty_rider_credit' ||
      e.type === 'cancellation_fee' ||
      e.type === 'departure_cancel_fee'
    ) {
      out.madeGoodIqd += e.amount;
    }
  }
  return out;
}

/** What the person paid for orders, rides, seats and subscriptions in `[from, to)` (wallet and cash alike). Pure. */
export function spentBetween(lines: readonly WalletLine[], from: Date, to: Date): number {
  return lines.filter((l) => l.book === 'money' && SPENT_KINDS.has(l.kind) && l.amount < 0 && inRange(l.occurredAt, from, to)).reduce((s, l) => s - l.amount, 0);
}

/** Points spent in `[from, to)` and the account's balance now. Pure. */
export function pointsUse(account: string, events: readonly LedgerEvent[], from: Date, to: Date): { used: number; balance: number } {
  let used = 0;
  let balance = 0;
  for (const e of events) {
    if (e.kind !== 'points') continue;
    if (e.toAccount === account) balance += e.amount;
    if (e.fromAccount === account) {
      balance -= e.amount;
      if (e.type === 'points_redeemed' && inRange(e.occurredAt, from, to)) used += e.amount;
    }
  }
  return { used, balance: Math.max(0, balance) };
}

/** The months a period's chart shows, oldest first. */
export function statsMonths(first: MonthKey, last: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = last; m >= first && out.length < STATS_MAX_MONTHS; m = shiftMonth(m, -1)) out.unshift(m);
  return out;
}

/** One column per month: meals, taxi and tuktuk rides, الرجعة seats and «وفّرت». Pure. */
export function monthColumns(
  months: readonly MonthKey[],
  orders: readonly StatsOrder[],
  rides: ReadonlyMap<string, StatsRide>,
  bookings: readonly StatsBooking[],
  savedByMonth: (m: MonthKey) => number,
): StatsMonth[] {
  const cols = new Map(months.map((m) => [m, { month: m, food: 0, taxi: 0, tuktuk: 0, rajaa: 0, savedIqd: 0 }]));
  for (const o of orders) {
    const c = cols.get(baghdadMonth(o.placedAt));
    if (!c) continue;
    if (isMeal(o)) c.food += 1;
    else if (isRide(o)) {
      if (rides.get(o.id)?.vertical === 'tuktuk') c.tuktuk += 1;
      else c.taxi += 1;
    }
  }
  for (const b of bookings) {
    if (b.state !== 'completed' || !b.completedAt) continue;
    const c = cols.get(baghdadMonth(b.completedAt));
    if (c) c.rajaa += 1;
  }
  for (const c of cols.values()) c.savedIqd = savedByMonth(c.month);
  return [...cols.values()];
}

/** Meals by weekday (0 = Saturday … 6 = Friday) × time of day, Baghdad time. Pure. */
export function whenGrid(meals: readonly StatsOrder[]): number[][] {
  const grid = Array.from({ length: 7 }, () => STATS_DAY_BANDS.map(() => 0));
  for (const o of meals) {
    const local = new Date(o.placedAt.getTime() + BAGHDAD_MS);
    const day = (local.getUTCDay() + 1) % 7;
    grid[day]![STATS_DAY_BANDS.indexOf(statsDayBand(local.getUTCHours()))]! += 1;
  }
  return grid;
}

/** Delivered meals that carried a promised time, and how many arrived by it (ready + the locked ride). Pure. */
export function promiseKept(meals: readonly StatsOrder[]): { promised: number; onTime: number } {
  let promised = 0;
  let onTime = 0;
  for (const o of meals) {
    if (!o.deliveredAt || !o.promisedReadyAt || o.promisedRideMin == null) continue;
    promised += 1;
    if (o.deliveredAt.getTime() <= o.promisedReadyAt.getTime() + o.promisedRideMin * 60_000) onTime += 1;
  }
  return { promised, onTime };
}

/** Placed → at the door in minutes (scheduled orders left out): the average and the fastest. Pure. */
export function doorMinutes(meals: readonly StatsOrder[]): { average: number; fastest: number } | null {
  const mins = meals.filter((o) => o.deliveredAt && !o.scheduledFor).map((o) => Math.max(0, Math.round((o.deliveredAt!.getTime() - o.placedAt.getTime()) / 60_000)));
  if (mins.length === 0) return null;
  return { average: Math.round(mins.reduce((a, b) => a + b, 0) / mins.length), fastest: Math.min(...mins) };
}

/** Kitchens by orders, then dishes by the orders they were on (ties: more portions, then the latest). Pure. */
export function favourites(meals: readonly StatsOrder[]): {
  kitchens: Array<{ merchantOrgId: string; orders: number }>;
  dishes: Array<{ merchantOrgId: string; catalogItemId: string; orders: number }>;
} {
  const kitchens = new Map<string, { orders: number; last: number }>();
  const dishes = new Map<string, { merchantOrgId: string; catalogItemId: string; orders: number; qty: number; last: number }>();
  for (const o of meals) {
    if (!o.merchantOrgId) continue;
    const at = o.placedAt.getTime();
    const k = kitchens.get(o.merchantOrgId) ?? { orders: 0, last: 0 };
    kitchens.set(o.merchantOrgId, { orders: k.orders + 1, last: Math.max(k.last, at) });
    const seen = new Set<string>();
    for (const l of o.lines) {
      if (!l.catalogItemId || l.removed) continue;
      const key = `${o.merchantOrgId}\u0000${l.catalogItemId}`;
      const d = dishes.get(key) ?? { merchantOrgId: o.merchantOrgId, catalogItemId: l.catalogItemId, orders: 0, qty: 0, last: 0 };
      dishes.set(key, { ...d, orders: d.orders + (seen.has(key) ? 0 : 1), qty: d.qty + l.qty, last: Math.max(d.last, at) });
      seen.add(key);
    }
  }
  return {
    kitchens: [...kitchens.entries()].sort((a, b) => b[1].orders - a[1].orders || b[1].last - a[1].last).map(([merchantOrgId, k]) => ({ merchantOrgId, orders: k.orders })),
    dishes: [...dishes.values()].sort((a, b) => b.orders - a.orders || b.qty - a.qty || b.last - a.last).map(({ merchantOrgId, catalogItemId, orders }) => ({ merchantOrgId, catalogItemId, orders })),
  };
}

/** Taxi and tuktuk counts, the average wait at the pickup, distinct drivers and the saved place ridden to most. Pure. */
export function rideFacts(
  rideOrders: readonly StatsOrder[],
  rides: ReadonlyMap<string, StatsRide>,
): { taxi: number; tuktuk: number; pickupWaitMinutes: number | null; drivers: number; places: Map<string, number> } {
  let taxi = 0;
  let tuktuk = 0;
  const waits: number[] = [];
  const drivers = new Set<string>();
  const places = new Map<string, number>();
  for (const o of rideOrders) {
    const r = rides.get(o.id);
    if (r?.vertical === 'tuktuk') tuktuk += 1;
    else taxi += 1;
    if (!r) continue;
    if (r.driverId) drivers.add(r.driverId);
    if (r.acceptedAt && r.pickupArrivedAt) waits.push(Math.max(0, (r.pickupArrivedAt.getTime() - r.acceptedAt.getTime()) / 60_000));
    if (r.dropoffPlaceId) places.set(r.dropoffPlaceId, (places.get(r.dropoffPlaceId) ?? 0) + 1);
  }
  return { taxi, tuktuk, pickupWaitMinutes: waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : null, drivers: drivers.size, places };
}

/** الرجعة seats travelled in `[from, to)`: to Baghdad, to Kut, front seats, lap children, return-trip discounts. Pure. */
export function rajaaFacts(bookings: readonly StatsBooking[], from: Date, to: Date): { baghdad: number; kut: number; frontSeats: number; lapChildren: number; returnTrips: number } {
  const done = bookings.filter((b) => b.state === 'completed' && inRange(b.completedAt, from, to));
  return {
    baghdad: done.filter((b) => b.cityId === 'baghdad').length,
    kut: done.filter((b) => b.cityId === 'kut').length,
    frontSeats: done.filter((b) => b.frontSeat).length,
    lapChildren: done.reduce((s, b) => s + b.lapChildren, 0),
    returnTrips: done.filter((b) => b.returnDiscountIqd > 0).length,
  };
}
