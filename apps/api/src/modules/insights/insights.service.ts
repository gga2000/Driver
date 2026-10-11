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
  walletLines(account: string, events: readonly LedgerEvent[]): WalletLine[];
  restaurantsInCity(cityId: string): Promise<number>;
}
export const STATS_SOURCES = Symbol('STATS_SOURCES');

/** The city a person with no orders yet is counted against. */
const HOME_CITY = 'aziziyah';
/** «خريطتك» draws at most this many of the period's latest meals (one trip read each). */
const MAP_MEALS = 200;

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
    const current = baghdadMonth(now);
    const personId = actor.personId;
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
    const rides = new Map<string, StatsRide>();
    for (const o of chartOrders.filter(isRide)) {
      const r = await this.stats_.rideOf(o.id);
      if (r) rides.set(o.id, r);
    }
    const meals = orders.filter(isMeal);
    // «خريطتك» needs where each meal came from and went: the latest 200 meals of the period are plenty.
    for (const o of [...meals].sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime()).slice(0, MAP_MEALS)) {
      const r = await this.stats_.rideOf(o.id);
      if (r) rides.set(o.id, r);
    }
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
      trips: tripMap(home, meals, rideOrders, rides, bookings, from, to),
    };
    const r = view.rajaa;
    const hasActivity = view.food.orders + view.rides.taxi + view.rides.tuktuk + r.baghdad + r.kut > 0 || saved.totalIqd > 0 || view.points.earned > 0 || bookings.some((b) => b.state === 'completed' && b.completedAt !== null && within(b.completedAt));
    return { ...view, hasActivity };
  }
}
