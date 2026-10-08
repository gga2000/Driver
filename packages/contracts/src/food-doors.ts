import type { LatLng } from './common.js';
import { haversineM, ROAD_FACTOR } from './tracking.js';

/**
 * The four food doors (Ali, 2026-10-07, «أبواب الأكل»): behind the home food tile the town's shops sit
 * behind four doors instead of one long list — meals (مطاعم), قهوة وچاي (cafés), عصير وبارد (juice and
 * cold drinks) and حلو وآيس كريم (sweets and ice cream). A shop's door comes from its tags (no new
 * column): anything that cooks a meal is a meal, else its first sweet/café/cold tag decides, so a shop
 * sits behind exactly one door and never shows up twice. Pure, shared by the app and the server.
 */

export const FOOD_DOORS = ['meal', 'cafe', 'cold', 'sweet'] as const;
export type FoodDoor = (typeof FOOD_DOORS)[number];

/** Tags that mean a café, a juice bar, a sweets or ice cream shop. Every other tag is a meal. */
const DOOR_TAGS: Readonly<Record<Exclude<FoodDoor, 'meal'>, readonly string[]>> = {
  cafe: ['coffee', 'cafe', 'tea'],
  cold: ['juice', 'soft_drinks', 'smoothie', 'cold_drinks'],
  sweet: ['dessert', 'sweets', 'kunafa', 'baklava', 'cake', 'ice_cream'],
};

/** Tags that say nothing about what the shop is (a restaurant with a dessert section is still a restaurant). */
const NEUTRAL_TAGS = new Set(['family', 'new', 'delivery', 'takeaway']);

function doorOfTag(tag: string): Exclude<FoodDoor, 'meal'> | null {
  for (const door of ['cafe', 'cold', 'sweet'] as const)
    if (DOOR_TAGS[door].includes(tag)) return door;
  return null;
}

/** The one door a shop sits behind. A shop with no tags is a meal (every launch kitchen has tags). */
export function doorOf(tags: readonly string[]): FoodDoor {
  const known = tags.filter((t) => !NEUTRAL_TAGS.has(t));
  if (known.some((t) => doorOfTag(t) === null)) return 'meal';
  for (const t of known) {
    const door = doorOfTag(t);
    if (door) return door;
  }
  return 'meal';
}

/** The shop sells ice cream. */
export function sellsIceCream(tags: readonly string[]): boolean {
  return tags.includes('ice_cream');
}

/** Only ice cream (no kunafa, no cake): the shop whose whole order would melt on a long ride. */
export function onlyIceCream(tags: readonly string[]): boolean {
  return sellsIceCream(tags) && !tags.some((t) => t !== 'ice_cream' && DOOR_TAGS.sweet.includes(t));
}

/**
 * How far ice cream travels (Ali, shop rules k7, 2026-10-08: "3 km"): a shop that sells only ice cream
 * delivers to doors at most this far by road from it (straight line × the town's road factor). Beyond
 * that it drops out of the lists for that address and the order is refused (`too_far_for_ice_cream`).
 * Without both pins nothing is refused.
 */
export const ICE_CREAM_MAX_KM = 3;

export function iceCreamTooFar(tags: readonly string[], shop: LatLng | null | undefined, door: LatLng | null | undefined): boolean {
  if (!onlyIceCream(tags) || !shop || !door) return false;
  return (haversineM(shop, door) * ROAD_FACTOR) / 1000 > ICE_CREAM_MAX_KM;
}

/**
 * Melt guard (Ali, idea i1): ice cream only goes where it arrives as ice cream. A shop that sells only
 * ice cream drops out of the sweets door when its door time to this address runs past this many minutes
 * (prep and ride together, the card's upper bound). Unknown door time (no address yet) keeps it.
 */
export const MELT_MAX_MIN = 20;

export function meltsOnTheWay(shop: {
  tags: readonly string[];
  etaMaxMinutes: number | null;
}): boolean {
  return (
    onlyIceCream(shop.tags) && shop.etaMaxMinutes !== null && shop.etaMaxMinutes > MELT_MAX_MIN
  );
}

/**
 * Hot food on a long ride (Ali's g5, "whatever is best", 2026-10-07): a meal kitchen is never hidden or
 * refused for being far (who we deliver to is the zones' rule, G0-8), but when the ride alone (door time
 * minus kitchen time, upper bounds) runs past this many minutes the row says so honestly: it arrives warm,
 * not straight off the grill. A display line only; no fee, no limit. Unknown times say nothing.
 */
export const HOT_RIDE_LONG_MIN = 25;

export function longRideForHotFood(shop: {
  tags: readonly string[];
  etaMaxMinutes: number | null;
  prepMaxMinutes: number;
}): boolean {
  return (
    doorOf(shop.tags) === 'meal' &&
    shop.etaMaxMinutes !== null &&
    shop.etaMaxMinutes - shop.prepMaxMinutes > HOT_RIDE_LONG_MIN
  );
}

/** Iraqi summer (June to September): cold drinks lead the afternoon and ice cream the night. */
export function isSummer(now: Date): boolean {
  const m = now.getMonth();
  return m >= 5 && m <= 8;
}

/** The hour as the doors read it: what people in Aziziyah want at this time of day and year. */
export type DoorMoment = 'morning' | 'noon' | 'summer_noon' | 'afternoon' | 'evening' | 'summer_night' | 'late';

export function doorMoment(now: Date): DoorMoment {
  const h = now.getHours();
  const summer = isSummer(now);
  if (summer && h >= 11 && h < 18) return 'summer_noon';
  if (summer && (h >= 21 || h < 2)) return 'summer_night';
  if (h >= 5 && h < 11) return 'morning';
  if (h >= 11 && h < 15) return 'noon';
  if (h >= 15 && h < 19) return 'afternoon';
  // After midnight it is no longer dinner: the small hours, whatever is still open.
  if (h < 5) return 'late';
  return 'evening';
}

const ORDER: Readonly<Record<DoorMoment, readonly FoodDoor[]>> = {
  // Breakfast, then the morning tea.
  morning: ['meal', 'cafe', 'cold', 'sweet'],
  // Lunch, and something cold with it.
  noon: ['meal', 'cold', 'cafe', 'sweet'],
  // A summer afternoon in Wasit (idea j1): cold first.
  summer_noon: ['cold', 'meal', 'sweet', 'cafe'],
  // Afternoon tea and something sweet with it.
  afternoon: ['cafe', 'sweet', 'meal', 'cold'],
  // Dinner, then sweets.
  evening: ['meal', 'sweet', 'cafe', 'cold'],
  // A summer night out (idea i5): ice cream first.
  summer_night: ['sweet', 'meal', 'cold', 'cafe'],
  // The small hours: a late bite first.
  late: ['meal', 'sweet', 'cafe', 'cold'],
};

/** The four doors in the order this hour wants them (idea d4). Always all four: a door never disappears. */
export function doorOrder(now: Date): readonly FoodDoor[] {
  return ORDER[doorMoment(now)];
}
