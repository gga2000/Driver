import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { lift as liftTokens, type ElevationLevel } from '@driver/design-tokens';
import { AnimatedPressable, usePressScale } from '../motion/motion';
import { useTheme } from '../theme/ThemeProvider';

export interface CardProps {
  children: ReactNode;
  /** 0 = flat with a hairline border (lists inside sheets); 1 = resting card; 2 = lifted; 3 = floating. */
  elevation?: ElevationLevel;
  padding?: 0 | 3 | 4 | 5;
  /** `sunken` for wells inside a card; `tint` for the selected/pinned card. */
  tone?: 'surface' | 'sunken' | 'tint';
  /** A white card on a soft warm lift instead of the elevation shadow (home's cards, Date & Saffron). */
  lift?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Card({ children, elevation = 1, padding = 4, tone = 'surface', lift = false, onPress, accessibilityLabel, style, testID }: CardProps) {
  const theme = useTheme();
  // Home's lifted cards sink a little deeper, like the service tiles (Date & Saffron "press").
  const press = usePressScale(lift ? 0.97 : 0.985);
  const e = theme.elevation[elevation];
  const bg = tone === 'sunken' ? theme.colors.surfaceSunken : tone === 'tint' ? theme.colors.accentTint : theme.colors.surface;
  const base: ViewStyle = {
    backgroundColor: bg,
    borderRadius: theme.radius.xl,
    padding: theme.space[padding],
    borderWidth: elevation === 0 || tone !== 'surface' ? 1 : 0,
    // No accent box around a tint card in istikan (joy S2-11); light keeps its accent border.
    borderColor: tone === 'tint' ? theme.colors.tintBorder : theme.colors.border,
    ...(lift
      ? { boxShadow: theme.scheme === 'dark' ? undefined : liftTokens.card }
      : {
          shadowColor: theme.colors.shadow,
          shadowOpacity: theme.scheme === 'dark' ? 0 : e.shadowOpacity,
          shadowRadius: e.shadowRadius,
          shadowOffset: e.shadowOffset,
          elevation: e.elevation,
        }),
    // Flat cards hold edge-to-edge rows; clip them to the radius (no shadow to lose).
    overflow: elevation === 0 ? 'hidden' : undefined,
  };
  if (!onPress) {
    return (
      <View testID={testID} style={[base, style]}>
        {children}
      </View>
    );
  }
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={onPress}
      style={[base, press.style, style]}
    >
      {children}
    </AnimatedPressable>
  );
}
