import { StyleSheet } from 'react-native';
import Animated, { useAnimatedProps, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { SKETCH as K, useDriftClock } from '@driver/ui';
import { useAmbient } from './ambient';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** The closed-night picture is drawn in a 240 × 240 box. */
const DRAWN = 240;
/** The picture's stars (centre and half-size in its 240 box) and how often each one twinkles. */
const STARS = [
  { x: 78, y: 54, r: 11, period: 3.2, phase: 0.6 },
  { x: 120, y: 35, r: 7, period: 4.1, phase: 2.2 },
  { x: 198, y: 98, r: 5.5, period: 5.3, phase: 4.1 },
  { x: 142, y: 44, r: 5, period: 4.7, phase: 1.3 },
] as const;

/**
 * The night card's twinkle (Ali's Yes on the home effect "moon", 2026-10-07), laid over his approved
 * closed-night picture: each of the picture's stars flashes bright on its own beat. The stars are drawn
 * in the picture's own coordinates, so they stay on its stars in RTL too (the picture isn't mirrored).
 * It moves only while home is in front (`useAmbient`) and stays still under reduced motion.
 */
export function NightTwinkle({ size }: { size: number }) {
  const clock = useDriftClock(useAmbient());
  return (
    <Svg
      testID="home-night-twinkle"
      pointerEvents="none"
      width={size}
      height={size}
      viewBox={`0 0 ${DRAWN} ${DRAWN}`}
      style={StyleSheet.absoluteFill}
    >
      {STARS.map((s, i) => (
        <Star key={i} star={s} clock={clock} />
      ))}
    </Svg>
  );
}

function Star({ star, clock }: { star: (typeof STARS)[number]; clock: SharedValue<number> }) {
  const props = useAnimatedProps(() => {
    // Dark most of the beat, with one short bright flash that swells the star.
    const f = ((1 + Math.sin((2 * Math.PI * clock.value) / star.period + star.phase)) / 2) ** 4;
    const r = star.r * (0.5 + 0.6 * f);
    const { x, y } = star;
    // A soft four-pointed star, the same shape as the picture's own.
    return { d: `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`, opacity: 0.95 * f };
  });
  return <AnimatedPath animatedProps={props} fill={K.laban} />;
}
