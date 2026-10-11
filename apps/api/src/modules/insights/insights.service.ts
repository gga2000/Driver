import { Inject, Injectable } from '@nestjs/common';
import {
  baghdadMonth,
  baghdadMonthRange,
  DriverError,
  HOUSEHOLD_RULES,
  MonthInput,
  shiftMonth,
  type Actor,
  type InsightsPort,
  type LedgerEvent,
  type MonthInsightsView,
  type MonthKey,
  StatsInput,
  type StatsTrips,
  type StatsView,
  type WalletLine,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { hasActivity, monthCounts, pointsEarnedBetween, type MonthOrder } from './month.js';
import {
  doorMinutes,
  favourites,
  isMeal,
  isRide,
  monthColumns,
  pointsUse,
  promiseKept,
  rajaaFacts,
  rideFacts,
  savedOffBills,
  spentBetween,
  statsMonths,
  tripMap,
  decodeRoad,
  simplifyRoad,
  whenGrid,
  type StatsBooking,
  type StatsOrder,
  type StatsPoint,
  type StatsRide,
} from './stats.js';

/**
 * What «شهرك» reads (bound in `InsightsModule` to orders, orgs/catalog, routes and the ledger): the
 * person's own orders with lines, kitchen and dish names, الرجعة seats travelled, and ledger lines.
 */
export interface InsightsSources {
  ordersPlacedBy(personId: string, from: Date, to: Date): Promise<MonthOrder[]>;
  merchantName(orgId: string): Promise<string | null>;
  itemNames(orgId: string, ids: readonly string[]): Promise<Map<string, string>>;
  /** الرجعة bookings of this rider completed in `[from, to)`. */
  seatsTravelled(personId: string, from: Date, to: Date): Promise<number>;
  eventsFor(account: string): Promise<LedgerEvent[]>;
  /** The ledger's «وفّرت» (w10's sum, `savedBetween`) over the customer's account. */
  saved(personId: string, events: readonly LedgerEvent[], from: Date, to: Date): number;
  customerAccount(personId: string): string;
  pointsAccount(personId: string): string;
}
export const INSIGHTS_SOURCES = Symbol('INSIGHTS_SOURCES');

/**
 * What «دفترك ويا درايفر» reads on top of «شهرك»'s sources (bound in `InsightsModule`): every order
 * the person placed, the trip behind a ride, their الرجعة bookings, their saved places' names, the
 * readable wallet lines, and how many restaurants the city has on the app.
 */
export interface StatsSources {
  ordersEverBy(personId: string): Promise<StatsOrder[]>;
  /** The latest trip that carried this order (taxi/tuktuk, driver, pickup wait, saved place it ended at). */
  rideOf(orderId: string): Promise<StatsRide | null>;
  bookingsOf(personId: string): Promise<StatsBooking[]>;
  placeNames(personId: string): Promise<Map<string, string>>;
  /** His saved home's pin, if he saved one. */
  homeOf(personId: string): Promise<StatsPoint | null>;
  /** The routed road from `from` to `to` as an encoded polyline (precision 6); null when only the straight line is known. */
  roadBetween(from: StatsPoint, to: StatsPoint): Promise<string | null>;
  walletLines(account: string, events: readonly LedgerEvent[]): WalletLine[];
  restaurantsInCity(cityId: string): Promise<number>;
}
export const STATS_SOURCES = Symbol('STATS_SOURCES');

/** The city a person with no orders yet is counted against. */
const HOME_CITY = 'aziziyah';
/** «خريطتك» draws at most this many of the period's latest meals (one trip read each). */
const MAP_MEALS = 200;
/** «خريطتك» follows the streets for at most this many town traces (the most travelled first); the rest draw straight. */
const MAP_ROADS = 40;
/** The page is cached per person, period and month for this long; opening it again re-reads nothing. */
const STATS_CACHE_MS = 60_000;
const STATS_CACHE_MAX = 2_000;
/** Roads between the same ends are remembered for a day. */
const ROAD_CACHE_MS = 24 * 3_600_000;
const ROAD_CACHE_MAX = 5_000;
/** Reads (and road lookups) in flight at once for one page. */
const READS_AT_ONCE = 8;

/**
 * `wallet.month` (joy w6 «شهرك»): the caller's own month, counted here from real orders, rides,
 * الرجعة bookings and ledger lines; nothing estimated, nobody else's data. Months: the current
 * Baghdad month and up to `HOUSEHOLD_RULES.monthsBack` before it.
 */
@Injectable()
export class InsightsService implements InsightsPort {
  constructor(
    @Inject(INSIGHTS_SOURCES) private readonly src: InsightsSources,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STATS_SOURCES) private readonly stats_: StatsSources,
  ) {}

  private readonly statsCache = new Map<string, { until: number; view: StatsView }>();
  private readonly statsRunning = new Map<string, Promise<StatsView>>();
  private readonly roadCache = new Map<string, { until: number; path: StatsPoint[] | null }>();

  async month(actor: Actor, raw: z.infer<typeof MonthInput>): Promise<MonthInsightsView> {
    const input = MonthInput.parse(raw);
    const now = this.clock.now();
    const current = baghdadMonth(now);
    const earliest = shiftMonth(current, -HOUSEHOLD_RULES.monthsBack);
    const month = input.month ?? current;
    if (month > current || month < earliest) throw new DriverError('invalid_input');
    const { from, to } = baghdadMonthRange(month);
    const personId = actor.personId;
    const [orders, rajaaTrips, money, points] = await Promise.all([
      this.src.ordersPlacedBy(personId, from, to),
      this.src.seatsTravelled(personId, from, to),
      this.src.eventsFor(this.src.customerAccount(personId)),
      this.src.eventsFor(this.src.pointsAccount(personId)),
    ]);
    const counts = monthCounts(orders);
    const [kitchenName, dishKitchen, dishNames] = await Promise.all([
      counts.topKitchen ? this.src.merchantName(counts.topKitchen.merchantOrgId) : Promise.resolve(null),
      counts.topDish ? this.src.merchantName(counts.topDish.merchantOrgId) : Promise.resolve(null),
      counts.topDish ? this.src.itemNames(counts.topDish.merchantOrgId, [counts.topDish.catalogItemId]) : Promise.resolve(new Map<string, string>()),
    ]);
    const dishName = counts.topDish ? (dishNames.get(counts.topDish.catalogItemId) ?? null) : null;
    const view = {
      month,
      earliestMonth: earliest,
      meals: counts.meals,
      kitchens: counts.kitchens,
      topKitchen: counts.topKitchen && kitchenName ? { name: kitchenName, orders: counts.topKitchen.orders } : null,
      topDish: counts.topDish && dishName ? { name: dishName, kitchen: dishKitchen, orders: counts.topDish.orders } : null,
      rides: counts.rides,
      rajaaTrips,
      savedIqd: this.src.saved(personId, money, from, to),
      pointsEarned: pointsEarnedBetween(this.src.pointsAccount(personId), points, from, to),
    };
    return { ...view, hasActivity: hasActivity(view) };
  }

  /**
   * `wallet.stats` «دفترك ويا درايفر»: the caller's own month, year so far or all-time record, counted
   * here from their orders, trips, الرجعة bookings and ledger lines; nothing estimated, nobody else's
   * data. «وفّرت» is what came off their bills (`savedOffBills`), never change kept in the wallet.
   */
  async stats(actor: Actor, raw: z.input<typeof StatsInput>): Promise<StatsView> {
    const input = StatsInput.parse(raw);
    const now = this.clock.now();
    // The key names only what the figures depend on: the month for a month, nothing more for a year or all time.
    const month = input.period === 'month' ? (input.month ?? baghdadMonth(now)) : null;
    if (month && month > baghdadMonth(now)) throw new DriverError('invalid_input');
    const key = `${actor.personId}|${input.period}|${month ?? ''}`;
    const hit = this.statsCache.get(key);
    if (hit && hit.until > now.getTime()) return hit.view;
    const running = this.statsRunning.get(key);
    if (running) return running;
    const view = this.computeStats(actor.personId, input, now);
    this.statsRunning.set(key, view);
    try {
      const done = await view;
      // Only a finished page is kept, so a refused or failed call never pushes anyone else's out.
      this.statsCache.delete(key);
      this.statsCache.set(key, { until: now.getTime() + STATS_CACHE_MS, view: done });
      while (this.statsCache.size > STATS_CACHE_MAX) this.statsCache.delete(this.statsCache.keys().next().value!);
      return done;
    } finally {
      this.statsRunning.delete(key);
    }
  }

  /** The page's figures for one person, period and month (cached briefly by `stats`). */
  private async computeStats(personId: string, input: z.output<typeof StatsInput>, now: Date): Promise<StatsView> {
    const current = baghdadMonth(now);
    const [all, bookings, money, points, places, home] = await Promise.all([
      this.stats_.ordersEverBy(personId),
      this.stats_.bookingsOf(personId),
      this.src.eventsFor(this.src.customerAccount(personId)),
      this.src.eventsFor(this.src.pointsAccount(personId)),
      this.stats_.placeNames(personId),
      this.stats_.homeOf(personId),
    ]);
    const firstOrderAt = all.reduce<Date | null>((min, o) => (min === null || o.placedAt < min ? o.placedAt : min), null);
    const earliest: MonthKey = firstOrderAt ? baghdadMonth(firstOrderAt) : current;
    let month: MonthKey | null = null;
    let from: Date;
    let to = new Date(now.getTime() + 1);
    let months: MonthKey[];
    if (input.period === 'month') {
      month = input.month ?? current;
      if (month > current || month < earliest) throw new DriverError('invalid_input');
      ({ from, to } = baghdadMonthRange(month));
      months = [month];
    } else if (input.period === 'year') {
      const jan = `${current.slice(0, 4)}-01` as MonthKey;
      from = baghdadMonthRange(jan).from;
      months = statsMonths(jan, current);
    } else {
      from = new Date(0);
      months = statsMonths(earliest, current);
    }
    const within = (at: Date) => at.getTime() >= from.getTime() && at.getTime() < to.getTime();
    const orders = all.filter((o) => within(o.placedAt));
    const rideOrders = orders.filter(isRide);
    const chartOrders = all.filter((o) => months.includes(baghdadMonth(o.placedAt)));
    const meals = orders.filter(isMeal);
    // «خريطتك» needs where each meal came from and went: the latest 200 meals of the period are plenty.
    const mapMeals = [...meals].sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime()).slice(0, MAP_MEALS);
    const rides = await this.ridesOf([...chartOrders.filter(isRide), ...mapMeals].map((o) => o.id));
    const fav = favourites(meals);
    const topKitchens = await Promise.all(fav.kitchens.slice(0, 5).map(async (k) => ({ name: await this.src.merchantName(k.merchantOrgId), orders: k.orders })));
    const topDishes: StatsView['food']['topDishes'] = [];
    for (const d of fav.dishes.slice(0, 3)) {
      const [name, kitchen] = await Promise.all([this.src.itemNames(d.merchantOrgId, [d.catalogItemId]).then((m) => m.get(d.catalogItemId) ?? null), this.src.merchantName(d.merchantOrgId)]);
      if (name) topDishes.push({ name, kitchen, orders: d.orders, catalogItemId: d.catalogItemId });
    }
    const customer = this.src.customerAccount(personId);
    const saved = savedOffBills(customer, money, from, to);
    const ride = rideFacts(rideOrders, rides);
    const top = [...ride.places.entries()].filter(([id, n]) => n >= 2 && places.has(id)).sort((a, b) => b[1] - a[1])[0];
    const pointsAccount = this.src.pointsAccount(personId);
    const pts = pointsUse(pointsAccount, points, from, to);
    const view: Omit<StatsView, 'hasActivity'> = {
      period: input.period,
      month,
      earliestMonth: earliest,
      firstOrderAt,
      saved,
      months: monthColumns(months, chartOrders, rides, bookings, (m) => {
        const r = baghdadMonthRange(m);
        return savedOffBills(customer, money, r.from, r.to).totalIqd;
      }),
      food: {
        orders: meals.length,
        kitchens: fav.kitchens.length,
        kitchensInTown: await this.stats_.restaurantsInCity(HOME_CITY),
        topKitchens: topKitchens.filter((k): k is { name: string; orders: number } => k.name !== null),
        topDishes,
        when: whenGrid(meals),
        promise: promiseKept(meals),
        doorMinutes: doorMinutes(meals),
      },
      rides: { taxi: ride.taxi, tuktuk: ride.tuktuk, pickupWaitMinutes: ride.pickupWaitMinutes, topPlace: top ? { name: places.get(top[0])!, visits: top[1] } : null, drivers: ride.drivers },
      rajaa: rajaaFacts(bookings, from, to),
      money: { spentIqd: spentBetween(this.stats_.walletLines(customer, money), from, to) },
      points: { earned: pointsEarnedBetween(pointsAccount, points, from, to), used: pts.used, balance: pts.balance },
      trips: await this.withRoads(tripMap(home, meals, rideOrders, rides, bookings, from, to)),
    };
    const r = view.rajaa;
    const hasActivity = view.food.orders + view.rides.taxi + view.rides.tuktuk + r.baghdad + r.kut > 0 || saved.totalIqd > 0 || view.points.earned > 0 || bookings.some((b) => b.state === 'completed' && b.completedAt !== null && within(b.completedAt));
    return { ...view, hasActivity };
  }

  /**
   * «خريطتك» look A: each town trace follows its streets — the routed road between its ends, simplified to
   * about 10 m. الرجعة stays a direction (no path); a road the router can't give draws straight.
   */
  private async withRoads(trips: StatsTrips): Promise<StatsTrips> {
    const town = trips.traces.filter((t) => t.service !== 'rajaa').sort((a, b) => b.count - a.count).slice(0, MAP_ROADS);
    for (let i = 0; i < town.length; i += READS_AT_ONCE) {
      await Promise.all(
        town.slice(i, i + READS_AT_ONCE).map(async (t) => {
          const path = await this.roadFor(t.from, t.to);
          if (path) t.path = path;
        }),
      );
    }
    return trips;
  }

  /** One trace's simplified road, remembered by its rounded ends (a road doesn't change from one open to the next). */
  private async roadFor(from: StatsPoint, to: StatsPoint): Promise<StatsPoint[] | null> {
    const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}|${to.lat.toFixed(4)},${to.lng.toFixed(4)}`;
    const now = this.clock.now().getTime();
    const hit = this.roadCache.get(key);
    if (hit && hit.until > now) return hit.path;
    const encoded = await this.stats_.roadBetween(from, to).catch(() => undefined);
    if (encoded === undefined) return null; // the router failed: draw straight now, ask again next time
    const road = encoded ? decodeRoad(encoded) : null;
    const path = road ? simplifyRoad(road) : null;
    this.roadCache.delete(key);
    this.roadCache.set(key, { until: now + ROAD_CACHE_MS, path });
    while (this.roadCache.size > ROAD_CACHE_MAX) this.roadCache.delete(this.roadCache.keys().next().value!);
    return path;
  }

  /** The trip behind each order, read a few at a time. */
  private async ridesOf(orderIds: readonly string[]): Promise<Map<string, StatsRide>> {
    const out = new Map<string, StatsRide>();
    const ids = [...new Set(orderIds)];
    for (let i = 0; i < ids.length; i += READS_AT_ONCE) {
      const batch = ids.slice(i, i + READS_AT_ONCE);
      const got = await Promise.all(batch.map((id) => this.stats_.rideOf(id)));
      got.forEach((r, k) => r && out.set(batch[k]!, r));
    }
    return out;
  }
}
