import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Icon, useDriftClock, useTheme } from '@driver/ui';
import { useAmbient } from './ambient';

const BOX = 48;
/** A four-pointed star in a 10 × 10 box. */
const STAR_D = 'M5 0L6.1 3.9L10 5L6.1 6.1L5 10L3.9 6.1L0 5L3.9 3.9Z';
/** Where the three stars sit around the moon (px from the box's top and start), how big, how often they twinkle. */
const STARS = [
  { top: 7, start: 8, size: 7, period: 3.2, phase: 0.6 },
  { top: 9, start: 34, size: 5, period: 4.1, phase: 2.2 },
  { top: 33, start: 35, size: 6, period: 5.3, phase: 4.1 },
] as const;
/** The moon swings this far (degrees) once every `SWAY_S` seconds. */
const SWAY_DEG = 9;
const SWAY_S = 6;

/**
 * The late-night card's badge (Ali's Yes, home effects "moon", 2026-10-07): the moon in its ink
 * square sways slowly, like a lantern hung by the door, and three small stars around it twinkle,
 * each on its own beat. It moves for a while each time home comes to the front (`useAmbient`), then
 * rests, and is still under reduced motion. Decoration: screen readers hear the card's title instead.
 */
export function NightMoon() {
  const theme = useTheme();
  const clock = useDriftClock(useAmbient());
  const sway = useAnimatedStyle(() => {
    const a = (2 * Math.PI * clock.value) / SWAY_S;
    return { transform: [{ rotate: `${SWAY_DEG * Math.sin(a)}deg` }, { translateY: -1.5 * Math.cos(a) }] };
  });
  return (
    <View
      testID="home-night-moon"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ width: BOX, height: BOX, borderRadius: theme.radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.inverse, overflow: 'hidden' }}
    >
      {STARS.map((s, i) => (
        <Star key={i} star={s} clock={clock} color={theme.colors.onInverseAccent} />
      ))}
      <Animated.View style={sway}>
        <Icon name="moon" size={24} color="onInverseAccent" strokeWidth={2} />
      </Animated.View>
    </View>
  );
}

function Star({ star, clock, color }: { star: (typeof STARS)[number]; clock: SharedValue<number>; color: string }) {
  const twinkle = useAnimatedStyle(() => {
    // Mostly dim, with a short bright moment once a beat.
    const k = ((1 + Math.sin((2 * Math.PI * clock.value) / star.period + star.phase)) / 2) ** 3;
    return { opacity: 0.25 + 0.75 * k, transform: [{ scale: 0.7 + 0.3 * k }] };
  });
  return (
    <Animated.View style={[{ position: 'absolute', top: star.top, start: star.start, width: star.size, height: star.size }, twinkle]}>
      <Svg width={star.size} height={star.size} viewBox="0 0 10 10">
        <Path d={STAR_D} fill={color} />
      </Svg>
    </Animated.View>
  );
}
