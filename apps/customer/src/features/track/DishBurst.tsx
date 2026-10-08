import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg from 'react-native-svg';
import { useTheme, type DishKind } from '@driver/ui';
import { DishDrawing } from '@driver/ui/dishes';
import { BURST_BITS, BURST_MS, burstAt, type BurstBit } from './dish-burst';

/** Each tiny dish is drawn this big (px). */
const BIT = 30;
/** The dishes that fly, one per bit: a bit of everything Aziziyah orders. */
const KINDS: readonly DishKind[] = ['kebab', 'tea', 'falafel', 'sweet', 'bread', 'juice', 'dolma', 'shawarma', 'kubba'];
/** The burst waits for the door drawing to land first (ms). */
const AFTER_MS = 260;

/**
 * The «بالعافية» burst (Ali's Yes, home effects "confetti", 2026-10-07): nine tiny dish drawings fly
 * out from the middle of «وصل طلبك» and fade, once, as the delivered moment opens. Only food has it, and the
 * delivered moment itself plays once per order on this phone (`useArrivalOnce`), so nothing else in
 * the app celebrates this way and it stays special. The caller leaves it out on a quiet day and
 * under reduced motion. It never takes a touch and is gone from the screen when it ends.
 */
export function DishBurst() {
  const theme = useTheme();
  const a = useSharedValue(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    a.value = withDelay(
      AFTER_MS,
      withTiming(1, { duration: BURST_MS, easing: Easing.linear }, (finished) => {
        if (finished) runOnJS(setDone)(true);
      }),
    );
  }, [a]);
  if (done) return null;
  const end = theme.isRTL ? -1 : 1;
  return (
    <View testID="arrival-burst" pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ position: 'absolute', top: '50%', start: '50%', width: 0, height: 0 }}>
      {BURST_BITS.map((bit, i) => (
        <Bit key={i} a={a} bit={bit} end={end} kind={KINDS[i % KINDS.length]!} look={i} />
      ))}
    </View>
  );
}

function Bit({ a, bit, end, kind, look }: { a: SharedValue<number>; bit: BurstBit; end: number; kind: DishKind; look: number }) {
  const style = useAnimatedStyle(() => {
    const p = burstAt(a.value, bit);
    return { opacity: p.opacity, transform: [{ translateX: end * p.x }, { translateY: p.y }, { rotate: `${p.rotate}deg` }, { scale: p.scale }] };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left: -BIT / 2, top: -BIT / 2, width: BIT, height: BIT, opacity: 0 }, style]}>
      <Svg width={BIT} height={BIT} viewBox="0 0 200 200">
        <DishDrawing kind={kind} look={look} line={8} window={false} />
      </Svg>
    </Animated.View>
  );
}
