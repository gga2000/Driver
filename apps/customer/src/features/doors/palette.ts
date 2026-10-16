import type { FoodDoor } from '@driver/contracts';
import type { HomeDecor, ServicePalette, ThemeColors } from '@driver/design-tokens';

/** One door's colours: the tile, the ink on it (name and live fact), and the pale wash of its page. */
export interface DoorSwatch {
  fill: string;
  on: string;
  sub: string;
  tint: string;
  glow: string;
  /** The lighter doorway inside the tile's arch, where the drawing stands (decoration, no text on it). */
  inner: string;
}

/**
 * The four doors' colours, all from the theme the home redesign owns (no colours of their own): meals in
 * the food tile's saffron, قهوة وچاي in the trips' date brown with its gold, عصير وبارد in الرجعة's gold,
 * حلو وآيس كريم in the home sky's sunset rose over the rose dish plate. Contrast is tested on every theme (`palette.test.ts`).
 */
export function doorSwatch(
  theme: { services: ServicePalette; decor: HomeDecor; colors: ThemeColors },
  door: FoodDoor,
): DoorSwatch {
  const { food, trips, back } = theme.services;
  const stages = theme.decor.stages;
  const plate = (i: number) => stages[i % stages.length] ?? theme.colors.surfaceSunken;
  switch (door) {
    case 'meal':
      return { fill: food.fill, on: food.on, sub: food.on, tint: plate(0), glow: food.glow, inner: food.mesh[0] };
    case 'cafe':
      return { fill: trips.fill, on: trips.on, sub: trips.sub ?? trips.on, tint: plate(3), glow: trips.glow, inner: trips.light };
    case 'cold':
      return { fill: back.fill, on: back.on, sub: back.sub ?? back.on, tint: plate(5), glow: back.glow, inner: back.light };
    case 'sweet':
      return { fill: theme.decor.wash.sunset, on: theme.colors.text, sub: theme.colors.text, tint: plate(1), glow: theme.decor.wash.sunset, inner: plate(1) };
  }
}
