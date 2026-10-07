import { doorOf, meltsOnTheWay, type FoodDoor } from '@driver/contracts';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import type { Motif } from '@/features/food/food-art';

/**
 * The food doors on the phone (Ali's Yes ideas, 2026-10-07): which shops sit behind a door, the door's
 * live fact, «أحسن 3» with one honest reason each, and when the sort and filter tools are worth showing.
 * Pure (no React), so every rule is tested.
 */

/** The drawing on each door. */
export const DOOR_ART: Readonly<Record<FoodDoor, Motif>> = {
  meal: 'kebab',
  cafe: 'coffee',
  cold: 'juice',
  sweet: 'icecream',
};

export function isFoodDoor(x: unknown): x is FoodDoor {
  return x === 'meal' || x === 'cafe' || x === 'cold' || x === 'sweet';
}

export interface DoorShops {
  open: RestaurantSummary[];
  closed: RestaurantSummary[];
  /** Ice cream shops too far for ice cream to arrive as ice cream (idea i1): named once, not listed. */
  melted: RestaurantSummary[];
}

/** Door time: prep + ride when a place is set, prep alone otherwise. */
export function doorMinutes(
  r: Pick<RestaurantSummary, 'etaMaxMinutes' | 'prepMaxMinutes'>,
): number {
  return r.etaMaxMinutes ?? r.prepMaxMinutes;
}

/** The shops behind one door: open ones (yours first, then the faster), closed ones by who opens first. */
export function doorShops(list: readonly RestaurantSummary[], door: FoodDoor): DoorShops {
  const mine = list.filter((r) => doorOf(r.tags) === door);
  const melted = door === 'sweet' ? mine.filter((r) => meltsOnTheWay(r)) : [];
  const kept = mine.filter((r) => !melted.includes(r));
  return {
    open: kept
      .filter((r) => r.open)
      .sort(
        (a, b) =>
          Number(b.favourite) - Number(a.favourite) ||
          doorMinutes(a) - doorMinutes(b) ||
          a.name.localeCompare(b.name, 'ar'),
      ),
    closed: kept
      .filter((r) => !r.open)
      .sort(
        (a, b) =>
          (a.opensInMin ?? 9999) - (b.opensInMin ?? 9999) || a.name.localeCompare(b.name, 'ar'),
      ),
    melted,
  };
}

/** A door's live line: how many are open, else when the first opens, else nothing behind it yet. */
export type DoorFact =
  | { kind: 'open'; n: number }
  | { kind: 'opens'; at: string }
  | { kind: 'closed' }
  | { kind: 'none' };

export function doorFact(list: readonly RestaurantSummary[], door: FoodDoor): DoorFact {
  const s = doorShops(list, door);
  if (s.open.length > 0) return { kind: 'open', n: s.open.length };
  const first = s.closed[0];
  if (first?.opensAt) return { kind: 'opens', at: first.opensAt };
  return s.closed.length > 0 ? { kind: 'closed' } : { kind: 'none' };
}

/**
 * Why a shop is among the three (ideas r3, k3): one true thing, never an ad (no paid ranking, g3/r5).
 *  - yours:   you ordered from it before
 *  - rated:   the best rating behind this door
 *  - fastest: the shortest door time
 *  - free:    delivers free to your place
 *  - loved:   the most people rated it
 *  - new:     new in Aziziyah (no ratings yet)
 *  - score:   its own rating («تقييمه 4.7»), when no stronger reason is left for it
 */
export type PickReason = 'yours' | 'rated' | 'fastest' | 'free' | 'loved' | 'new' | 'score';

export interface ShopPick {
  shop: RestaurantSummary;
  reason: PickReason;
}

const free = (r: RestaurantSummary) => r.deliveryFeeIqd !== null && r.deliveryFeeIqd <= 0;

/**
 * «أحسن 3» (ideas k1, f4): at most three open shops, each with its own reason. Reasons are tried in a
 * fixed order and each takes the best shop not yet picked that it is true for; ties go to the better
 * rating, then the shorter door time, then the name, so the same town gives the same three.
 */
export function bestThree(open: readonly RestaurantSummary[], max = 3): ShopPick[] {
  const tie = (a: RestaurantSummary, b: RestaurantSummary) =>
    (b.rating ?? -1) - (a.rating ?? -1) ||
    doorMinutes(a) - doorMinutes(b) ||
    a.name.localeCompare(b.name, 'ar');
  const rated = open.filter((r) => r.rating !== null);
  const topRating = Math.max(...rated.map((r) => r.rating ?? 0));
  const fastest = Math.min(...open.map(doorMinutes));
  const mostLoved = Math.max(...rated.map((r) => r.ratingCount));
  const rules: ReadonlyArray<[PickReason, (r: RestaurantSummary) => boolean]> = [
    ['yours', (r) => r.favourite],
    ['rated', (r) => r.rating !== null && r.rating === topRating],
    ['fastest', (r) => doorMinutes(r) === fastest],
    ['free', free],
    ['loved', (r) => r.rating !== null && r.ratingCount === mostLoved && r.ratingCount >= 10],
    ['new', (r) => r.rating === null],
  ];
  const out: ShopPick[] = [];
  for (const [reason, fits] of rules) {
    if (out.length >= max) break;
    const shop = open.filter((r) => fits(r) && !out.some((p) => p.shop.id === r.id)).sort(tie)[0];
    if (shop) out.push({ shop, reason });
  }
  // Fewer reasons than shops (a small door): fill by rating, each still saying something true.
  for (const shop of [...open].sort(tie)) {
    if (out.length >= max) break;
    if (out.some((p) => p.shop.id === shop.id)) continue;
    out.push({ shop, reason: shop.rating === null ? 'new' : free(shop) ? 'free' : 'score' });
  }
  return out;
}

/** Sort and filter tools only when there is something to sort (idea k6): more than this many open shops. */
export const TOOLS_FROM = 8;

export function showTools(openCount: number): boolean {
  return openCount > TOOLS_FROM;
}

/** «أحسن 3» only when it chooses something: a door with three shops or fewer shows them all, plainly. */
export function showBest(openCount: number): boolean {
  return openCount > 3;
}

/** One line per shop for the side-by-side compare (idea k2). */
export interface CompareRow {
  id: string;
  name: string;
  rating: number | null;
  ratingCount: number;
  minutes: number;
  feeIqd: number | null;
  minOrderIqd: number;
}

export function compareRows(picks: readonly ShopPick[]): CompareRow[] {
  return picks.map(({ shop: r }) => ({
    id: r.id,
    name: r.name,
    rating: r.rating,
    ratingCount: r.ratingCount,
    minutes: doorMinutes(r),
    feeIqd: r.deliveryFeeIqd,
    minOrderIqd: r.minOrderIqd,
  }));
}

/** Which compare cell is the best of its row (drawn in the accent): the highest rating, the shortest time, the smallest fee and minimum. */
export function bestCells(rows: readonly CompareRow[]): {
  rating: string | null;
  minutes: string | null;
  fee: string | null;
  minOrder: string | null;
} {
  const pick = (
    vals: Array<[string, number | null]>,
    better: (a: number, b: number) => boolean,
  ): string | null => {
    const known = vals.filter((v): v is [string, number] => v[1] !== null);
    if (known.length < 2) return null;
    const best = known.reduce((a, b) => (better(b[1], a[1]) ? b : a));
    // A tie is no winner.
    return known.filter((v) => v[1] === best[1]).length > 1 ? null : best[0];
  };
  return {
    rating: pick(
      rows.map((r) => [r.id, r.rating]),
      (a, b) => a > b,
    ),
    minutes: pick(
      rows.map((r) => [r.id, r.minutes]),
      (a, b) => a < b,
    ),
    fee: pick(
      rows.map((r) => [r.id, r.feeIqd]),
      (a, b) => a < b,
    ),
    minOrder: pick(
      rows.map((r) => [r.id, r.minOrderIqd]),
      (a, b) => a < b,
    ),
  };
}
