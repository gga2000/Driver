import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import type { IconName } from '../icons/paths';
import { Icon } from '../icons/Icon';
import { AnimatedPressable } from '../motion/motion';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/** How long a hold takes to confirm (partner redesign o3: half a second). */
export const HOLD_MS = 500;
/** With a screen reader, how long the second tap stays armed. */
export const HOLD_CONFIRM_WINDOW_MS = 4_000;

export interface HoldButtonProps {
  /** "اقبل". */
  label: string;
  /** Shown after a tap too short to count ("ثبّت إصبعك"). */
  holdHint: string;
  /** Screen readers: the first tap arms, this label asks for the second ("اضغط مرة ثانية حتى تقبل"). */
  confirmLabel: string;
  onConfirm: () => void;
  holdMs?: number;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Something small at the end (the seconds left). */
  trailing?: string;
  /** Injected screen-reader state (tests and the gallery); native asks the OS otherwise. */
  screenReader?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function useScreenReader(forced?: boolean): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    // react-native-web always answers true (it can't tell), so only native asks.
    if (forced !== undefined || Platform.OS === 'web') return;
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled?.()
      .then((v) => alive && setOn(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('screenReaderChanged', (v: boolean) => setOn(!!v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, [forced]);
  return forced ?? on;
}

/**
 * Press and hold to confirm (partner redesign o3, o6): a 72 px accent button that an ink fill sweeps
 * across from the start edge only while the finger is down, and confirms when it is full — a pothole or a
 * bump in a handlebar mount can't accept. Let go early and it drains back with a hint. With a screen
 * reader on, a plain tap arms it and a second tap confirms (holding isn't possible there).
 */
export function HoldButton({
  label,
  holdHint,
  confirmLabel,
  onConfirm,
  holdMs = HOLD_MS,
  icon = 'check',
  loading = false,
  disabled = false,
  trailing,
  screenReader: forcedReader,
  style,
  testID = 'hold-button',
}: HoldButtonProps) {
  const theme = useTheme();
  const reader = useScreenReader(forcedReader);
  const progress = useSharedValue(0);
  const nudge = useSharedValue(0);
  const done = useRef(false);
  const [hint, setHint] = useState(false);
  const [armed, setArmed] = useState(false);
  const inactive = disabled || loading;

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), HOLD_CONFIRM_WINDOW_MS);
    return () => clearTimeout(id);
  }, [armed]);
  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(false), 1_800);
    return () => clearTimeout(id);
  }, [hint]);

  const fire = () => {
    if (done.current) return;
    done.current = true;
    theme.haptic('success');
    onConfirm();
  };
  const tooShort = () => {
    if (done.current) return;
    setHint(true);
    theme.haptic('light');
  };

  const begin = () => {
    if (inactive || reader || done.current) return;
    theme.haptic('medium');
    cancelAnimation(progress);
    progress.value = withTiming(1, { duration: Math.round(holdMs * (1 - progress.value)), easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(fire)();
    });
  };
  const end = () => {
    if (inactive || reader || done.current) return;
    if (progress.value < 1) {
      cancelAnimation(progress);
      progress.value = withTiming(0, { duration: theme.reduceMotion ? 0 : 180 });
      if (!theme.reduceMotion) nudge.value = withSequence(withTiming(-4, { duration: 50 }), withTiming(4, { duration: 70 }), withTiming(0, { duration: 50 }));
      runOnJS(tooShort)();
    }
  };
  const tap = () => {
    if (inactive || !reader || done.current) return;
    if (!armed) {
      setArmed(true);
      theme.haptic('selection');
      AccessibilityInfo.announceForAccessibility?.(confirmLabel);
      return;
    }
    fire();
  };

  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(1, progress.value)) * 100}%` }));
  const shake = useAnimatedStyle(() => ({ transform: [{ translateX: nudge.value }] }));
  const [width, setWidth] = useState(0);
  const shown = armed ? confirmLabel : hint ? holdHint : label;
  // Drawn twice: ink on the pale track, and a copy clipped to the fill in its "on" colour.
  const row = (fg: 'onAccent' | 'onInverse', ids: boolean) => (
    <View style={{ width: width || '100%', height: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space[5], gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexShrink: 1 }}>
        {loading ? <ActivityIndicator color={theme.colors[fg]} /> : <Icon name={icon} size={24} color={fg} strokeWidth={2.4} />}
        <Text variant="title" weight={700} color={fg} numberOfLines={1} style={{ fontSize: hint || armed ? 18 : 22, lineHeight: 30, flexShrink: 1 }} testID={ids ? `${testID}-label` : undefined}>
          {shown}
        </Text>
      </View>
      {trailing ? (
        <Text variant="title" weight={700} color={fg} tabular style={{ fontSize: 22, lineHeight: 30 }}>
          {trailing}
        </Text>
      ) : null}
    </View>
  );
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={armed ? confirmLabel : label}
      accessibilityHint={reader ? undefined : holdHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      aria-disabled={inactive}
      aria-busy={loading}
      disabled={inactive}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      onPressIn={begin}
      onPressOut={end}
      onPress={tap}
      style={[
        {
          height: 72,
          borderRadius: theme.radius.xl,
          backgroundColor: armed ? theme.colors.inverse : theme.colors.accent,
          overflow: 'hidden',
          opacity: disabled ? theme.state.disabledOpacity : 1,
        },
        shake,
        style,
      ]}
    >
      {row(armed ? 'onInverse' : 'onAccent', true)}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, start: 0, overflow: 'hidden', backgroundColor: theme.colors.inverse }, fillStyle]}>
        {row('onInverse', false)}
      </Animated.View>
    </AnimatedPressable>
  );
}
