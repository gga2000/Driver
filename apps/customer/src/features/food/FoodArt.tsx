import { memo } from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { DishDrawing, SKETCH, useLiteMode } from '@driver/ui';
import Svg, { Circle, Ellipse, G } from 'react-native-svg';
import { ART_LOOKS, type Motif } from './food-art';

export { artOf, dishArt, motifForCuisine, motifForDish, motifForKitchen, type DishArt, type Motif } from './food-art';

/**
 * Illustrated placeholder for kitchens and dishes without a photo yet (every launch merchant today):
 * the Aziziyah sketchbook drawing for the kind of dish (`food-art.ts` picks it from the dish, never the
 * kitchen; the drawings live in `@driver/ui`, joy J4), in fixed pigments so the food looks the same by
 * day and by night. Each dish has one of a few looks — a slight tilt, its own plate tint, garnish or
 * not — and a menu never puts the same drawing on two rows in a row. A merchant photo replaces it.
 */

const TILTS = [-6, 0, 6] as const;

/** Ink width: ≈ 2 px at a 96 px thumbnail; thinner in the wide hero, which draws the dish larger. */
const THUMB_LINE = 4;
const HERO_LINE = 2.6;

function tiltOf(look: number): number {
  const i = ((look % ART_LOOKS) + ART_LOOKS) % ART_LOOKS;
  return TILTS[i] ?? 0;
}

export interface FoodArtProps {
  motif: Motif;
  /** The dish's look (`artOf` / `dishArt`); 0 for a kitchen scene. */
  look?: number;
  /** Photo when the merchant has one. */
  photoUrl?: string | null;
  /** Wide hero scene (with a scatter of sesame dots) or a square dish thumbnail. */
  variant?: 'hero' | 'thumb';
  style?: StyleProp<ViewStyle>;
}

export const FoodArt = memo(function FoodArt({ motif, look = 0, photoUrl, variant = 'thumb', style }: FoodArtProps) {
  // Low-data mode (maps program q2): the drawn dish instead of downloading the photo.
  const lite = useLiteMode();
  if (photoUrl && !lite) return <Image source={{ uri: photoUrl }} style={[{ width: '100%', height: '100%' }, style as object]} resizeMode="cover" accessibilityIgnoresInvertColors />;
  const hero = variant === 'hero';
  return (
    <View style={[{ width: '100%', height: '100%', backgroundColor: SKETCH.paper, overflow: 'hidden' }, style]} accessible={false} aria-hidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox={hero ? '0 0 400 220' : '0 0 200 200'} preserveAspectRatio="xMidYMid slice">
        {hero ? (
          <G>
            <Circle cx={330} cy={30} r={120} fill={SKETCH.juice} opacity={0.12} />
            <Circle cx={40} cy={210} r={90} fill={SKETCH.juice} opacity={0.08} />
            {Array.from({ length: 18 }, (_, i) => (
              <Ellipse key={i} cx={(i * 73) % 400} cy={20 + ((i * 47) % 190)} rx={3} ry={1.6} fill={SKETCH.char} opacity={0.18} transform={`rotate(${(i * 37) % 180} ${(i * 73) % 400} ${20 + ((i * 47) % 190)})`} />
            ))}
            <G transform="translate(100 6)">
              <DishDrawing kind={motif} look={look} line={HERO_LINE} />
            </G>
          </G>
        ) : (
          <G transform="translate(8 6) scale(0.92)">
            <DishDrawing kind={motif} look={look} line={THUMB_LINE} tilt={tiltOf(look)} />
          </G>
        )}
      </Svg>
    </View>
  );
});
