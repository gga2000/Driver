import type { Motif } from '@/features/food/food-art';

/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
const GRILL = require('../../../assets/food-landing/k-mixed-grill-3.webp') as number;
const KEBAB = require('../../../assets/food-landing/k-kebab-2.webp') as number;
const RICE = require('../../../assets/food-landing/k-timman-marag-1.webp') as number;
const TEA = require('../../../assets/food-landing/k-tea-2.webp') as number;
const JUICE = require('../../../assets/food-landing/k-orange-juice-2.webp') as number;
const SWEET = require('../../../assets/food-landing/k-kunafa-2.webp') as number;
const BAKLAVA = require('../../../assets/food-landing/k-baklava-1.webp') as number;
const ZALABIA = require('../../../assets/food-landing/k-zalabia-1.webp') as number;
const KLEICHA = require('../../../assets/food-landing/k-kleicha-1.webp') as number;
const TIKKA = require('../../../assets/food-landing/k-tikka-1.webp') as number;
const DOLMA = require('../../../assets/food-landing/k-dolma-1.webp') as number;
const COLD = require('../../../assets/food-landing/door-cold.webp') as number;
const SWEETS = require('../../../assets/food-landing/door-sweet.webp') as number;
const CAFE = require('../../../assets/food-landing/door-cafe.webp') as number;

/**
 * Real photos for the landing's big pictures (Ali's approved dish library, 2026-10-08), by the motif
 * a kitchen or dish already has. A kitchen's own upload always wins; these stand in until it has one.
 */
const BY_MOTIF: Partial<Record<Motif, number>> = {
  tray: GRILL,
  plate: GRILL,
  kebab: KEBAB,
  liver: KEBAB,
  tikka: TIKKA,
  shawarma: require('../../../assets/food-landing/k-shawarma-2.webp') as number,
  wrap: KEBAB,
  fish: require('../../../assets/food-landing/k-masgouf-1.webp') as number,
  chicken: require('../../../assets/food-landing/k-chicken-1.webp') as number,
  rice: RICE,
  okra: RICE,
  beans: RICE,
  biryani: RICE,
  soup: require('../../../assets/food-landing/k-lentil-soup-1.webp') as number,
  falafel: require('../../../assets/food-landing/k-falafel-2.webp') as number,
  pacha: require('../../../assets/food-landing/k-pacha-1.webp') as number,
  breakfast: require('../../../assets/food-landing/k-geymar-1.webp') as number,
  dolma: DOLMA,
  tea: TEA,
  coffee: TEA,
  dallah: TEA,
  juice: JUICE,
  pomegranate: JUICE,
  lemonade: JUICE,
  iced: JUICE,
  cocktail: JUICE,
  sweet: SWEET,
  baklava: BAKLAVA,
  kleicha: KLEICHA,
  zalabia: ZALABIA,
  cake: BAKLAVA,
  icecream: SWEETS,
};

/** The four pictures on the «شوف كل المحلات» strip. */
export const ALL_STRIP: readonly number[] = [
  require('../../../assets/food-landing/k-quzi-1.webp') as number,
  require('../../../assets/food-landing/k-falafel-2.webp') as number,
  RICE,
  SWEET,
];

/** A near photo when the first is already on screen, so two cards in a row never share a picture. */
const NEXT = new Map<number, number>([
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

export function photoForMotif(motif: Motif): number {
  return BY_MOTIF[motif] ?? GRILL;
}

/** One photo per motif in order, stepping to a near one when the picture is already used. */
export function distinctPhotos(motifs: readonly Motif[]): number[] {
  const used = new Set<number>();
  return motifs.map((m) => {
    let photo = photoForMotif(m);
    for (let i = 0; used.has(photo) && i < 4; i++) photo = NEXT.get(photo) ?? photo;
    used.add(photo);
    return photo;
  });
}
