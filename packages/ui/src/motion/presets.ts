import { useMemo } from 'react';
import { Easing, FadeIn, FadeInDown, SlideInDown, withSequence, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import { motion as motionTokens } from '@driver/design-tokens';
import { useTheme } from '../theme/ThemeProvider';

/**
 * Motion presets (joy spec §4, S2-16, L-19): the few ways things move in the apps, built once on the
 * motion tokens ("Pour & settle") so screens stop hand-tuning durations and springs. Every preset
 * honours reduced motion: the `entering` builders return `undefined` (the view simply appears) and
 * the value animations jump straight to their end value.
 *
 *  - `fadeIn`    a quiet appearance (text, a line that changed);
 *  - `panelIn`   a card or panel rises `distance.enter` and settles (spring `settle`);
 *  - `sheetIn`   a sheet slides up from the bottom edge (spring `sheet`);
 *  - `pop`       a celebration object scales in with one overshoot (spring `celebrate`);
 *  - `hop`       a value (translateY) jumps up and lands (spring `hop`) — dish to cart, a pin landing;
 *  - `digitRoll` a number moves to its new value in `duration.digitRoll`.
 */
export type MotionTokens = typeof motionTokens;

export interface PresetOptions {
  reduceMotion: boolean;
  /** Start after this many ms (use `staggerDelay` for lists). */
  delay?: number;
  motion?: MotionTokens;
}

export function fadeIn({ reduceMotion, delay = 0, motion = motionTokens }: PresetOptions) {
  if (reduceMotion) return undefined;
  return FadeIn.duration(motion.duration.base).delay(delay);
}

export function panelIn({ reduceMotion, delay = 0, motion = motionTokens }: PresetOptions) {
  if (reduceMotion) return undefined;
  const s = motion.spring.settle;
  // No `withInitialValues` here: on react-native-web it left entering views out of the layout flow
  // (they drew over the next section). The stock rise is close to `distance.enter`.
  return FadeInDown.springify().damping(s.damping).stiffness(s.stiffness).mass(s.mass).delay(delay);
}

export function sheetIn({ reduceMotion, delay = 0, motion = motionTokens }: PresetOptions) {
  if (reduceMotion) return undefined;
  const s = motion.spring.sheet;
  return SlideInDown.springify().damping(s.damping).stiffness(s.stiffness).mass(s.mass).delay(delay);
}

export function pop({ reduceMotion, delay = 0, motion = motionTokens }: PresetOptions) {
  if (reduceMotion) return undefined;
  const s = motion.spring.celebrate;
  return ZoomIn.springify().damping(s.damping).stiffness(s.stiffness).mass(s.mass).delay(delay);
}

/**
 * A hop for a translateY shared value: up by `height` (default twice `distance.enter`), then down
 * to 0 on the `hop` spring. Assign it: `y.value = hop({ reduceMotion })`. Reduced motion: 0.
 */
export function hop({ reduceMotion, motion = motionTokens, height }: Omit<PresetOptions, 'delay'> & { height?: number }) {
  if (reduceMotion) return 0;
  const up = -(height ?? motion.distance.enter * 2);
  return withSequence(withTiming(up, { duration: motion.duration.fast, easing: Easing.out(Easing.quad) }), withSpring(0, motion.spring.hop));
}

/** A number (shared value) moving to `to` in `duration.digitRoll`. Reduced motion: `to` at once. */
export function digitRoll(to: number, { reduceMotion, motion = motionTokens }: Omit<PresetOptions, 'delay'>) {
  if (reduceMotion) return to;
  const [x1, y1, x2, y2] = motion.bezier.standard;
  return withTiming(to, { duration: motion.duration.digitRoll, easing: Easing.bezier(x1, y1, x2, y2) });
}

/** List items enter one after another: at most the first three are staggered (`motion.stagger`). */
export function staggerDelay(index: number, motion: MotionTokens = motionTokens): number {
  return Math.min(Math.max(0, index), 2) * motion.stagger;
}

/** The presets bound to the current theme's tokens and reduced-motion setting. */
export function useMotionPresets() {
  const { motion, reduceMotion } = useTheme();
  return useMemo(
    () => ({
      reduceMotion,
      fadeIn: (delay = 0) => fadeIn({ reduceMotion, delay, motion }),
      panelIn: (delay = 0) => panelIn({ reduceMotion, delay, motion }),
      sheetIn: (delay = 0) => sheetIn({ reduceMotion, delay, motion }),
      pop: (delay = 0) => pop({ reduceMotion, delay, motion }),
      hop: (height?: number) => hop({ reduceMotion, motion, ...(height !== undefined ? { height } : {}) }),
      digitRoll: (to: number) => digitRoll(to, { reduceMotion, motion }),
      staggerDelay: (index: number) => staggerDelay(index, motion),
    }),
    [motion, reduceMotion],
  );
}
