import { useEffect, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedProps, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import type { ThemeColorKey } from '@driver/design-tokens';
import { ringArcs } from '../logic/ring';
import { useTheme } from '../theme/ThemeProvider';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface SegmentRingProps {
  /** How many segments (today's jobs). 0 draws only the track. */
  count: number;
  /** Fill the last segment with a sweep (the job that just finished); the others are already full. */
  animateLast?: boolean;
  size?: number;
  strokeWidth?: number;
  /** Filled segments; the newest one uses `lastColor`. */
  color?: ThemeColorKey;
  lastColor?: ThemeColorKey;
  /** Delay before the sweep starts (after the check has landed). */
  delayMs?: number;
  /** The centre (a check, a number). */
  children?: ReactNode;
  /** Spoken summary ("اليوم 15,000 دينار · 7 طلبات"). */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A ring made of one segment per item — the Partner end-of-job ring (audit S-3): every job today is a
 * segment and the one he just finished sweeps in. Honest by construction: it counts what happened,
 * it is not a progress bar toward a target. Reduced motion shows it filled.
 */
export function SegmentRing({ count, animateLast = true, size = 168, strokeWidth = 8, color = 'success', lastColor = 'accent', delayMs = 250, children, accessibilityLabel, style, testID = 'segment-ring' }: SegmentRingProps) {
  const theme = useTheme();
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  // Round caps eat half the stroke at each end: the gap is wider than the stroke so segments read apart.
  const arcs = ringArcs(count, circ, count > 1 ? Math.min(strokeWidth + 6, circ / count / 2) : 0);
  const p = useSharedValue(animateLast && !theme.reduceMotion ? 0 : 1);
  useEffect(() => {
    if (!animateLast || theme.reduceMotion) {
      p.value = 1;
      return;
    }
    p.value = 0;
    p.value = withDelay(delayMs, withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }));
  }, [count, animateLast, delayMs, theme.reduceMotion, p]);
  const last = arcs.at(-1);
  const lastProps = useAnimatedProps(() => ({ strokeDashoffset: circ - (last?.length ?? 0) * p.value }));
  const c = size / 2;
  return (
    <View testID={testID} accessible={Boolean(accessibilityLabel)} accessibilityLabel={accessibilityLabel} style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle cx={c} cy={c} r={r} stroke={theme.colors.surfaceSunken} strokeWidth={strokeWidth} fill="none" />
        {arcs.slice(0, -1).map((a, i) => (
          <Circle
            key={i}
            cx={c}
            cy={c}
            r={r}
            stroke={theme.colors[color]}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circ} ${circ}`}
            strokeDashoffset={circ - a.length}
            transform={rotateAbout(a.startDeg - 90, c)}
          />
        ))}
        {last ? (
          <AnimatedCircle
            cx={c}
            cy={c}
            r={r}
            stroke={theme.colors[lastColor]}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circ} ${circ}`}
            transform={rotateAbout(last.startDeg - 90, c)}
            animatedProps={lastProps}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

/**
 * An SVG `rotate(deg cx cy)` about the ring's centre. A transform string instead of `rotation` +
 * `origin`: on the web react-native-svg turns `origin` into a `transform-origin` DOM attribute, which
 * React rejects ("Invalid DOM property transform-origin").
 */
function rotateAbout(deg: number, c: number): string {
  return `rotate(${deg} ${c} ${c})`;
}
