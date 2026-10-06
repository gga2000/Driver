import { useEffect, useRef, type RefObject } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { AnimatedPressable, Icon, Text, useCountUp, usePressScale, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { FoodArt } from './FoodArt';
import type { FlyArt } from './FlyToCart';

const THUMB = 28;

export interface CartBarProps {
  count: number;
  totalIqd: number;
  onPress: () => void;
  /** The newest dishes (≤ 3, newest first): a small overlapping stack on the bar. */
  thumbs?: FlyArt[];
  /** The count bubble: where a flying dish lands (`FlyToCart`). */
  bubbleRef?: RefObject<View>;
  /** Changes when a dish lands: the bubble ticks. */
  pulseKey?: number;
}

/**
 * The floating "شوف السلة · total" bar over the menu, alive (joy o1): the count bubble ticks when a
 * dish lands (1 → 1.18 → 1), the total rolls to its new figure, and the newest dishes sit in a small
 * stack. It announces each add to screen readers, so the menu needs no "added" toast while it shows.
 */
export function CartBar({ count, totalIqd, onPress, thumbs = [], bubbleRef, pulseKey = 0 }: CartBarProps) {
  const theme = useTheme();
  const t = useT();
  const press = usePressScale(0.97);
  const total = useCountUp(totalIqd);
  const bump = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (theme.reduceMotion) return;
    bump.value = withSequence(withTiming(1.18, { duration: theme.motion.duration.instant }), withSpring(1, theme.motion.spring.hop));
  }, [pulseKey, bump, theme.reduceMotion, theme.motion]);
  const bubbleStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));
  return (
    <AnimatedPressable
      testID="cart-bar"
      accessibilityRole="button"
      accessibilityLabel={t('restaurant.view_cart_count', { n: count, amount: amountParam(totalIqd) })}
      accessibilityLiveRegion="polite"
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => {
        theme.haptic('light');
        onPress();
      }}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          minHeight: 58,
          paddingHorizontal: theme.space[4],
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.accent,
          shadowColor: theme.colors.shadow,
          shadowOpacity: theme.elevation[3].shadowOpacity,
          shadowRadius: theme.elevation[3].shadowRadius,
          shadowOffset: theme.elevation[3].shadowOffset,
          elevation: theme.elevation[3].elevation,
        },
        press.style,
      ]}
    >
      <View ref={bubbleRef} collapsable={false}>
        <Animated.View
          testID="cart-bar-count"
          style={[{ minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 8, backgroundColor: theme.colors.onAccent, alignItems: 'center', justifyContent: 'center' }, bubbleStyle]}
        >
          <Text variant="label" weight={700} color="accent" tabular>
            {count}
          </Text>
        </Animated.View>
      </View>
      <Text variant="button" color="onAccent" style={{ flex: 1 }} numberOfLines={1}>
        {t('restaurant.view_cart', { amount: amountParam(total) })}
      </Text>
      {thumbs.length > 0 ? (
        <View style={{ flexDirection: 'row' }} testID="cart-bar-thumbs">
          {thumbs.map((a, i) => (
            <View
              key={`${a.motif}-${a.look}-${i}`}
              style={{
                width: THUMB,
                height: THUMB,
                borderRadius: THUMB / 2,
                overflow: 'hidden',
                borderWidth: 2,
                borderColor: theme.colors.accent,
                marginStart: i === 0 ? 0 : -10,
                zIndex: thumbs.length - i,
              }}
            >
              <FoodArt motif={a.motif} look={a.look} photoUrl={a.photoUrl} />
            </View>
          ))}
        </View>
      ) : null}
      <Icon name="chevron-forward" size={20} color="onAccent" strokeWidth={2.2} />
    </AnimatedPressable>
  );
}
