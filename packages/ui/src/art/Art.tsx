import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { PICTURES } from './pictures';

export type ArtName = keyof typeof PICTURES;
/** Every approved picture, services first, then the empty and status screens. */
export const ART_NAMES = Object.keys(PICTURES) as ArtName[];

export interface ArtProps {
  name: ArtName;
  /** Width and height in px (the pictures are square, drawn on a 240 grid). */
  size?: number;
  /** Pictures are decoration by default; give a label only when the picture stands alone. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * One of the Date & Saffron pictures Ali approved and locked on 2026-10-07 (the services and the
 * empty and status screens; the dishes come with the food screens): flat paint with soft gradients
 * and no outlines, transparent, so the card or tinted stage behind gives the colour. Drawn from the
 * approved .svg files as they are (`scripts/build-art.mjs`), never redrawn here.
 */
export const Art = memo(function Art({ name, size = 120, accessibilityLabel, style, testID }: ArtProps) {
  return (
    <View
      testID={testID}
      accessible={!!accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
      accessibilityElementsHidden={!accessibilityLabel}
      style={[{ width: size, height: size }, style]}
    >
      <SvgXml xml={PICTURES[name].xml} width={size} height={size} />
    </View>
  );
});
