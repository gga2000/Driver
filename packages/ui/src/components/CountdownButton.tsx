import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { t } from '@driver/i18n';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { acceptRing } from '../logic/countdown';
import { AnimatedPressable, usePressScale } from '../motion/motion';
import { useTheme, type HapticKind } from '../theme/ThemeProvider';
import { Text } from './Text';

const TICK = 250;

export interface CountdownButtonProps {
  /** "اقبل". */
  label: string;
  onPress: () => void;
  /** Epoch ms the countdown started (offer sent) and its length. */
  startedAt: number;
  durationMs: number;
  /** Called once when the time runs out (not after a press). */
  onExpire?: () => void;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Last stretch that turns the fill danger with a `warning` haptic (default 5 s). */
  urgentMs?: number;
  haptic?: HapticKind | false;
  /** One `warning` haptic when the last stretch starts (off when the screen ticks every second itself). */
  urgentHaptic?: boolean;
  /** Injected clock (tests). */
  clock?: () => number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The offer's accept (partner S-1, P-03): a full-width 72 px button whose fill is the time left,
 * draining toward the start edge, with the seconds at the end. In the last 5 s the fill turns
 * danger. One tap accepts — speed matters; the friction lives on decline.
 */
export function CountdownButton({
  label,
  onPress,
  startedAt,
  durationMs,
  onExpire,
  icon = 'check',
  loading = false,
  disabled = false,
  urgentMs,
  haptic = 'medium',
  urgentHaptic = true,
  clock = Date.now,
  style,
  testID = 'countdown-button',
}: CountdownButtonProps) {
  const theme = useTheme();
  const press = usePressScale();
  const [now, setNow] = useState(clock);
  const [expired, setExpired] = useState(false);
  const stopped = loading || expired;
  useEffect(() => {
    if (stopped) return;
    const id = setInterval(() => setNow(clock()), TICK);
    return () => clearInterval(id);
  }, [clock, stopped]);

  const s = acceptRing(now, startedAt, durationMs, urgentMs);
  const left = 1 - s.elapsedFraction;
  const seconds = Math.ceil(s.remainingMs / 1000);

  // One linear drain per countdown (re-synced only on drift); per-tick steps under reduced motion.
  const fill = useSharedValue(left);
  const synced = useRef(false);
  useEffect(() => {
    if (theme.reduceMotion || stopped) {
      cancelAnimation(fill);
      fill.value = left;
      return;
    }
    if (!synced.current || Math.abs(fill.value - left) > 0.05) {
      synced.current = true;
      cancelAnimation(fill);
      fill.value = left;
      fill.value = withTiming(0, { duration: s.remainingMs, easing: Easing.linear });
    }
  }, [left, s.remainingMs, theme.reduceMotion, stopped, fill]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(1, fill.value)) * 100}%` }));

  const urgentRef = useRef(false);
  useEffect(() => {
    if (s.urgent && !urgentRef.current) {
      urgentRef.current = true;
      if (urgentHaptic) theme.haptic('warning');
    }
    if (s.expired && !expired && !loading) {
      setExpired(true);
      onExpire?.();
    }
  }, [s.urgent, s.expired, expired, loading, onExpire, theme, urgentHaptic]);

  const urgent = s.urgent || s.expired;
  const inactive = disabled || loading || expired;
  const [width, setWidth] = useState(0);
  // The row is drawn twice: ink on the pale track, and a copy clipped to the fill in the fill's own
  // "on" colour (white on danger), so the label stays readable wherever the fill edge is.
  const row = (fg: 'text' | 'onDanger' | 'onAccent', ids: boolean) => (
    <View style={{ width: width || '100%', height: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space[5] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        {loading ? <ActivityIndicator color={theme.colors[fg]} /> : <Icon name={icon} size={24} color={fg} strokeWidth={2.4} />}
        <Text variant="title" weight={700} color={fg} style={{ fontSize: 22, lineHeight: 30 }}>
          {label}
        </Text>
      </View>
      <Text variant="title" weight={700} color={fg} tabular testID={ids ? `${testID}-seconds` : undefined} style={{ fontSize: 22, lineHeight: 30 }}>
        {String(seconds)}
      </Text>
    </View>
  );
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={{ text: t('ui.seconds_left', { seconds }) }}
      accessibilityState={{ disabled: inactive, busy: loading }}
      aria-disabled={inactive}
      aria-busy={loading}
      disabled={inactive}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => {
        if (haptic) theme.haptic(haptic);
        onPress();
      }}
      style={[
        {
          height: 72,
          borderRadius: theme.radius.xl,
          backgroundColor: urgent ? theme.colors.dangerTint : theme.colors.accentTint,
          overflow: 'hidden',
          opacity: disabled ? theme.state.disabledOpacity : 1,
        },
        press.style,
        style,
      ]}
    >
      {row('text', true)}
      <Animated.View
        testID={`${testID}-fill`}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
        style={[{ position: 'absolute', top: 0, bottom: 0, start: 0, overflow: 'hidden', backgroundColor: urgent ? theme.colors.danger : theme.colors.accent }, fillStyle]}
      >
        <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0 }}>{row(urgent ? 'onDanger' : 'onAccent', false)}</View>
      </Animated.View>
    </AnimatedPressable>
  );
}
