import { motifForDish, type Motif } from '@/features/food/food-art';
import { distinctPhotos, photoForMotif, type FoodPhotoSource } from '@/features/food-landing/photos';

/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
/**
 * Home's own real photos (Ali's approved dish library, 2026-10-08) for the rice-and-stew dishes the
 * hour's gallery leads with, which the food landing's set draws as one plate: بامية, قيمة, برياني and
 * كبد each get their own, so a lunch gallery isn't the same pot four times.
 */
const BY_NAME: ReadonlyArray<readonly [RegExp, number]> = [
  [/بامي/, require('../../../assets/home/dishes/bamia.webp') as number],
  [/قيمة/, require('../../../assets/home/dishes/qeema.webp') as number],
  [/برياني/, require('../../../assets/home/dishes/biryani.webp') as number],
  [/كبد|معلاگ|معلاك/, require('../../../assets/home/dishes/liver.webp') as number],
];
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * The food landing's photos that show that very dish (a mixed grill for «مشكّل», kunafa for كنافة…),
 * by the dish's kind. Kinds left out (منقوشة, a wrap, coffee, a can…) have no photo of their own yet.
 */
const SAME_DISH: Partial<Record<Motif, Motif>> = {
  tray: 'tray',
  plate: 'plate',
  kebab: 'kebab',
  tikka: 'tikka',
  shawarma: 'shawarma',
  fish: 'fish',
  chicken: 'chicken',
  rice: 'rice',
  beans: 'beans',
  soup: 'soup',
  falafel: 'falafel',
  pacha: 'pacha',
  dolma: 'dolma',
  tea: 'tea',
  juice: 'juice',
  kunafa: 'kunafa',
  kubba: 'kubba',
  laban: 'laban',
  cocktail: 'cocktail',
  baklava: 'baklava',
  kleicha: 'kleicha',
  zalabia: 'zalabia',
};

/** The landing photo's kind a dish would show as its stand-in; null when home has its own photo for it, or none fits. */
export function dishKind(name: string): Motif | null {
  if (BY_NAME.some(([re]) => re.test(name))) return null;
  return SAME_DISH[motifForDish(name)] ?? null;
}

/**
 * One stand-in photo per dish, for dishes whose kitchen hasn't uploaded one: the dish's own photo when
 * home has it, else the food landing's photo of that dish. A photo of another dish never stands in, so
 * what you see is what comes; a dish with none gets null and home leaves it to its menu.
 */
export function dishPhoto(name: string): FoodPhotoSource | null {
  const own = BY_NAME.find(([re]) => re.test(name))?.[1];
  if (own !== undefined) return own;
  const kind = dishKind(name);
  return kind ? photoForMotif(kind) : null;
}

/**
 * Kinds whose landing photo fairly shows a kitchen of that kind (a grill house, a sweets shop, a café):
 * the dishes above plus the kinds a kitchen stands for. A bakery or a pickle shop has none yet.
 */
const KITCHEN_KIND: Partial<Record<Motif, Motif>> = {
  ...SAME_DISH,
  liver: 'liver',
  wrap: 'wrap',
  okra: 'okra',
  biryani: 'biryani',
  breakfast: 'breakfast',
  coffee: 'coffee',
  dallah: 'dallah',
  sweet: 'sweet',
  icecream: 'icecream',
  cake: 'cake',
  bananamilk: 'bananamilk',
  pomegranate: 'pomegranate',
  lemonade: 'lemonade',
  iced: 'iced',
};

/**
 * A photo per kitchen in a list, by its kind, for kitchens that haven't uploaded their own. It never
 * repeats a photo already showing higher on the page (`showing`: the dishes' stand-in kinds) or the
 * row above. Null for a kind with no fair photo: that kitchen shows its warm drawing.
 */
export function kitchenPhotos(motifs: readonly Motif[], showing: readonly Motif[] = []): (FoodPhotoSource | null)[] {
  const kinds = motifs.map((m) => KITCHEN_KIND[m] ?? null);
  const photos = distinctPhotos([...showing, ...kinds.filter((k): k is Motif => k !== null)]).slice(showing.length);
  let next = 0;
  return kinds.map((k) => (k ? (photos[next++] ?? null) : null));
}
