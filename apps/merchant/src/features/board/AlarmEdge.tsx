import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '@driver/ui';
import { COUNTER } from '@/lib/counter';
import type { AlarmStage } from './ladder';

/**
 * a8 · the whole screen edge flashes in a noisy kitchen, so someone across the room sees a new order
 * even when the grill drowns the bell: saffron in the middle 30 s of the ring, red in the last 30 s.
 * Calm for the first 30 s (the chime is enough). With reduce motion on, the frame shows without
 * flashing. It never takes a tap: everything under it works as usual.
 */
export function AlarmEdge({ stage, wide }: { stage: AlarmStage | null; wide: boolean }) {
  const theme = useTheme();
  const on = stage === 'urgent' || stage === 'final';
  const p = useSharedValue(1);
  useEffect(() => {
    if (!on || theme.reduceMotion) {
      cancelAnimation(p);
      p.value = 1;
      return;
    }
    p.value = 0.25;
    p.value = withRepeat(withTiming(1, { duration: stage === 'final' ? 300 : 500, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(p);
  }, [on, stage, theme.reduceMotion, p]);
  const style = useAnimatedStyle(() => ({ opacity: p.value }));
  if (!on) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }}>
      <Animated.View
        testID={`alarm-edge-${stage}`}
        style={[{ flex: 1, borderWidth: wide ? 10 : 7, borderColor: stage === 'final' ? COUNTER.late : COUNTER.saffron }, style]}
      />
    </View>
  );
}
