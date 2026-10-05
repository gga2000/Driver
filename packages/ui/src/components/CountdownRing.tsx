import { useEffect, useRef, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { t } from '@driver/i18n';
import { formatAmount, formatCountdown } from '../format';
import { acceptRing, lateMeter, type LateMeterConfig } from '../logic/countdown';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const TICK = 250;

function useNow(clock: () => number, running: boolean): number {
  const [now, setNow] = useState(clock);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(clock()), TICK);
    return () => clearInterval(id);
  }, [clock, running]);
  return now;
}

interface RingProps {
  size?: number;
  strokeWidth?: number;
  /** Injected clock (tests, server-synced time). */
  clock?: () => number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export type CountdownRingProps =
  | (RingProps & {
      mode: 'accept';
      /** Epoch ms when the offer was shown. */
      startedAt: number;
      durationMs: number;
      onExpire?: () => void;
      /** Freeze the ring where it is (offer screen covered by a call, gallery specimens). */
      paused?: boolean;
      /** Caption under the number; defaults to nothing (the ring says enough). */
      caption?: string;
      /** `seconds` (default: "14") for short offers; `clock` ("9:41") for long holds such as the 10-minute seat hold. */
      format?: 'seconds' | 'clock';
      /** Last stretch that turns the ring danger (default 5 s). */
      urgentMs?: number;
    })
  | (RingProps & {
      mode: 'late';
      /** Epoch ms of the scheduled departure / meeting time. */
      startedAt: number;
      config: LateMeterConfig;
      /** Captions per phase: grace ("قبل ما يبدي العداد"), metering ("للسايق والركاب"), forfeited. */
      captions?: { grace?: string; metering?: string; forfeited?: string };
    });

function Ring({
  size,
  strokeWidth,
  color,
  track,
  fraction,
  durationToFull,
  grow = false,
}: {
  size: number;
  strokeWidth: number;
  color: string;
  track: string;
  /** Current fill 0..1 (elapsed fraction for accept = how much is gone). */
  fraction: number;
  /** When set, sweep linearly from `fraction` to 1 over this many ms (one smooth animation). */
  durationToFull?: number;
  /** Arc grows with the fraction (late meter) instead of depleting (accept ring). */
  grow?: boolean;
}) {
  const { reduceMotion } = useTheme();
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const p = useSharedValue(fraction);
  const lastStart = useRef<number | null>(null);

  useEffect(() => {
    if (durationToFull != null) {
      // Start one long linear sweep per countdown; re-sync only if we drift.
      if (lastStart.current === null || Math.abs(p.value - fraction) > 0.05) {
        cancelAnimation(p);
        p.value = fraction;
        if (!reduceMotion) p.value = withTiming(1, { duration: durationToFull, easing: Easing.linear });
        lastStart.current = fraction;
      }
      if (reduceMotion) p.value = fraction;
      return;
    }
    p.value = reduceMotion ? fraction : withTiming(fraction, { duration: TICK, easing: Easing.linear });
  }, [fraction, durationToFull, reduceMotion, p]);

  const animatedProps = useAnimatedProps(() => ({ strokeDashoffset: grow ? circ * (1 - p.value) : circ * p.value }));
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={strokeWidth} fill="none" />
      <AnimatedCircle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
        strokeDasharray={`${circ} ${circ}`}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}

/**
 * Two timers on one ring: the partner/merchant accept ring (depletes; turns danger for the last
 * 5 s with a haptic) and the intercity late meter (grace → metering → forfeited).
 */
export function CountdownRing(props: CountdownRingProps) {
  const theme = useTheme();
  const { size = 112, strokeWidth = 8, clock = Date.now, style, testID = 'countdown' } = props;
  if (props.mode === 'accept') {
    return <AcceptRing {...props} size={size} strokeWidth={strokeWidth} clock={clock} style={style} testID={testID} />;
  }
  return <LateRing {...props} size={size} strokeWidth={strokeWidth} clock={clock} style={style} testID={testID} colors={theme.colors} />;
}

function AcceptRing({
  startedAt,
  durationMs,
  onExpire,
  paused = false,
  caption,
  format = 'seconds',
  urgentMs,
  size,
  strokeWidth,
  clock,
  style,
  testID,
}: Extract<CountdownRingProps, { mode: 'accept' }> & { size: number; strokeWidth: number; clock: () => number; testID: string }) {
  const theme = useTheme();
  const [done, setDone] = useState(false);
  const now = useNow(clock, !done && !paused);
  const s = acceptRing(now, startedAt, durationMs, urgentMs);
  const urgentRef = useRef(false);

  useEffect(() => {
    if (s.urgent && !urgentRef.current) {
      urgentRef.current = true;
      theme.haptic('warning');
    }
    if (s.expired && !done) {
      setDone(true);
      onExpire?.();
    }
  }, [s.urgent, s.expired, done, onExpire, theme]);

  const seconds = Math.ceil(s.remainingMs / 1000);
  const color = s.urgent || s.expired ? theme.colors.danger : theme.colors.accent;
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={format === 'clock' ? formatCountdown(s.remainingMs) : t('ui.seconds_left', { seconds })}
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <View style={{ position: 'absolute' }}>
        <Ring
          size={size}
          strokeWidth={strokeWidth}
          color={color}
          track={theme.colors.surfaceSunken}
          fraction={s.elapsedFraction}
          durationToFull={paused ? undefined : s.remainingMs}
        />
      </View>
      {/* Mini rings (a rush queue chip, a sticky bar) scale the number down so it stays inside. */}
      <Text
        variant={size >= 56 ? 'display' : size >= 40 ? 'title' : 'label'}
        weight={size >= 56 ? undefined : 700}
        tabular
        color={s.urgent ? 'dangerText' : 'text'}
        testID={`${testID}-value`}
        style={{ lineHeight: size >= 56 ? 40 : size >= 40 ? 24 : 18 }}
      >
        {format === 'clock' ? formatCountdown(s.remainingMs) : seconds}
      </Text>
      {caption ? (
        <Text variant="caption" color="textMuted">
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

function LateRing({
  startedAt,
  config,
  captions,
  size,
  strokeWidth,
  clock,
  style,
  testID,
  colors,
}: Extract<CountdownRingProps, { mode: 'late' }> & {
  size: number;
  strokeWidth: number;
  clock: () => number;
  testID: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const now = useNow(clock, true);
  const m = lateMeter(now - startedAt, config);
  const ring = m.phase === 'grace' ? colors.accent : m.phase === 'metering' ? colors.warning : colors.danger;
  const caption = captions?.[m.phase];
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={
        m.phase === 'grace'
          ? formatCountdown(m.remainingMs)
          : `${formatAmount(m.amount)} ${t('quote.currency')}، ${formatCountdown(m.remainingMs)}`
      }
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <View style={{ position: 'absolute' }}>
        <Ring size={size} strokeWidth={strokeWidth} color={ring} track={colors.surfaceSunken} fraction={m.fraction} grow />
      </View>
      {m.phase === 'grace' ? (
        <Text variant="title" tabular testID={`${testID}-value`}>
          {formatCountdown(m.remainingMs)}
        </Text>
      ) : (
        <View style={{ alignItems: 'center' }}>
          <Text variant="title" tabular color={m.phase === 'forfeited' ? 'dangerText' : 'warningText'} testID={`${testID}-value`}>
            {formatAmount(m.amount)}
          </Text>
          <Text variant="caption" color="textMuted" tabular>
            {m.phase === 'metering' ? formatCountdown(m.remainingMs) : t('quote.currency')}
          </Text>
        </View>
      )}
      {caption ? (
        <Text variant="caption" color="textMuted" align="center" style={{ maxWidth: size - strokeWidth * 4 }} numberOfLines={2}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}
