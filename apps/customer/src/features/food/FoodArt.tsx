import { memo } from 'react';
import { View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import { PhotoImage, SKETCH, useLiteMode, useNearView, usePhotoFallback } from '@driver/ui';
import { DishDrawing } from '@driver/ui/dishes';
import Svg, { Circle, Ellipse, G } from 'react-native-svg';
import { apiPhoto } from '@/lib/photo';
import { ART_LOOKS, type Motif } from './food-art';

export { artOf, dishArt, kitchenLook, motifForCuisine, motifForDish, motifForKitchen, type DishArt, type Motif } from './food-art';

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
  /**
   * Wide kitchen hero (with a scatter of sesame dots), a 16:9 dish picture for the item sheet (joy o2:
   * the dish centred on its paper, a few dots), or a square dish thumbnail.
   */
  variant?: 'hero' | 'wide' | 'thumb';
  /**
   * A thumbnail on a coloured plate (Date & Saffron dish cards, food-type circles, restaurant rows):
   * the plate's colour instead of the paper, and no arch window behind the dish.
   */
  stage?: string;
  style?: StyleProp<ViewStyle>;
}

export const FoodArt = memo(function FoodArt({ motif, look = 0, photoUrl, variant = 'thumb', stage, style }: FoodArtProps) {
  // Low-data mode (maps program q2): the drawn dish instead of downloading the photo.
  const lite = useLiteMode();
  // A merchant's own upload comes as a signed link relative to the API origin (dev storage); once it
  // expires (a cart kept from yesterday) and fails to load, the drawn dish shows instead.
  const photo = usePhotoFallback(apiPhoto(photoUrl));
  // Speed w2: on the web a painted dish far below the screen waits (its paper shows) until it's near.
  const { ref, near } = useNearView();
  // Cached on the phone (expo-image via PhotoImageProvider): a menu seen yesterday doesn't download again.
  if (photo.uri && !lite) return <PhotoImage uri={photo.uri} onError={photo.onError} style={[{ width: '100%', height: '100%' }, style as StyleProp<ImageStyle>]} />;
  const hero = variant === 'hero';
  if (variant === 'wide') {
    return (
      <View ref={ref} style={[{ width: '100%', height: '100%', backgroundColor: SKETCH.paper, overflow: 'hidden' }, style]} accessible={false} aria-hidden importantForAccessibility="no-hide-descendants">
        {near ? (
        <Svg width="100%" height="100%" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">
          <Circle cx={270} cy={20} r={90} fill={SKETCH.juice} opacity={0.12} />
          {Array.from({ length: 12 }, (_, i) => (
            <Ellipse key={i} cx={(i * 61) % 320} cy={12 + ((i * 43) % 160)} rx={2.6} ry={1.4} fill={SKETCH.char} opacity={0.16} transform={`rotate(${(i * 37) % 180} ${(i * 61) % 320} ${12 + ((i * 43) % 160)})`} />
          ))}
          <G transform="translate(80 10) scale(0.8)">
            <DishDrawing kind={motif} look={look} line={HERO_LINE} tilt={tiltOf(look)} />
          </G>
        </Svg>
        ) : null}
      </View>
    );
  }
  return (
    <View ref={ref} style={[{ width: '100%', height: '100%', backgroundColor: !hero && stage ? stage : SKETCH.paper, overflow: 'hidden' }, style]} accessible={false} aria-hidden importantForAccessibility="no-hide-descendants">
      {near ? (
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
            <DishDrawing kind={motif} look={look} line={THUMB_LINE} tilt={tiltOf(look)} window={!stage} />
          </G>
        )}
      </Svg>
      ) : null}
    </View>
  );
});
