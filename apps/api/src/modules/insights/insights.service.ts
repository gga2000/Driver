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
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { hasActivity, monthCounts, pointsEarnedBetween, type MonthOrder } from './month.js';

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
 * `wallet.month` (joy w6 «شهرك»): the caller's own month, counted here from real orders, rides,
 * الرجعة bookings and ledger lines; nothing estimated, nobody else's data. Months: the current
 * Baghdad month and up to `HOUSEHOLD_RULES.monthsBack` before it.
 */
@Injectable()
export class InsightsService implements InsightsPort {
  constructor(
    @Inject(INSIGHTS_SOURCES) private readonly src: InsightsSources,
    @Inject(CLOCK) private readonly clock: Clock,
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
}
