import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, Easing, runOnJS, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { t } from '@driver/i18n';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import {
  SLIDE_HOLD_MS,
  SLIDE_INSET,
  SLIDE_THUMB_SIZE,
  SLIDE_TRACK_HEIGHT,
  slideLabelOpacity,
  slideMode,
  slideOffset,
  slideProgress,
  slideRelease,
  slideTickCrossed,
  slideTravel,
} from '../logic/slide';
import { withAlpha } from '../theme/color';
import { useTheme, type HapticKind } from '../theme/ThemeProvider';
import { Text } from './Text';

/** `quiet`: a cream track with an ink thumb, for ending something calmly (the Partner app's «اسحب حتى توقف»). */
export type SlideTone = 'accent' | 'danger' | 'quiet';

export interface SlideToConfirmProps {
  /** What sliding does, said as the action: "استلمت الطلب", "انتهت الرحلة". */
  label: string;
  onConfirm: () => void;
  /** Thumb glyph; directional glyphs mirror in RTL. */
  icon?: IconName;
  tone?: SlideTone;
  /** The confirmed action is in flight: the thumb stays at the end with a spinner. */
  loading?: boolean;
  disabled?: boolean;
  /** A short line under the label inside the track ("المطعم بعده ما خلّص"). */
  note?: string;
  /**
   * `auto` (default): slide, or press-and-hold when the OS asks for reduced motion.
   * `slide` / `hold` force one (the gallery shows both).
   */
  mode?: 'auto' | 'slide' | 'hold';
  /** Low-risk actions (going online): a plain tap also confirms; the slide still works. */
  tapToConfirm?: boolean;
  /** Haptic at 100 %; `selection` ticks play at 25/50/75 %. */
  confirmHaptic?: HapticKind | false;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Slide to confirm (partner P-08): a 72 px track with a 60 px thumb that the driver drags in the
 * reading direction (right → left in Arabic) to commit something that can't be taken back by a
 * pocket tap: picked up, delivered, ride ended, departed, arrived.
 *
 * - Release past 85 % (or flick forward from half way) confirms; anything short springs back.
 * - `selection` haptic ticks at 25/50/75 %, `success` at 100 %.
 * - Reduced motion: becomes press-and-hold for 0.9 s with a fill (no drag needed).
 * - Screen readers and keyboards: one button whose "activate" (double tap, Enter, Space) confirms,
 *   so the slide is never the only way in.
 * - A tap on the thumb nudges it and says "اسحب للآخر" unless `tapToConfirm`.
 */
export function SlideToConfirm({
  label,
  onConfirm,
  icon = 'arrow-forward',
  tone = 'accent',
  loading = false,
  disabled = false,
  note,
  mode = 'auto',
  tapToConfirm = false,
  confirmHaptic = 'success',
  accessibilityHint,
  style,
  testID = 'slide-to-confirm',
}: SlideToConfirmProps) {
  const theme = useTheme();
  const kind = slideMode(mode, theme.reduceMotion);
  const rtl = theme.isRTL;
  const [width, setWidth] = useState(0);
  const travel = slideTravel(width);
  const progress = useSharedValue(0);
  const startProgress = useSharedValue(0);
  const [confirmed, setConfirmed] = useState(false);
  const [holding, setHolding] = useState(false);
  const [nudged, setNudged] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasLoading = useRef(false);
  /** Set synchronously so a key press and a press-in in the same tick confirm once. */
  const done = useRef(false);
  const inactive = disabled || loading || confirmed;

  const quiet = tone === 'quiet';
  const bg = tone === 'danger' ? theme.colors.danger : quiet ? theme.colors.surface : theme.colors.accent;
  const fg = tone === 'danger' ? 'onDanger' : quiet ? 'text' : 'onAccent';

  const reset = useCallback(() => {
    done.current = false;
    setConfirmed(false);
    setHolding(false);
    progress.value = theme.reduceMotion ? 0 : withSpring(0, theme.motion.spring.press);
  }, [progress, theme.reduceMotion, theme.motion.spring.press]);

  const confirm = useCallback(() => {
    if (disabled || loading || done.current) return;
    done.current = true;
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setConfirmed(true);
    setHolding(false);
    progress.value = theme.reduceMotion ? 1 : withTiming(1, { duration: theme.motion.duration.fast });
    if (confirmHaptic) theme.haptic(confirmHaptic);
    onConfirm();
  }, [disabled, loading, progress, theme, confirmHaptic, onConfirm]);

  // After confirming: stay at the end while the action runs, then come back (an error, or the same
  // slider reused for the next step). Without a `loading` round-trip, come back after a beat.
  useEffect(() => {
    if (loading) {
      wasLoading.current = true;
      return;
    }
    if (!confirmed) return;
    const id = setTimeout(reset, wasLoading.current ? 250 : 1200);
    wasLoading.current = false;
    return () => clearTimeout(id);
  }, [confirmed, loading, reset]);

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  const tick = useCallback(() => theme.haptic('selection'), [theme]);
  const nudge = useCallback(() => {
    setNudged(true);
    theme.haptic('light');
    if (!theme.reduceMotion) {
      progress.value = withSequence(withTiming(0.12, { duration: theme.motion.duration.fast }), withSpring(0, theme.motion.spring.press));
    }
  }, [progress, theme]);

  // ── Slide ──────────────────────────────────────────────────────────────────
  const pan = Gesture.Pan()
    .enabled(kind === 'slide' && !inactive && travel > 0)
    .activeOffsetX([-6, 6])
    .onStart(() => {
      startProgress.value = progress.value;
    })
    .onUpdate((e) => {
      const next = Math.min(1, Math.max(0, startProgress.value + slideProgress(e.translationX, travel, rtl)));
      if (slideTickCrossed(progress.value, next) >= 0) runOnJS(tick)();
      progress.value = next;
    })
    .onEnd((e) => {
      if (slideRelease(progress.value, e.velocityX, rtl) === 'confirm') runOnJS(confirm)();
      else progress.value = withSpring(0, theme.motion.spring.press);
    });
  const tap = Gesture.Tap()
    .enabled(kind === 'slide' && !inactive)
    .onEnd(() => {
      runOnJS(tapToConfirm ? confirm : nudge)();
    });
  const gesture = Gesture.Exclusive(pan, tap);

  // ── Hold (reduced motion) ──────────────────────────────────────────────────
  const startHold = () => {
    if (inactive || done.current) return;
    setHolding(true);
    theme.haptic('light');
    progress.value = withTiming(1, { duration: SLIDE_HOLD_MS, easing: Easing.linear });
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      confirm();
    }, SLIDE_HOLD_MS);
  };
  const endHold = () => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
      setHolding(false);
      cancelAnimation(progress);
      progress.value = withTiming(0, { duration: theme.motion.duration.fast });
    }
  };

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: slideOffset(progress.value, travel, rtl) }] }), [travel, rtl]);
  // The wash runs from the start edge to the thumb's centre, so the thumb hides its end; it fades in
  // with the first few pixels of travel so the resting track is clean.
  const fillStyle = useAnimatedStyle(
    () =>
      kind === 'hold'
        ? { width: `${progress.value * 100}%`, opacity: 1 }
        : { width: SLIDE_INSET + SLIDE_THUMB_SIZE / 2 + progress.value * travel, opacity: Math.min(1, progress.value * 6) },
    [travel, kind],
  );
  const labelStyle = useAnimatedStyle(() => ({ opacity: kind === 'hold' ? 1 : slideLabelOpacity(progress.value) }), [kind]);

  const shownLabel = kind === 'hold' ? (holding ? t('ui.slide_holding') : label) : label;
  const hint = accessibilityHint ?? (kind === 'hold' ? t('ui.slide_hold_hint') : t('ui.slide_hint'));
  // Under the label: "اسحب للآخر" after a stray tap, the caller's note, or — holding being invisible
  // as an affordance — "اضغط وثبّت حتى تأكد" in the reduced-motion mode.
  const subline = nudged && kind === 'slide' && !tapToConfirm ? t('ui.slide_nudge') : (note ?? (kind === 'hold' && !tapToConfirm && !holding ? t('ui.slide_hold_hint') : undefined));

  const body = (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={{
        height: SLIDE_TRACK_HEIGHT,
        borderRadius: theme.radius.pill,
        backgroundColor: bg,
        ...(quiet ? { borderWidth: 2, borderColor: theme.colors.borderStrong } : null),
        justifyContent: 'center',
        overflow: 'hidden',
        opacity: disabled ? theme.state.disabledOpacity : 1,
      }}
    >
      {/* What is already covered: a darker wash from the start edge to the thumb. */}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, start: 0, backgroundColor: withAlpha(theme.colors.text, 0.12), borderRadius: theme.radius.pill }, fillStyle]} />
      <Animated.View pointerEvents="none" style={[{ alignItems: 'center', paddingHorizontal: SLIDE_THUMB_SIZE + SLIDE_INSET * 2 }, labelStyle]}>
        <Text variant="button" weight={700} color={fg} numberOfLines={1} testID={`${testID}-label`}>
          {shownLabel}
        </Text>
        {subline ? (
          <Text variant="caption" weight={600} color={fg} numberOfLines={1} style={{ opacity: 0.85 }}>
            {subline}
          </Text>
        ) : null}
      </Animated.View>
      {kind === 'slide' ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              start: SLIDE_INSET,
              width: SLIDE_THUMB_SIZE,
              height: SLIDE_THUMB_SIZE,
              borderRadius: SLIDE_THUMB_SIZE / 2,
              backgroundColor: quiet ? theme.colors.text : theme.colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: theme.colors.shadow,
              shadowOpacity: 0.14,
              shadowRadius: 4,
              shadowOffset: { width: 0, height: 2 },
              elevation: 3,
            },
            thumbStyle,
          ]}
        >
          {loading || confirmed ? (
            loading ? (
              <ActivityIndicator color={quiet ? theme.colors.bg : bg} />
            ) : (
              <Icon name="check" size={28} color={tone === 'danger' ? 'dangerText' : quiet ? 'bg' : 'accentText'} strokeWidth={2.6} />
            )
          ) : (
            <Icon name={icon} size={28} color={quiet ? 'bg' : 'text'} strokeWidth={2.4} />
          )}
        </Animated.View>
      ) : loading ? (
        <View pointerEvents="none" style={{ position: 'absolute', end: theme.space[5] }}>
          <ActivityIndicator color={theme.colors[fg]} />
        </View>
      ) : null}
    </View>
  );

  const a11y = {
    testID,
    accessible: true,
    accessibilityRole: 'button' as const,
    accessibilityLabel: label,
    accessibilityHint: hint,
    accessibilityState: { disabled: disabled || loading, busy: loading },
    'aria-disabled': disabled || loading,
    'aria-busy': loading,
    accessibilityActions: [{ name: 'activate' as const, label }],
    onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
      if (e.nativeEvent.actionName === 'activate') confirm();
    },
    // Web keyboards: Enter or Space confirms (a deliberate key press, never a stray click).
    focusable: !inactive,
    onKeyDown: (e: { nativeEvent: { key?: string }; preventDefault?: () => void }) => {
      const key = e.nativeEvent.key;
      if (key === 'Enter' || key === ' ') {
        e.preventDefault?.();
        confirm();
      }
    },
  };

  if (kind === 'hold') {
    return (
      <Pressable {...a11y} disabled={inactive} onPressIn={startHold} onPressOut={endHold} onPress={tapToConfirm ? confirm : undefined} style={style}>
        {body}
      </Pressable>
    );
  }
  return (
    <View {...(a11y as object)} style={style}>
      <GestureDetector gesture={gesture}>{body}</GestureDetector>
    </View>
  );
}
