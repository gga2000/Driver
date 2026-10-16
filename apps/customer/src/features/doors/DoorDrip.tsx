import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '@driver/ui';

/** One slow drip: grow, let a drop go, rest. Slow on purpose (p4: a tiny slow drip, not a show). */
const GROW_MS = 2600;
const FALL_MS = 900;
const REST_MS = 3200;
const STEM_MIN = 4;
const STEM_MAX = 13;
const STEM = 6;
const DROP = 7;

/** Where the melt runs thicker (degrees from the arch's top, extra length in px); the middle one drips. */
const BUMPS: ReadonlyArray<readonly [number, number]> = [
  [-44, 7],
  [-24, 12],
  [0, 9],
  [19, 14],
  [40, 6],
];
/** The melt covers the arch's top this far each side of the middle, and is this thick between drips. */
const SPAN = 64;
const BASE = 4;

/** How thick the melt is at an angle: the base, plus each drip's rounded bump, thinning to nothing at the ends. */
function thickness(deg: number): number {
  const ends = Math.cos(((deg / SPAN) * Math.PI) / 2);
  let bump = 0;
  for (const [at, long] of BUMPS) bump = Math.max(bump, long * Math.exp(-(((deg - at) / 4.2) ** 2)));
  return ends * (BASE + bump);
}

/** The melted rim as one path: the arch's outer edge, then back along the drips' wavy lower edge. */
function meltPath(r: number): string {
  const at = (deg: number, rr: number) => {
    const a = (deg * Math.PI) / 180;
    return `${(r + rr * Math.sin(a)).toFixed(2)} ${(r - rr * Math.cos(a)).toFixed(2)}`;
  };
  let d = `M ${at(-SPAN, r)}`;
  for (let deg = -SPAN + 2; deg <= SPAN; deg += 2) d += ` L ${at(deg, r)}`;
  for (let deg = SPAN; deg >= -SPAN; deg -= 1) d += ` L ${at(deg, r - thickness(deg))}`;
  return `${d} Z`;
}

/**
 * The ice cream door melting a little in summer (Ali's Yes on p4): chocolate from the café door's
 * colour runs over the arch's rim, and the middle drip slowly lengthens and lets one drop go. Only on
 * the sweet door, only June to September; when the phone asks for less motion the drips stay still.
 */
export function DoorDrip({ width, top }: { width: number; top: number }) {
  const theme = useTheme();
  const colour = theme.services.trips.fill;
  const grow = useSharedValue(0);
  const fall = useSharedValue(0);

  useEffect(() => {
    if (theme.reduceMotion) return;
    grow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: GROW_MS, easing: Easing.inOut(Easing.quad) }),
        withDelay(FALL_MS, withTiming(0, { duration: 0 })),
        withTiming(0, { duration: REST_MS }),
      ),
      -1,
    );
    fall.value = withRepeat(
      withSequence(
        withTiming(0, { duration: GROW_MS }),
        withTiming(1, { duration: FALL_MS, easing: Easing.in(Easing.quad) }),
        withTiming(0, { duration: 0 }),
        withTiming(0, { duration: REST_MS }),
      ),
      -1,
    );
    return () => {
      cancelAnimation(grow);
      cancelAnimation(fall);
    };
  }, [theme.reduceMotion, grow, fall]);

  // Speed m2: the stem grows by scaling from its top (a transform), not by changing its height.
  const stemStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: (STEM_MIN + (STEM_MAX - STEM_MIN) * grow.value) / STEM_MAX }] }));
  const dropStyle = useAnimatedStyle(() => ({
    opacity: fall.value === 0 ? 0 : 1 - fall.value,
    transform: [{ translateY: 6 + 30 * fall.value }],
  }));

  const mid = width / 2;
  const tip = thickness(0);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top, start: 0, end: 0 }}>
      <Svg width={width} height={mid}>
        <Path d={meltPath(mid)} fill={colour} />
      </Svg>
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: tip - 4,
            start: mid - STEM / 2,
            width: STEM,
            height: STEM_MAX,
            transformOrigin: 'top',
            borderBottomStartRadius: STEM / 2,
            borderBottomEndRadius: STEM / 2,
            backgroundColor: colour,
          },
          stemStyle,
        ]}
      />
      {theme.reduceMotion ? null : (
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: tip,
              start: mid - DROP / 2,
              width: DROP,
              height: DROP,
              borderRadius: DROP / 2,
              backgroundColor: colour,
            },
            dropStyle,
          ]}
        />
      )}
    </View>
  );
}
