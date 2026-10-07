import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { t } from '@driver/i18n';
import { resolveSnaps, snapTarget } from '../logic/sheet';
import { useTheme } from '../theme/ThemeProvider';

export interface SheetProps {
  /** Detents as visible heights: px (> 1) or fractions of the container (≤ 1). E.g. [140, 0.55, 0.9]. */
  snapPoints: readonly number[];
  /** Index into the sorted detents to open at. */
  initialSnap?: number;
  onSnap?: (index: number) => void;
  /** Pinned above the scrolling body; collapsed state shows only this (status + ETA). */
  header?: ReactNode;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Draggable bottom sheet for the live order/ride screen (map 60% + sheet). Positioned against
 * its parent, so put it inside the screen's root view over the map. Needs a
 * GestureHandlerRootView at the app root.
 */
export function Sheet({ snapPoints, initialSnap = 0, onSnap, header, children, style, testID }: SheetProps) {
  const theme = useTheme();
  const [containerH, setContainerH] = useState(0);
  const snaps = useMemo(() => resolveSnaps(snapPoints, containerH || 800), [snapPoints, containerH]);
  const maxH = snaps[snaps.length - 1] ?? 0;
  const visible = useSharedValue(snaps[initialSnap] ?? snaps[0] ?? 0);
  const start = useSharedValue(0);
  const [index, setIndex] = useState(initialSnap);

  // Re-seat on first layout (fractional detents resolve only once the container is measured).
  const seat = snaps[index] ?? snaps[0] ?? 0;
  useEffect(() => {
    visible.value = seat;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerH]);
  // The detent it rests on grew or shrank (content joined the collapsed header): follow it.
  useEffect(() => {
    visible.value = theme.reduceMotion ? seat : withSpring(seat, theme.motion.spring.sheet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seat]);

  const settle = useCallback(
    (i: number) => {
      setIndex(i);
      onSnap?.(i);
      theme.haptic('selection');
    },
    [onSnap, theme],
  );

  const goTo = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(snaps.length - 1, i));
      visible.value = theme.reduceMotion ? snaps[clamped]! : withSpring(snaps[clamped]!, theme.motion.spring.sheet);
      settle(clamped);
    },
    [snaps, visible, theme, settle],
  );

  const spring = theme.motion.spring.sheet;
  const lo = snaps[0] ?? 0;
  const pan = Gesture.Pan()
    .activeOffsetY([-8, 8])
    .onStart(() => {
      start.value = visible.value;
    })
    .onUpdate((e) => {
      const next = start.value - e.translationY;
      // Rubber-band past the ends instead of a hard stop.
      visible.value = next > maxH ? maxH + (next - maxH) * 0.2 : next < lo ? lo - (lo - next) * 0.2 : next;
    })
    .onEnd((e) => {
      const target = snapTarget(visible.value, e.velocityY, snaps);
      visible.value = withSpring(target, spring);
      runOnJS(settle)(snaps.indexOf(target));
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: maxH - visible.value }] }));

  return (
    <View
      pointerEvents="box-none"
      style={StyleSheet.absoluteFill}
      onLayout={(e: LayoutChangeEvent) => setContainerH(e.nativeEvent.layout.height)}
    >
      <GestureDetector gesture={pan}>
        <Animated.View
          testID={testID}
          style={[
            {
              position: 'absolute',
              start: 0,
              end: 0,
              // 40 px of overscroll lives below the container edge, revealed only by rubber-banding.
              bottom: -40,
              height: maxH + 40,
              paddingBottom: 40,
              backgroundColor: theme.colors.surfaceRaised,
              borderTopStartRadius: theme.radius['2xl'],
              borderTopEndRadius: theme.radius['2xl'],
              shadowColor: theme.colors.shadow,
              shadowOpacity: theme.elevation[3].shadowOpacity,
              shadowRadius: theme.elevation[3].shadowRadius,
              shadowOffset: { width: 0, height: -4 },
              elevation: theme.elevation[3].elevation,
              overflow: 'hidden',
            },
            sheetStyle,
            style,
          ]}
        >
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel={t('ui.sheet_handle')}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => goTo(index + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
            onPress={() => goTo(index === snaps.length - 1 ? 0 : index + 1)}
            style={{ alignItems: 'center', paddingTop: theme.space[2], paddingBottom: theme.space[1], minHeight: 24 }}
          >
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.border }} />
          </Pressable>
          {header ? <View style={{ paddingHorizontal: theme.space[5], paddingBottom: theme.space[3] }}>{header}</View> : null}
          <View style={{ flex: 1, paddingHorizontal: theme.space[5] }}>{children}</View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
