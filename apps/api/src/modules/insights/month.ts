import type { LedgerEvent, MonthInsightsView, MonthKey, OrderState, OrderType } from '@driver/contracts';

/** The order facts «شهرك» counts (one of the person's own orders, with its lines). */
export interface MonthOrder {
  id: string;
  type: OrderType;
  state: OrderState;
  merchantOrgId: string | null;
  placedAt: Date;
  deliveredAt: Date | null;
  lines: ReadonlyArray<{ catalogItemId: string | null; qty: number; removed: boolean }>;
}

/** Points that count as earned this month (the tracking screen's «+{n} نقطة» uses the same pair). */
export const POINTS_EARNED_TYPES: ReadonlySet<string> = new Set(['points_earned', 'organizer_bonus']);

const MEAL_TYPES: ReadonlySet<OrderType> = new Set(['food', 'grocery_catalog']);
const RIDE_DONE: ReadonlySet<OrderState> = new Set(['completed', 'closed']);

/** Points earned into `account` in `[from, to)` (reversals of earned points net out). */
export function pointsEarnedBetween(account: string, events: readonly LedgerEvent[], from: Date, to: Date): number {
  let sum = 0;
  for (const e of events) {
    if (e.kind !== 'points' || !POINTS_EARNED_TYPES.has(e.type)) continue;
    if (e.occurredAt < from || e.occurredAt >= to) continue;
    if (e.toAccount === account) sum += e.amount;
    if (e.fromAccount === account) sum -= e.amount;
  }
  return Math.max(0, sum);
}

/**
 * The month's counts from the person's own orders (joy w6): meals delivered and the kitchens they
 * came from, the kitchen ordered from most and the dish on the most orders (ties: more portions,
 * then the latest), rides completed. Names are filled in by the caller. Pure.
 */
export function monthCounts(orders: readonly MonthOrder[]): {
  meals: number;
  kitchens: number;
  topKitchen: { merchantOrgId: string; orders: number } | null;
  topDish: { merchantOrgId: string; catalogItemId: string; orders: number } | null;
  rides: number;
} {
  const meals = orders.filter((o) => MEAL_TYPES.has(o.type) && o.deliveredAt !== null);
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
  const topKitchen = [...kitchens.entries()].sort((a, b) => b[1].orders - a[1].orders || b[1].last - a[1].last)[0];
  const topDish = [...dishes.values()].sort((a, b) => b.orders - a.orders || b.qty - a.qty || b.last - a.last)[0];
  return {
    meals: meals.length,
    kitchens: kitchens.size,
    topKitchen: topKitchen ? { merchantOrgId: topKitchen[0], orders: topKitchen[1].orders } : null,
    topDish: topDish ? { merchantOrgId: topDish.merchantOrgId, catalogItemId: topDish.catalogItemId, orders: topDish.orders } : null,
    rides: orders.filter((o) => o.type === 'ride' && RIDE_DONE.has(o.state)).length,
  };
}

/** Whether anything happened this month (an empty month shows its own calm page). */
export function hasActivity(v: Pick<MonthInsightsView, 'meals' | 'rides' | 'rajaaTrips' | 'savedIqd' | 'pointsEarned'>): boolean {
  return v.meals + v.rides + v.rajaaTrips > 0 || v.savedIqd > 0 || v.pointsEarned > 0;
}

export type { MonthKey };
