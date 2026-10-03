import { useEffect, useState } from 'react';
import { Easing, runOnJS, useAnimatedReaction, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Animates a displayed integer toward `value` (price total count-up). The first render shows the
 * value as-is; only changes animate. Reduced motion jumps straight to the new value.
 */
export function useCountUp(value: number): number {
  const { motion, reduceMotion } = useTheme();
  const sv = useSharedValue(value);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (reduceMotion) {
      sv.value = value;
      setShown(value);
      return;
    }
    sv.value = withTiming(value, {
      duration: motion.duration.countUp,
      easing: Easing.bezier(...motion.bezier.decelerate),
    });
  }, [value, reduceMotion, sv, motion.duration.countUp, motion.bezier.decelerate]);

  useAnimatedReaction(
    () => Math.round(sv.value),
    (v, prev) => {
      if (v !== prev) runOnJS(setShown)(v);
    },
  );
  return shown;
}
