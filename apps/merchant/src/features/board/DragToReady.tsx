import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Icon, Text, useTheme } from '@driver/ui';
import { COUNTER } from '@/lib/counter';
import { useT } from '@/lib/i18n';

/** How far (share of the ticket's width) a ticket must travel toward «ينتظر الدليفري» to count. */
export const DRAG_READY_SHARE = 0.4;

/**
 * o9 · on the tablet a cooking ticket slides toward «ينتظر الدليفري» as well as tapping «صار جاهز».
 * The ticket follows the finger sideways only (a vertical move scrolls the lane as before); behind it
 * a green «صار جاهز» shows how far it has gone. Let go past 40 % of its width (or flick it) and it is
 * marked ready; short of that it springs back. If marking it fails, it springs back too.
 */
export function DragToReady({ children, enabled, onReady, testID }: { children: ReactNode; enabled: boolean; onReady: () => Promise<boolean>; testID: string }) {
  const theme = useTheme();
  const t = useT();
  // The ready lane sits after the cooking lane: to the left in Arabic, to the right in English.
  const dir = theme.isRTL ? -1 : 1;
  const x = useSharedValue(0);
  const width = useSharedValue(1);
  const done = useSharedValue(false);

  useEffect(() => {
    if (!enabled) x.value = 0;
  }, [enabled, x]);

  const drop = async () => {
    const ok = await onReady();
    if (!ok) {
      done.value = false;
      x.value = withSpring(0, { damping: 18 });
    }
  };

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      if (done.value) return;
      const toward = e.translationX * dir;
      // Toward the ready lane it follows the finger; the other way it barely gives.
      x.value = (toward > 0 ? toward : toward * 0.15) * dir;
    })
    .onEnd((e) => {
      if (done.value) return;
      const toward = x.value * dir;
      const flick = e.velocityX * dir > 900 && toward > 40;
      if (toward > width.value * DRAG_READY_SHARE || flick) {
        done.value = true;
        x.value = withTiming(width.value * 0.55 * dir, { duration: 140 });
        runOnJS(drop)();
      } else {
        x.value = withSpring(0, { damping: 18 });
      }
    });

  const card = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const under = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.abs(x.value) / (width.value * DRAG_READY_SHARE)) }));

  if (!enabled) return <>{children}</>;
  return (
    <View testID={testID} onLayout={(e) => (width.value = Math.max(1, e.nativeEvent.layout.width))}>
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, borderRadius: theme.radius.xl, backgroundColor: COUNTER.ready, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: theme.space[2], paddingHorizontal: theme.space[5] },
          under,
        ]}
      >
        <Icon name="check" size={26} color={COUNTER.onDate} strokeWidth={2.6} />
        <Text weight={700} style={[theme.face('display'), { color: COUNTER.onDate, fontSize: 20, lineHeight: 28 }]}>
          {t('merchant.card.mark_ready')}
        </Text>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={card}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
