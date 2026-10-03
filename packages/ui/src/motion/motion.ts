import { useCallback, useEffect } from 'react';
import { Pressable } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';

export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Press-in scale with a quick, wobble-free spring (`motion.spring.press`). */
export function usePressScale(scaleTo?: number) {
  const { motion, reduceMotion } = useTheme();
  const target = scaleTo ?? motion.pressScale;
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const onPressIn = useCallback(() => {
    if (!reduceMotion) scale.value = withSpring(target, motion.spring.press);
  }, [reduceMotion, scale, target, motion.spring.press]);
  const onPressOut = useCallback(() => {
    scale.value = withSpring(1, motion.spring.press);
  }, [scale, motion.spring.press]);
  return { style, onPressIn, onPressOut };
}

/** A one-shot spring "pop" when `active` flips on (chip/seat select). */
export function useSelectSpring(active: boolean) {
  const { motion, reduceMotion } = useTheme();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (!active || reduceMotion) return;
    scale.value = withSequence(withTiming(0.92, { duration: motion.duration.instant }), withSpring(1, motion.spring.select));
  }, [active, reduceMotion, scale, motion]);
  return useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
}

/** Expanding, fading ring behind a "live" dot (timeline current step, live status pill). */
export function usePulse(active = true) {
  const { motion, reduceMotion } = useTheme();
  const p = useSharedValue(0);
  useEffect(() => {
    if (!active || reduceMotion) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    p.value = withRepeat(withTiming(1, { duration: motion.duration.pulse, easing: Easing.out(Easing.quad) }), -1, false);
    return () => cancelAnimation(p);
  }, [active, reduceMotion, p, motion.duration.pulse]);
  return useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - p.value),
    transform: [{ scale: 1 + p.value * 1.4 }],
  }));
}
