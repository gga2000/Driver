import { memo, useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

/**
 * An istikan, the tulip glass Iraqi tea is drunk from, on its saucer: home's pull to refresh (Ali's
 * Yes on the effects menu, 2026-10-07). Pull down and it fills with tea as far as you pulled; let go
 * past the line and it stays full with steam rising while the page refreshes. Drawn on a 64 × 92 grid
 * with react-native-svg; the tea is a clip that grows from the bottom (transforms and layout only, so
 * it runs the same on phones and the web). Decoration: the screen reader hears the refresh itself.
 */
const VB_W = 64;
const VB_H = 92;
/** The glass's outline: a flared lip, a narrow waist, a round belly on a flat foot. */
const GLASS =
  'M15 24H49C48 36 43 42 43 50C43 58 47 64 46 74C45.5 79 43 82 40 82H24C21 82 18.5 79 18 74C17 64 21 58 21 50C21 42 16 36 15 24Z';
/** Tea reaches from the foot (y 82) up to just under the gold rim (y 30). */
const TEA_BOTTOM = 82;
const TEA_TOP = 30;
const RIM = 'M15.7 28.5H48.3';
const SAUCER = 'M5 85.5C14 90.5 50 90.5 59 85.5';
const SHINE = 'M20.5 33C21 39 24 43 24.5 48';
const WISPS = ['M27 19c-4-5 4-7 0-12', 'M37 19c-4-5 4-7 0-12'] as const;

export interface TeaGlassProps {
  /** 0 empty … 1 full (a shared value, so a pull can drive it frame by frame). */
  level: SharedValue<number>;
  /** Steam rises while true (the refresh is running). */
  steaming: boolean;
  /** The glass's height in px (its width follows). */
  height?: number;
}

export const TeaGlass = memo(function TeaGlass({ level, steaming, height = 52 }: TeaGlassProps) {
  const theme = useTheme();
  const c = theme.decor.teaGlass;
  const k = height / VB_H;
  const width = VB_W * k;
  const span = (TEA_BOTTOM - TEA_TOP) * k;
  const tea = useAnimatedStyle(() => ({ height: Math.max(0, Math.min(1, level.value)) * span }));
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height }}
      testID="tea-glass"
    >
      {/* The tea: a window that grows up from the foot over a glass-shaped fill anchored to the bottom. */}
      <Animated.View
        style={[
          {
            position: 'absolute',
            start: 0,
            end: 0,
            bottom: (VB_H - TEA_BOTTOM) * k,
            overflow: 'hidden',
          },
          tea,
        ]}
      >
        <Svg
          width={width}
          height={height}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          style={{ position: 'absolute', start: 0, bottom: -(VB_H - TEA_BOTTOM) * k }}
        >
          <Path d={GLASS} fill={c.tea} />
        </Svg>
      </Animated.View>
      <Svg
        width={width}
        height={height}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        style={{ position: 'absolute', top: 0, start: 0 }}
      >
        <Path
          d={SHINE}
          fill="none"
          stroke={c.shine}
          strokeOpacity={0.7}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <Path d={GLASS} fill="none" stroke={c.glass} strokeWidth={2.6} strokeLinejoin="round" />
        <Path d={RIM} fill="none" stroke={c.rim} strokeWidth={2.4} strokeLinecap="round" />
        <Path d={SAUCER} fill="none" stroke={c.glass} strokeWidth={2.6} strokeLinecap="round" />
      </Svg>
      {WISPS.map((d, i) => (
        <Wisp
          key={d}
          d={d}
          delay={i * 320}
          on={steaming}
          width={width}
          height={height}
          color={c.steam}
        />
      ))}
    </View>
  );
});

/** One curl of steam: rises and fades on a loop while `on`; still and hidden otherwise or under reduced motion. */
function Wisp({
  d,
  delay,
  on,
  width,
  height,
  color,
}: {
  d: string;
  delay: number;
  on: boolean;
  width: number;
  height: number;
  color: string;
}) {
  const theme = useTheme();
  const p = useSharedValue(0);
  useEffect(() => {
    if (!on || theme.reduceMotion) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    p.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 1300, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 0 }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(p);
  }, [on, delay, p, theme.reduceMotion]);
  const style = useAnimatedStyle(() => ({
    // In over the first third, out over the rest, rising about a sixth of the glass.
    opacity: (p.value < 0.35 ? p.value / 0.35 : 1 - (p.value - 0.35) / 0.65) * 0.9,
    transform: [{ translateY: (0.5 - p.value) * height * 0.16 }],
  }));
  return (
    <Animated.View style={[{ position: 'absolute', top: 0, start: 0, width, height }, style]}>
      <Svg width={width} height={height} viewBox={`0 0 ${VB_W} ${VB_H}`}>
        <Path d={d} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}
