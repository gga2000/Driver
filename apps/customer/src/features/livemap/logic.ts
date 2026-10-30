import type { LatLng, RestaurantCard } from '@driver/contracts';
import type { CustomerTownNow } from '@driver/contracts/town-pulse';

/**
 * «العزيزية هسة», the customer's live map (Ali, 2026-10-28: A + the 25-minute chip + the shop tour once).
 * Pure pieces the screen and both maps read: which shops stand on the map and how, the chips, the
 * fastest-to-you rail, the top line and the tour.
 */

/** The three kinds the chips pick, each with its own colour: food saffron, tea and coffee date brown, bakeries wheat. */
export type LiveKind = 'food' | 'coffee' | 'bakery';
export type KindChip = 'all' | LiveKind;
export const KIND_CHIPS: readonly KindChip[] = ['all', 'food', 'coffee', 'bakery'];

/** B as a chip: only kitchens that reach the door within this many minutes. */
export const MINUTES_CHIP = 25;
/** At most this many shops show their name and minutes; the rest are quiet dots. */
export const MAX_BUBBLES = 8;
/** The fastest-to-you rail under the map. */
export const RAIL_SIZE = 8;
/** C, once: this many shop fronts, then it stops. */
export const TOUR_SIZE = 5;
/** Where the map opens when the customer has no place with a pin yet (the centre of Aziziyah). */
export const TOWN_CENTRE: LatLng = { lat: 32.9095, lng: 45.0625 };

export interface LivePin {
  id: string;
  /** [lng, lat] */
  at: [number, number];
  card: RestaurantCard;
  kind: LiveKind;
  /** Cooking now (from the town picture), shown as a saffron disc with «يطبخ هسة». */
  cooking: boolean;
  /** Minutes to the customer's door (the soonest of the range); null when the server could not tell. */
  minutes: number | null;
}

/**
 * The kind of a shop from its cuisine and tags. The same words the map's 3D fronts use
 * (`restaurantKindOf` in @driver/map/golden), kept here so the chips never load the map code.
 */
export function kindOf(card: Pick<RestaurantCard, 'cuisine' | 'tags'>): LiveKind {
  const t = [card.cuisine, ...card.tags].join(' ').toLowerCase();
  const words = new Set(t.split(/[^\p{L}\p{N}]+/u));
  const has = (...w: string[]) => w.some((x) => (/^[a-z ]+$/.test(x) ? words.has(x) : t.includes(x)));
  if (has('فرن', 'صمون', 'خبز', 'معجنات', 'bakery', 'bread')) return 'bakery';
  if (has('قهوة', 'شاي', 'كافيه', 'مقهى', 'چايخانة', 'coffee', 'tea', 'cafe')) return 'coffee';
  return 'food';
}

/** Every shop with a pin, cooking ones marked from the town picture. */
export function livePins(cards: readonly RestaurantCard[], town: Pick<CustomerTownNow, 'cooking'> | null | undefined): LivePin[] {
  const cooking = new Set((town?.cooking ?? []).map((k) => k.id));
  return cards
    .filter((c) => c.pickup?.pin)
    .map((c) => ({
      id: c.id,
      at: [c.pickup!.pin!.lng, c.pickup!.pin!.lat] as [number, number],
      card: c,
      kind: kindOf(c),
      cooking: c.open && cooking.has(c.id),
      minutes: c.open ? c.etaMinMinutes : null,
    }));
}

/** The chips: one kind (or all), and «خلال 25 د» keeps only open shops that make it in time. */
export function filterPins(pins: readonly LivePin[], kind: KindChip, fast: boolean): LivePin[] {
  return pins.filter((p) => (kind === 'all' || p.kind === kind) && (!fast || (p.card.open && p.minutes !== null && p.minutes <= MINUTES_CHIP)));
}

const soonest = (a: LivePin, b: LivePin) => (a.minutes ?? 999) - (b.minutes ?? 999) || a.id.localeCompare(b.id);

/** Which shops show their name and minutes: cooking first, then open ones soonest at the door. Closed ones never. */
export function bubbleIds(pins: readonly LivePin[], max = MAX_BUBBLES): Set<string> {
  const open = pins.filter((p) => p.card.open);
  const order = [...open.filter((p) => p.cooking).sort(soonest), ...open.filter((p) => !p.cooking).sort(soonest)];
  return new Set(order.slice(0, max).map((p) => p.id));
}

/** «أسرع شي يوصلك هسة»: open shops, soonest first (cooking ones win a tie). */
export function fastest(pins: readonly LivePin[], n = RAIL_SIZE): LivePin[] {
  return pins
    .filter((p) => p.card.open && p.minutes !== null)
    .sort((a, b) => soonest(a, b) || Number(b.cooking) - Number(a.cooking))
    .slice(0, n);
}

/** The top line: how many kitchens are cooking near them and how many drivers are around (0 hides that part). */
export function headline(pins: readonly LivePin[], town: Pick<CustomerTownNow, 'drivers'> | null | undefined): { cooking: number; drivers: number } {
  return { cooking: pins.filter((p) => p.cooking).length, drivers: (town?.drivers ?? []).reduce((n, c) => n + c.n, 0) };
}

/** C's tour, once: cooking shops with a real photo first, then any open shop, soonest first. */
export function tourPlan(pins: readonly LivePin[], n = TOUR_SIZE): LivePin[] {
  const open = pins.filter((p) => p.card.open);
  const score = (p: LivePin) => (p.cooking ? 2 : 0) + (p.card.photoUrl ? 1 : 0);
  return [...open].sort((a, b) => score(b) - score(a) || soonest(a, b)).slice(0, n);
}

/** Where the map is centred and the town picture is cut around: their place's pin, or the town centre. */
export function homeOf(pin: LatLng | null | undefined): { at: LatLng; isHome: boolean } {
  return pin ? { at: pin, isHome: true } : { at: TOWN_CENTRE, isHome: false };
}

/** Stored once the tour has played (or been skipped): it never plays by itself again. */
export const TOUR_SEEN_KEY = 'driver.customer.live_tour_seen';

/** The four steps on the order card: ordered, being made, on the way, at the door. */
export type OrderStep = 0 | 1 | 2 | 3;

/** Which step the order is on, from the tracking screen's phase. */
export function orderStep(phase: string): OrderStep {
  if (phase === 'waiting_merchant') return 0;
  if (phase === 'on_the_way') return 2;
  if (phase === 'arrived' || phase === 'done') return 3;
  return 1;
}

/** Only a food order on its way shows on the live map (rides, trips and parcels have their own screens). */
export function showsOnLiveMap(order: { type: string } | null | undefined): boolean {
  return order?.type === 'food';
}

/** Whole minutes until `etaAt` (at least 1), or null with no ETA. */
export function minutesLeft(etaAt: Date | null | undefined, now: number): number | null {
  if (!etaAt) return null;
  return Math.max(1, Math.ceil((etaAt.getTime() - now) / 60_000));
}

type LngLatPt = [number, number];

/** Their own order on the map: the kitchen, their courier, the street route still ahead and their door. */
export interface LiveOrder {
  id: string;
  kitchen: { at: LngLatPt; name: string } | null;
  courier: LngLatPt | null;
  route: LngLatPt[] | null;
  door: LngLatPt | null;
  /** Still cooking (before pickup): the kitchen bubble says «يجهّز طلبك». */
  cooking: boolean;
}

/** What the camera keeps in view: the order's three points, or their place and the shops that show their names. */
export function framePoints(home: LngLatPt, pins: readonly LivePin[], bubbles: ReadonlySet<string>, order: LiveOrder | null): LngLatPt[] {
  if (order) {
    const pts = [order.kitchen?.at, order.courier, order.door ?? home].filter((p): p is LngLatPt => Boolean(p));
    return pts;
  }
  // The nearest few named shops, so the town opens close enough to see the 3D fronts and read the bubbles.
  const named = pins
    .filter((p) => bubbles.has(p.id) && metresBetween(home, p.at) <= FRAME_RADIUS_M)
    .sort((a, b) => metresBetween(home, a.at) - metresBetween(home, b.at))
    .slice(0, FRAME_SHOPS)
    .map((p) => p.at);
  return [home, ...named];
}

/** The town view keeps at most this many named shops in frame, and none further than this from their place. */
export const FRAME_SHOPS = 4;
export const FRAME_RADIUS_M = 2500;

function metresBetween(a: LngLatPt, b: LngLatPt): number {
  const k = 111_320;
  return Math.hypot((b[0] - a[0]) * k * Math.cos((a[1] * Math.PI) / 180), (b[1] - a[1]) * k);
}
