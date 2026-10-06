import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '@driver/ui';
import { FoodArt, type DishArt } from './FoodArt';
import { FLIGHT_MS, FLIGHT_TURN, flightPoint, flightScale } from './fly';

/** The flying dish is the menu thumbnail's size (`DishCard`). */
const SIZE = 96;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlyArt extends DishArt {
  photoUrl: string | null;
}

export interface FlyHandle {
  /** Flies `art` from `from` (window coordinates) into the target; lands right away under reduced motion. */
  fly(from: Rect, art: FlyArt): void;
}

/** Window rectangle of a mounted view (null when it is not laid out). */
export function measure(ref: RefObject<View | null>): Promise<Rect | null> {
  return new Promise((resolve) => {
    const node = ref.current;
    if (!node) return resolve(null);
    node.measureInWindow((x, y, width, height) => resolve(width || height ? { x, y, width, height } : null));
  });
}

/**
 * «لقمة تطير» (joy o1): one absolutely placed node over the screen that carries the dish's drawing from
 * its card to the cart bar's count bubble on a 420 ms arc, shrinking and turning slightly, then calls
 * `onLanded` (the bar ticks). Transforms and opacity only, no shadow in flight, one flight at a time
 * (a tap during a flight just ticks the bar). Under reduced motion nothing flies: it lands at once.
 */
export const FlyToCart = forwardRef<FlyHandle, { targetRef: RefObject<View | null>; onLanded: () => void }>(function FlyToCart({ targetRef, onLanded }, ref) {
  const theme = useTheme();
  const anchor = useRef<View>(null);
  const [art, setArt] = useState<FlyArt | null>(null);
  const busy = useRef(false);
  const t = useSharedValue(0);
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const visible = useSharedValue(0);

  const landed = useCallback(() => {
    visible.value = 0;
    setArt(null);
    busy.current = false;
    onLanded();
  }, [onLanded, visible]);

  const start = async (from: Rect, a: FlyArt) => {
    busy.current = true;
    // The first add mounts the cart bar in this same tap: let it lay out before measuring it.
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const [origin, target] = await Promise.all([measure(anchor), measure(targetRef)]);
    if (!origin || !target) {
      landed();
      return;
    }
    setArt(a);
    ox.value = origin.x;
    oy.value = origin.y;
    fx.value = from.x + from.width / 2;
    fy.value = from.y + from.height / 2;
    tx.value = target.x + target.width / 2;
    ty.value = target.y + target.height / 2;
    t.value = 0;
    visible.value = 1;
    t.value = withTiming(1, { duration: FLIGHT_MS, easing: Easing.out(Easing.cubic) }, (done) => {
      if (done) runOnJS(landed)();
    });
  };

  useImperativeHandle(ref, () => ({
    fly(from, a) {
      if (theme.reduceMotion) {
        onLanded();
        return;
      }
      if (busy.current) {
        // One dish in the air at a time: a quick second tap just ticks the bar.
        onLanded();
        return;
      }
      void start(from, a);
    },
  }));

  const style = useAnimatedStyle(() => {
    const p = flightPoint({ x: fx.value, y: fy.value }, { x: tx.value, y: ty.value }, t.value);
    return {
      opacity: visible.value,
      transform: [{ translateX: p.x - ox.value - SIZE / 2 }, { translateY: p.y - oy.value - SIZE / 2 }, { scale: flightScale(t.value) }, { rotate: `${FLIGHT_TURN * t.value}deg` }],
    };
  });

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {/* Same box as the flying node, so its measured origin is the node's own (start flips in RTL). */}
      <View ref={anchor} collapsable={false} style={{ position: 'absolute', top: 0, start: 0, width: SIZE, height: SIZE }} />
      <Animated.View style={[{ position: 'absolute', top: 0, start: 0, width: SIZE, height: SIZE, borderRadius: theme.radius.lg, overflow: 'hidden' }, style]}>
        {art ? <FoodArt motif={art.motif} look={art.look} photoUrl={art.photoUrl} /> : null}
      </Animated.View>
    </View>
  );
});
