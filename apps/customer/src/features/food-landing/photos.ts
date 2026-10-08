import type { FoodDoor } from '@driver/contracts';
import type { Motif } from '@/features/food/food-art';

/**
 * A food photo: a bundled one (what require() gives, only the street and the four door pictures, so
 * the first screen draws with no network) or a path on the API (`/media/food/<name>.webp`, every dish
 * picture: about 1.2 MB the download no longer carries; phones keep each one once seen). `FoodPhoto`
 * draws either.
 */
export type FoodPhotoSource = number | string;

const media = (name: string): string => `/media/food/${name}`;

/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
const GRILL = media('k-mixed-grill-3.webp');
const KEBAB = media('k-kebab-2.webp');
const RICE = media('k-timman-marag-1.webp');
const TEA = media('k-tea-2.webp');
const JUICE = media('k-orange-juice-2.webp');
const SWEET = media('k-kunafa-2.webp');
const BAKLAVA = media('k-baklava-1.webp');
const ZALABIA = media('k-zalabia-1.webp');
const KLEICHA = media('k-kleicha-1.webp');
const KUBBA = media('k-kubba-1.webp');
const COCKTAIL = media('k-cocktail-1.webp');
const LABAN = media('k-laban-1.webp');
const TIKKA = media('k-tikka-1.webp');
const DOLMA = media('k-dolma-1.webp');
const COLD = require('../../../assets/food-landing/door-cold.webp') as number;
const SWEETS = require('../../../assets/food-landing/door-sweet.webp') as number;
const CAFE = require('../../../assets/food-landing/door-cafe.webp') as number;

/**
 * Real photos for the landing's big pictures (Ali's approved dish library, 2026-10-08), by the motif
 * a kitchen or dish already has. A kitchen's own upload always wins; these stand in until it has one.
 */
const BY_MOTIF: Partial<Record<Motif, FoodPhotoSource>> = {
  tray: GRILL,
  plate: GRILL,
  kebab: KEBAB,
  liver: KEBAB,
  tikka: TIKKA,
  shawarma: media('k-shawarma-2.webp'),
  wrap: KEBAB,
  fish: media('k-masgouf-1.webp'),
  chicken: media('k-chicken-1.webp'),
  rice: RICE,
  okra: RICE,
  beans: RICE,
  biryani: RICE,
  soup: media('k-lentil-soup-1.webp'),
  falafel: media('k-falafel-2.webp'),
  pacha: media('k-pacha-1.webp'),
  breakfast: media('k-geymar-1.webp'),
  dolma: DOLMA,
  tea: TEA,
  coffee: CAFE,
  dallah: CAFE,
  juice: JUICE,
  pomegranate: JUICE,
  lemonade: JUICE,
  iced: JUICE,
  cocktail: COCKTAIL,
  bananamilk: LABAN,
  laban: LABAN,
  sweet: SWEET,
  kunafa: SWEET,
  kubba: KUBBA,
  baklava: BAKLAVA,
  kleicha: KLEICHA,
  zalabia: ZALABIA,
  cake: BAKLAVA,
  icecream: SWEETS,
};

/** Each food door's own photo: its tile on /food and the top of its page. */
export const DOOR_PHOTOS: Readonly<Record<FoodDoor, number>> = {
  meal: require('../../../assets/food-landing/door-meal.webp') as number,
  cold: COLD,
  sweet: SWEETS,
  cafe: CAFE,
};

/** The four pictures on the «شوف كل المحلات» strip. */
export const ALL_STRIP: readonly FoodPhotoSource[] = [
  media('k-quzi-1.webp'),
  media('k-falafel-2.webp'),
  RICE,
  SWEET,
];

/** A near photo when the first is already on screen, so two cards in a row never share a picture. */
const NEXT = new Map<FoodPhotoSource, FoodPhotoSource>([
  [GRILL, KEBAB],
  [KEBAB, TIKKA],
  [TIKKA, GRILL],
  [RICE, DOLMA],
  [DOLMA, RICE],
  [SWEET, BAKLAVA],
  [BAKLAVA, ZALABIA],
  [ZALABIA, KLEICHA],
  [KLEICHA, SWEET],
  [SWEETS, SWEET],
  [TEA, CAFE],
  [CAFE, TEA],
  [JUICE, COLD],
  [COLD, JUICE],
]);
/* eslint-enable @typescript-eslint/no-require-imports */

export function photoForMotif(motif: Motif): FoodPhotoSource {
  return BY_MOTIF[motif] ?? GRILL;
}

/** One photo per motif in order, stepping to a near one when the picture is already used. */
export function distinctPhotos(motifs: readonly Motif[]): FoodPhotoSource[] {
  const used = new Set<FoodPhotoSource>();
  return motifs.map((m) => {
    let photo = photoForMotif(m);
    for (let i = 0; used.has(photo) && i < 4; i++) photo = NEXT.get(photo) ?? photo;
    used.add(photo);
    return photo;
  });
}
