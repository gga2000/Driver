import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Platform, RefreshControl, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { TeaGlass, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { pullDistance, PULL_AT, PULL_HOLD } from './pull';

/** iOS pulls with its own bounce (the native control, its spinner hidden); Android and the web with ours. */
const NATIVE_PULL = Platform.OS === 'ios';
const GLASS_H = 52;
/** The gap's window, taller than a pull gets (the page holds at 64; even a hard iOS bounce stays under this). */
const WELL_H = 320;

export interface TeaPullScrollProps {
  children: ReactNode;
  scrollRef: RefObject<Animated.ScrollView | null>;
  /** The page's scroll offset, for the folding header and the floating dish. */
  scrollY: SharedValue<number>;
  refreshing: boolean;
  onRefresh: () => void;
  contentStyle: StyleProp<ViewStyle>;
}

/**
 * Home's scroll view with the tea pull to refresh (Ali's Yes, effects menu "tea", 2026-10-07): pull
 * the page down from the top and an istikan in the gap fills with tea as far as you pulled; past the
 * line the phone ticks, and letting go there refreshes the page while the full glass steams. On iOS
 * the system pull does the physics (the gap is the bounce); on Android and the web a pan from the
 * very top pulls the page with a rubber band and holds it open while the refresh runs.
 */
export function TeaPullScroll({
  children,
  scrollRef,
  scrollY,
  refreshing,
  onRefresh,
  contentStyle,
}: TeaPullScrollProps) {
  const theme = useTheme();
  const t = useT();
  const pull = useSharedValue(0);
  const busy = useSharedValue(false);
  const armed = useSharedValue(false);
  const start = useSharedValue({ x: 0, y: 0 });
  const spring = theme.motion.spring.sheet;
  const reduce = theme.reduceMotion;

  useEffect(() => {
    busy.value = refreshing;
    // Done: the page settles back and the glass drains as the gap closes.
    if (!refreshing && !NATIVE_PULL)
      pull.value = reduce
        ? withTiming(0, { duration: theme.motion.duration.fast })
        : withSpring(0, spring);
  }, [refreshing, busy, pull, reduce, spring, theme.motion.duration.fast]);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  // The web sends a click when the mouse is let go after a pull: swallow that one, so the tile under
  // the pointer doesn't open (on a phone the pull taking over cancels the touch by itself).
  const swallow = useRef<((e: Event) => void) | null>(null);
  const guardClicks = useCallback(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || swallow.current) return;
    const stop = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };
    swallow.current = stop;
    window.addEventListener('click', stop, true);
  }, []);
  const releaseClicks = useCallback(() => {
    const stop = swallow.current;
    if (!stop) return;
    setTimeout(() => {
      window.removeEventListener('click', stop, true);
      if (swallow.current === stop) swallow.current = null;
    }, 250);
  }, []);

  const tick = () => theme.haptic('light');
  const begin = () => {
    theme.haptic('selection');
    onRefresh();
  };

  // Our pull: only from the very top, only downwards, never while a refresh runs or a rail is swiped.
  const pan = Gesture.Pan()
    .enabled(!NATIVE_PULL)
    .manualActivation(true)
    .onTouchesDown((e) => {
      const p = e.allTouches[0];
      if (p) start.value = { x: p.absoluteX, y: p.absoluteY };
    })
    .onTouchesMove((e, state) => {
      const p = e.allTouches[0];
      if (!p) return;
      const dx = p.absoluteX - start.value.x;
      const dy = p.absoluteY - start.value.y;
      if (busy.value || scrollY.value > 1 || dy < -6 || Math.abs(dx) > 14) state.fail();
      else if (dy > 10 && dy > Math.abs(dx) * 1.5) state.activate();
    })
    .onStart(() => {
      runOnJS(guardClicks)();
    })
    .onUpdate((e) => {
      pull.value = pullDistance(e.translationY);
      const past = pull.value >= PULL_AT;
      if (past !== armed.value) {
        armed.value = past;
        if (past) runOnJS(tick)();
      }
    })
    .onEnd(() => {
      if (armed.value) {
        busy.value = true;
        pull.value = withSpring(PULL_HOLD, spring);
        runOnJS(begin)();
      } else {
        pull.value = withSpring(0, spring);
      }
      armed.value = false;
    })
    .onFinalize(() => {
      runOnJS(releaseClicks)();
    });

  // The gap above the page: our pull, or the iOS bounce (a negative offset).
  const gap = useDerivedValue(() => (NATIVE_PULL ? Math.max(0, -scrollY.value) : pull.value));
  const level = useDerivedValue(() => (busy.value ? 1 : Math.min(1, gap.value / PULL_AT)));
  // iOS: the same tick when the bounce reaches the line (the system control has none).
  useAnimatedReaction(
    () => NATIVE_PULL && !busy.value && gap.value >= PULL_AT,
    (past, was) => {
      if (past && was === false) runOnJS(tick)();
    },
  );
  const page = useAnimatedStyle(() => ({
    transform: [{ translateY: NATIVE_PULL ? 0 : pull.value }],
  }));
  // The gap is a window slid down so it ends where the page starts (speed audit m2, 2026-10-07: sliding
  // costs nothing, resizing it laid the top out again on every frame of the pull); the glass inside is
  // slid back by the same, so it sits in the middle of the gap, and the window hides what the gap
  // cannot hold yet.
  const well = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.min(gap.value, WELL_H) - WELL_H }],
    opacity: busy.value ? 1 : Math.min(1, gap.value / 24),
  }));
  // The glass grows with the gap, so it always fits whole: small at first, full size by the line.
  const glass = useAnimatedStyle(() => ({
    transform: [
      { translateY: WELL_H - (Math.min(gap.value, WELL_H) + GLASS_H) / 2 },
      { scale: Math.max(0.35, Math.min(1, (gap.value - 8) / GLASS_H)) },
    ],
  }));

  return (
    <View style={{ flex: 1 }}>
      {/* Fixed at the top, so nothing shows above the page's own top edge. */}
      <View
        pointerEvents="none"
        accessibilityLiveRegion="polite"
        accessibilityLabel={refreshing ? t('status.refreshing') : undefined}
        style={{
          position: 'absolute',
          top: 0,
          start: 0,
          end: 0,
          height: WELL_H,
          overflow: 'hidden',
        }}
        testID="home-tea"
      >
        <Animated.View style={[{ height: WELL_H, alignItems: 'center', overflow: 'hidden' }, well]}>
          <Animated.View style={[{ height: GLASS_H }, glass]}>
            <TeaGlass level={level} steaming={refreshing} height={GLASS_H} />
          </Animated.View>
        </Animated.View>
      </View>
      <GestureDetector gesture={pan} touchAction="pan-y">
        <Animated.View style={[{ flex: 1 }, page]}>
          <Animated.ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            onScroll={onScroll}
            scrollEventThrottle={16}
            // Android's stretch would fight our rubber band at the top.
            overScrollMode="never"
            refreshControl={
              NATIVE_PULL ? (
                <RefreshControl refreshing={refreshing} onRefresh={begin} tintColor="transparent" />
              ) : undefined
            }
            contentContainerStyle={contentStyle}
          >
            {children}
          </Animated.ScrollView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
