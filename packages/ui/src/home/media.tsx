import { memo, useCallback, useRef, useState, type ReactNode } from 'react';
import { Pressable, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg from 'react-native-svg';
import { DishDrawing } from '../art/dishes';
import { dishLook, motifForDish } from '../art/dish-motif';
import { LocalPhoto, PhotoImage } from '../components/PhotoImage';
import { usePressScale } from '../motion/motion';
import { useTheme, type HapticKind } from '../theme/ThemeProvider';

/** A dish picture: a bundled one (gallery, demo) or a network photo. */
export type DishPicture = { source: ImageSourcePropType } | { uri: string };

export interface PictureProps {
  picture?: DishPicture;
  /** The dish (or restaurant) name: picks the drawing when there is no photo. */
  name: string;
  /** Keeps two kitchens with the same dish from getting the same drawing. */
  seed: string;
  width: number | `${number}%`;
  height: number;
  radius: number;
  testID?: string;
}

/**
 * A photo, or the designed fallback (spec §8): the dish's own cut-out drawing on the card colour. The
 * fallback also shows when a photo link fails to load, so the customer never sees an empty box.
 */
export const Picture = memo(function Picture({ picture, name, seed, width, height, radius, testID }: PictureProps) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => setFailed(true), []);
  const style = { width, height, borderRadius: radius };
  if (picture && !failed) {
    return 'uri' in picture ? <PhotoImage uri={picture.uri} onError={onError} style={style} testID={testID ? `${testID}-photo` : undefined} /> : <LocalPhoto source={picture.source} style={style} />;
  }
  const side = Math.min(height, typeof width === 'number' ? width : height) * 0.92;
  return (
    <View testID={testID ? `${testID}-fallback` : undefined} accessible={false} style={{ width, height, borderRadius: radius, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <Svg width={side} height={side} viewBox="0 0 200 200">
        <DishDrawing kind={motifForDish(name)} look={dishLook(seed)} window={false} />
      </Svg>
    </View>
  );
});

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface HomePressProps {
  onPress?: () => void;
  /** Haptic on press; `'secondary'` follows the theme (silent where secondary buttons are silent). */
  haptic?: HapticKind | 'secondary' | false;
  /** Ignore a second tap for this long (reorder, add): one tap, one order. */
  guardMs?: number;
  disabled?: boolean;
  accessibilityRole?: 'button' | 'radio' | 'link';
  accessibilityLabel?: string;
  checked?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: ReactNode;
}

/**
 * The home's one pressable: the app's press scale (still under Reduce Motion), the theme's haptics and a
 * double-tap guard, so every card and button on the home feels the same under the finger.
 */
export function HomePress({ onPress, haptic = 'secondary', guardMs = 0, disabled, accessibilityRole = 'button', accessibilityLabel, checked, style, testID, children }: HomePressProps) {
  const theme = useTheme();
  const press = usePressScale();
  const last = useRef(0);
  const off = disabled || !onPress;
  return (
    <AnimatedPressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      aria-checked={accessibilityRole === 'radio' ? !!checked : undefined}
      aria-disabled={off || undefined}
      disabled={off}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => {
        const now = Date.now();
        if (guardMs && now - last.current < guardMs) return;
        last.current = now;
        const kind = haptic === 'secondary' ? theme.secondaryButtonHaptic : haptic;
        if (kind) theme.haptic(kind);
        onPress?.();
      }}
      testID={testID}
      style={[style, press.style]}
    >
      {children}
    </AnimatedPressable>
  );
}
