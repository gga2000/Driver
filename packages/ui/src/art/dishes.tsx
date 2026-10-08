import { memo } from 'react';
import { G, Image, Path } from 'react-native-svg';
import { archPath, SKETCH as K } from './kit';
import { DISH_PHOTOS, type DishPhotoName } from './photos/dishes';

/**
 * The dish set (joy J4, food-funnel S-3, design-system S2-07): one picture per kind of dish, each with its
 * own silhouette so a menu reads at a glance at 64 px. Pictures, never photos: they must not pretend to be
 * a restaurant's real food (J-D3), and a merchant photo always replaces them.
 *
 * Since 2026-10-07 (late) these are the AI-painted pictures Ali chose (`photos/dishes.ts`), in place of the
 * drawn Date & Saffron set, which stays in git history and `/mnt/project-files/illustrations/dishes/`.
 */
export const DISH_KINDS = [
  'kebab',
  'tikka',
  'liver',
  'chicken',
  'shawarma',
  'falafel',
  'wrap',
  'plate',
  'tray',
  'rice',
  'okra',
  'beans',
  'soup',
  'pacha',
  'dolma',
  'fish',
  'kubba',
  'bread',
  'salad',
  'pickles',
  'hummus',
  'sweet',
  'tea',
  'laban',
  'water',
  'can',
  'juice',
  'coffee',
  'icecream',
  // Food doors, idea o4 (2026-10-07): the sweets, coffee and cold drinks people pick by picture.
  'baklava',
  'zalabia',
  'kleicha',
  'cake',
  'dallah',
  'iced',
  'pomegranate',
  'lemonade',
  'bananamilk',
  'cocktail',
  // In Ali's locked set (2026-10-07).
  'biryani',
  'breakfast',
  'manakish',
] as const;
export type DishKind = (typeof DISH_KINDS)[number];

/** The picture each kind shows, where its file name differs from the kind. */
const PICTURE: Partial<Record<DishKind, DishPhotoName>> = {
  tray: 'grill-tray',
  bread: 'samoon',
  sweet: 'sweets',
  can: 'soda',
};

/** How many looks each dish has: the same picture turned a little on the table. */
export const DISH_LOOKS = 3;
const LOOK_TURN = [0, -7, 6];

export interface DishDrawingProps {
  kind: DishKind;
  /** 0 … DISH_LOOKS − 1: how the dish sits on the table (two kitchens with one dish don't look the same). */
  look?: number;
  /** @deprecated The pictures have no ink line; ignored (kept while other branches still pass it). */
  line?: number;
  /** Draw the faint arch window behind the dish (thumbnails); heroes have their own backdrop. */
  window?: boolean;
  /** Degrees the dish turns on the table, on top of its look; the window stays upright. */
  tilt?: number;
}

/**
 * One dish in a 200 × 200 box, as an SVG group: place it inside an `<Svg>` (the caller sets the size and
 * the backdrop). Pure and memoised: nothing animates per frame.
 */
export const DishDrawing = memo(function DishDrawing({ kind, look = 0, window = true, tilt = 0 }: DishDrawingProps) {
  const i = ((look % DISH_LOOKS) + DISH_LOOKS) % DISH_LOOKS;
  const turn = (LOOK_TURN[i] ?? 0) + tilt;
  const dish = <Image href={DISH_PHOTOS[PICTURE[kind] ?? (kind as DishPhotoName)]} x={0} y={0} width={200} height={200} preserveAspectRatio="xMidYMid meet" />;
  return (
    <G>
      {window ? <Path d={archPath(34, 14, 132, 176)} fill={K.wallDeep} opacity={0.32} /> : null}
      {turn ? <G transform={`rotate(${turn} 100 120)`}>{dish}</G> : dish}
    </G>
  );
});
