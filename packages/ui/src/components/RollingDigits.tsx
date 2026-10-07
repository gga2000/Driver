import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { BrandFace, TypeVariant } from '@driver/design-tokens';
import { flapCells } from '../logic/departure';
import type { ColorValue } from '../theme/color';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface RollingDigitsProps {
  /** The number or clock to show ("12:45", "3"). */
  value: string;
  variant?: TypeVariant;
  face?: BrandFace;
  color?: ColorValue;
  testID?: string;
}

/**
 * A number or clock whose changed digits roll (Ali's Yes, home effects "flip", 2026-10-07): the old
 * digit slides up and out as the new one rises in from below, in `duration.digitRoll`; the digits
 * that did not change stay still. Cells are keyed from the right end (`flapCells`), so "9:59" →
 * "10:00" rolls the minutes in place. Plain digits on whatever is behind them; the garage-board
 * tiles are `DepartureTime`. Under reduced motion a digit simply changes. Hidden from screen
 * readers: the caller says the whole value in its own label.
 */
export function RollingDigits({ value, variant = 'numeralHero', face, color = 'text', testID }: RollingDigitsProps) {
  return (
    <View testID={testID} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ flexDirection: 'row', direction: 'ltr' }}>
      {flapCells(value).map((cell) => (
        <RollCell key={cell.key} char={cell.char} variant={variant} face={face} color={color} />
      ))}
    </View>
  );
}

function RollCell({ char, variant, face, color }: { char: string; variant: TypeVariant; face: BrandFace | undefined; color: ColorValue }) {
  const theme = useTheme();
  const h = theme.type[variant].lineHeight;
  const shown = useRef(char);
  const [prev, setPrev] = useState<string | null>(null);
  const p = useSharedValue(1);

  useEffect(() => {
    if (char === shown.current) return;
    const old = shown.current;
    shown.current = char;
    if (theme.reduceMotion) {
      setPrev(null);
      return;
    }
    const [x1, y1, x2, y2] = theme.motion.bezier.standard;
    setPrev(old);
    p.value = 0;
    p.value = withTiming(1, { duration: theme.motion.duration.digitRoll, easing: Easing.bezier(x1, y1, x2, y2) }, (done) => {
      if (done) runOnJS(setPrev)(null);
    });
  }, [char, theme.reduceMotion, theme.motion, p]);

  // At rest (p = 1) the incoming digit is exactly where a still one would be.
  const incoming = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * h * 0.6 }] }));
  const outgoing = useAnimatedStyle(() => ({ opacity: 1 - p.value, transform: [{ translateY: -p.value * h * 0.6 }] }));
  const glyph = (s: string) => (
    <Text variant={variant} face={face} color={color} tabular>
      {s}
    </Text>
  );
  return (
    <View style={{ overflow: 'hidden' }}>
      {/* The new character sizes the cell; the old one rides out over it. */}
      <Animated.View style={incoming}>{glyph(char)}</Animated.View>
      {prev !== null ? <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center' }, outgoing]}>{glyph(prev)}</Animated.View> : null}
    </View>
  );
}
