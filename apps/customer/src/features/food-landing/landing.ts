import { doorOrder, doorMoment, type DoorMoment, type FoodDoor } from '@driver/contracts';
import { doorFact, doorShops, type DoorFact } from '@/features/doors/doors';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';

/**
 * The food landing, «سوق الليل» (Ali 2026-10-08: A's street on top, B's photo tiles under it, C's
 * showcase, then the kitchens). Pure (no React), so every rule is tested: what the street says this
 * hour, which shops are lit, where each shop's tag sits on the photo.
 */

export interface Street {
  moment: DoorMoment;
  /** The four doors in the order this hour wants them (d4). */
  order: readonly FoodDoor[];
  facts: Readonly<Record<FoodDoor, DoorFact>>;
  /** Open shops behind all four doors. */
  openCount: number;
  /** Nothing open anywhere: the street sleeps. */
  asleep: boolean;
  /** Late at night with one door still lit («بس الچاي بعده فاتح»). */
  onlyOpen: FoodDoor | null;
  /** When the street is asleep: the first shop to open, and its door. */
  firstOpen: { at: string; door: FoodDoor } | null;
}

const DOORS: readonly FoodDoor[] = ['meal', 'cafe', 'cold', 'sweet'];

export function streetOf(list: readonly RestaurantSummary[], now: Date): Street {
  const moment = doorMoment(now);
  const facts = Object.fromEntries(DOORS.map((d) => [d, doorFact(list, d)])) as Record<FoodDoor, DoorFact>;
  const shops = DOORS.map((d) => [d, doorShops(list, d)] as const);
  const openCount = shops.reduce((n, [, s]) => n + s.open.length, 0);
  const lit = DOORS.filter((d) => facts[d].kind === 'open');
  const first = shops
    .flatMap(([door, s]) => s.closed.filter((r) => r.opensAt).map((r) => ({ door, at: r.opensAt as string, inMin: r.opensInMin ?? 9999 })))
    .sort((a, b) => a.inMin - b.inMin)[0];
  return {
    moment,
    order: doorOrder(now),
    facts,
    openCount,
    asleep: openCount === 0,
    onlyOpen: moment === 'late' && lit.length === 1 ? (lit[0] ?? null) : null,
    firstOpen: openCount === 0 && first ? { at: first.at, door: first.door } : null,
  };
}

/** The street's two lines, as i18n keys: the second is drawn in gold. */
export type HeadlineKey =
  | { one: `food.landing.h1.${DoorMoment}`; two: `food.landing.h2.${DoorMoment}` }
  | { one: 'food.landing.asleep'; two: `food.landing.only.${FoodDoor}` }
  | { one: 'food.landing.asleep'; two: 'food.landing.opens_at'; time: string }
  | { one: 'food.landing.asleep'; two: 'food.landing.back_soon' };

export function headlineOf(s: Street): HeadlineKey {
  if (s.asleep) {
    return s.firstOpen
      ? { one: 'food.landing.asleep', two: 'food.landing.opens_at', time: s.firstOpen.at }
      : { one: 'food.landing.asleep', two: 'food.landing.back_soon' };
  }
  if (s.onlyOpen) return { one: 'food.landing.asleep', two: `food.landing.only.${s.onlyOpen}` };
  return { one: `food.landing.h1.${s.moment}`, two: `food.landing.h2.${s.moment}` };
}

/** The street sits in the dark: nothing open, or the small hours. */
export function isNight(s: Street): boolean {
  return s.asleep || s.moment === 'late';
}

/**
 * Where each shop stands on the street photo (`assets/food-landing/street.webp`, 1000 × 1787), as
 * shares of its width and height: the spot under each shop's sign, where its tag points.
 */
export const STREET_PHOTO_RATIO = 1787 / 1000;
export const TAG_SPOTS: Readonly<Record<FoodDoor, { x: number; y: number }>> = {
  meal: { x: 0.2, y: 0.47 },
  cold: { x: 0.43, y: 0.575 },
  sweet: { x: 0.65, y: 0.49 },
  cafe: { x: 0.87, y: 0.6 },
};

/** A tag's box on the hero: centred over its spot, pulled back inside the edges (`gutter`). */
export function tagBox(spot: { x: number; y: number }, photo: { width: number; height: number; top: number }, tagWidth: number, gutter = 8): { left: number; pointX: number; pointY: number } {
  const pointX = spot.x * photo.width;
  const pointY = photo.top + spot.y * photo.height;
  const left = Math.min(Math.max(pointX - tagWidth / 2, gutter), photo.width - gutter - tagWidth);
  return { left, pointX, pointY };
}
