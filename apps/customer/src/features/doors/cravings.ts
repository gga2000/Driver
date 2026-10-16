import { doorMoment, doorOf, type CatalogCraving, type CatalogSearchDish, type DoorMoment, type FoodDoor, type PublicSeason } from '@driver/contracts';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import type { Motif } from '@/features/food/food-art';
import { bestThree, type ShopPick } from './doors';

/**
 * «شنو بخاطرك؟» (Ali's Yes on d5, k9, s6, j2; 2026-10-07): inside a door you pick the thing first, by
 * its picture (كنافة، لاتيه، رمان، كباب), then see the three best shops for it. The kinds are fixed per
 * door, each with the words its dishes start with (`catalog.cravings` asks the server which open shops
 * have each one right now) and its drawing. Pure, so the order and the filtering are tested.
 */
export interface CravingKind {
  key: string;
  words: readonly string[];
  art: Motif;
}

const K = (key: string, art: Motif, ...words: string[]): CravingKind => ({ key, art, words });

const MEAL_DAY: readonly CravingKind[] = [
  K('kebab', 'kebab', 'كباب'),
  K('tikka', 'tikka', 'تكة', 'تكه'),
  K('chicken', 'chicken', 'دجاج', 'مسحب', 'فروج'),
  K('shawarma', 'shawarma', 'شاورما', 'شاورمة'),
  K('rice', 'rice', 'تمن', 'برياني', 'قوزي'),
  K('dolma', 'dolma', 'دولمة', 'دولمه'),
  K('fish', 'fish', 'مسكوف', 'مسگوف', 'سمك', 'سمچ'),
  K('kubba', 'kubba', 'كبة', 'كبه'),
  K('falafel', 'falafel', 'فلافل'),
];

/** Breakfast: the morning things first, then what is cooking already. */
const MEAL_MORNING: readonly CravingKind[] = [
  K('pacha', 'pacha', 'باچة', 'باجة'),
  K('qaimar', 'breakfast', 'كاهي', 'قيمر', 'كيمر'),
  K('tashreeb', 'soup', 'تشريب', 'عدس', 'شوربة'),
  K('falafel', 'falafel', 'فلافل'),
  K('eggs', 'plate', 'بيض', 'مخلمة'),
  ...MEAL_DAY.filter((k) => k.key !== 'falafel').slice(0, 4),
];

const CAFE: readonly CravingKind[] = [
  K('tea', 'tea', 'چاي', 'شاي', 'استكان'),
  K('arabic_coffee', 'dallah', 'قهوة عربية', 'قهوة مرة'),
  K('cappuccino', 'coffee', 'كابتشينو', 'كابوتشينو', 'اسبريسو', 'موكا'),
  K('iced_latte', 'iced', 'مثلج', 'آيس لاتيه', 'فرابيه'),
  K('nescafe', 'coffee', 'نسكافيه', 'نسكفي'),
  K('cake', 'cake', 'كيك', 'كعكة'),
  K('kleicha', 'kleicha', 'كليچة', 'كليجة'),
];

const COLD: readonly CravingKind[] = [
  K('orange', 'juice', 'عصير برتقال', 'برتقال'),
  K('pomegranate', 'pomegranate', 'عصير رمان', 'رمان'),
  K('lemon_mint', 'lemonade', 'ليمون', 'موهيتو', 'ليموناضة'),
  K('banana_milk', 'bananamilk', 'موز'),
  K('cocktail', 'cocktail', 'كوكتيل'),
  K('carrot', 'juice', 'عصير جزر', 'جزر'),
];

const SWEET: readonly CravingKind[] = [
  K('kunafa', 'kunafa', 'كنافة', 'كنافه'),
  K('baklava', 'baklava', 'بقلاوة', 'بقلاوه'),
  K('zalabia', 'zalabia', 'زلابية', 'زلابيا'),
  K('kleicha', 'kleicha', 'كليچة', 'كليجة'),
  K('cake', 'cake', 'كيك', 'كعكة', 'تورتة'),
  K('ice_cream', 'icecream', 'آيس كريم', 'ايس كريم', 'كون', 'كوب آيس', 'دوندرمة', 'بوظة', 'ميلك شيك'),
];

/**
 * The kinds a door offers now, in the order this hour and season want them: breakfast things in the
 * morning; ice cream first on a summer night (i5); كليچة and زلابية first in Ramadan and at Eid (s5).
 */
export function doorCravings(door: FoodDoor, now: Date, season?: Pick<PublicSeason, 'kind'> | null): readonly CravingKind[] {
  const moment = doorMoment(now);
  switch (door) {
    case 'meal':
      return moment === 'morning' ? MEAL_MORNING : MEAL_DAY;
    case 'cafe':
      // Iced first on a summer afternoon (j1).
      return moment === 'summer_noon' ? [...CAFE.filter((k) => k.key === 'iced_latte'), ...CAFE.filter((k) => k.key !== 'iced_latte')] : CAFE;
    case 'cold':
      return COLD;
    case 'sweet': {
      const lead = season?.kind === 'ramadan' || season?.kind === 'eid' ? ['kleicha', 'zalabia'] : moment === 'summer_night' ? ['ice_cream'] : [];
      return [...lead.map((key) => SWEET.find((k) => k.key === key)!), ...SWEET.filter((k) => !lead.includes(k.key))];
    }
  }
}

/** One picture in the row: its kind and the open shops behind this door that have it (one dish each). */
export interface DoorCraving {
  kind: CravingKind;
  dishes: CatalogSearchDish[];
}

/** At most this many pictures in the row (k9: nine for meals, fewer elsewhere because there are fewer). */
export const CRAVINGS_MAX = 9;

/**
 * The row: the server's answer kept to shops behind this door (a café's «كيك» is not in the sweets door,
 * it shows in the café door) and to kinds someone has now, in `kinds` order. A dish already shown for
 * an earlier kind at the same shop is not shown again under a broader word («عصير» after «برتقال»).
 */
export function cravingRow(kinds: readonly CravingKind[], answer: readonly CatalogCraving[], shops: readonly Pick<RestaurantSummary, 'id' | 'tags'>[], door: FoodDoor): DoorCraving[] {
  const behind = new Set(shops.filter((s) => doorOf(s.tags) === door).map((s) => s.id));
  const shown = new Set<string>();
  const out: DoorCraving[] = [];
  for (const kind of kinds) {
    const found = answer.find((a) => a.key === kind.key);
    const dishes = (found?.dishes ?? []).filter((d) => behind.has(d.restaurantId) && !shown.has(d.id));
    if (dishes.length === 0) continue;
    for (const d of dishes) shown.add(d.id);
    out.push({ kind, dishes });
    if (out.length === CRAVINGS_MAX) break;
  }
  return out;
}

/** A pick for a craving: the shop with its reason, and the dish it would bring. */
export interface CravingPick extends ShopPick {
  dish: CatalogSearchDish;
}

/** «أحسن 3 للكنافة هسة»: the best three of the shops that have it (the door's own reasons), each with its dish. */
export function cravingPicks(craving: DoorCraving, open: readonly RestaurantSummary[]): CravingPick[] {
  const byShop = new Map(craving.dishes.map((d) => [d.restaurantId, d]));
  return bestThree(open.filter((r) => byShop.has(r.id))).map((p) => ({ ...p, dish: byShop.get(p.shop.id)! }));
}

/**
 * «قهوتك المعتادة» (idea q1): the person's last delivered order from a shop behind this door, so the
 * same drink from the same café is one tap away. Only their own orders (not ones they only ate from).
 */
export function usualOrder<R extends { order: { ordererId: string; merchantOrgId: string | null; state: string; placedAt: Date } }>(
  history: readonly R[],
  shops: readonly Pick<RestaurantSummary, 'id' | 'tags'>[],
  door: FoodDoor,
  me: string | null,
): R | null {
  if (!me) return null;
  const behind = new Set(shops.filter((s) => doorOf(s.tags) === door).map((s) => s.id));
  const done = history.filter((r) => r.order.ordererId === me && r.order.merchantOrgId !== null && behind.has(r.order.merchantOrgId) && (r.order.state === 'delivered' || r.order.state === 'completed'));
  return [...done].sort((a, b) => b.order.placedAt.getTime() - a.order.placedAt.getTime())[0] ?? null;
}

/**
 * «this hour» (idea d7): the words of the one quiet suggestion under the doors — a real dish from a shop
 * open now (`catalog.picks`), never more than one: afternoon tea and cake, ice cream on a summer night.
 */
const HOUR_WORDS: Readonly<Record<DoorMoment, readonly string[]>> = {
  morning: ['باچة', 'كاهي', 'چاي'],
  noon: ['تمن', 'دولمة', 'كباب'],
  summer_noon: ['ليمون', 'عصير', 'لاتيه'],
  afternoon: ['چاي', 'كيك', 'كليچة'],
  evening: ['كباب', 'تكة', 'شاورما'],
  summer_night: ['كون', 'كوب آيس', 'آيس كريم'],
  late: ['شاورما', 'فلافل', 'كباب'],
};

export function hourWords(now: Date): readonly string[] {
  return HOUR_WORDS[doorMoment(now)];
}
