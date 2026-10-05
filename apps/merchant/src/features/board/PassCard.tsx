import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import type { BoardOrder } from '@driver/contracts';
import { Button, Icon, PlateChip, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { clock12 } from '@/lib/time';
import { OrderItems, PaymentPill } from './OrderCard';
import type { PassState } from './pass';

export interface PassCardProps {
  order: BoardOrder;
  pass: PassState;
  onHandOver: () => void;
  onOpen: () => void;
  busy?: boolean;
}

/**
 * S-M4 · the courier at the pass. The ready card turns green from edge to edge the moment its courier
 * reaches the counter — "حيدر وصل · سلّمه #7046", his plate, the cash he collects — and amber after 3
 * minutes ("حيدر ينتظر من 4 دقايق"). One button, "سلّمته", records the hand-over; the card then says
 * when, until his own app confirms the pickup and the order leaves the board.
 */
export function PassCard({ order, pass, onHandOver, onOpen, busy = false }: PassCardProps) {
  const theme = useTheme();
  const t = useT();
  const who = pass.name ?? t('merchant.pass.courier');
  // The moment it turns: one soft swell (the clock's event, not decoration); none with reduce motion.
  const swell = useSharedValue(0);
  const turned = pass.kind === 'at_pass' ? pass.tone : 'handed';
  useEffect(() => {
    if (theme.reduceMotion) return;
    swell.value = withSequence(withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 260, easing: Easing.in(Easing.quad) }));
  }, [turned, theme.reduceMotion, swell]);
  const swellStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + swell.value * 0.015 }] }));

  if (pass.kind === 'handed') {
    return (
      <Pressable
        testID={`order-${order.number}`}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={t('merchant.pass.handed_a11y', { number: order.number, who, time: clock12(pass.at) })}
        style={({ pressed }) => ({ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.borderStrong, padding: theme.space[4], gap: theme.space[2], opacity: pressed ? 0.96 : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.successTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={22} color="successText" strokeWidth={2.4} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight={700} tabular style={{ fontSize: 22, lineHeight: 30 }} testID={`handed-done-${order.number}`}>
              {t('merchant.pass.handed', { number: order.number, time: clock12(pass.at) })}
            </Text>
            <Text variant="footnote" color="textMuted">
              {t('merchant.pass.handed_hint', { who })}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  }

  const warn = pass.tone === 'warning';
  const fg = warn ? 'warningText' : 'successText';
  const duration = t('merchant.pass.minutes', { minutes: pass.waitedMin });
  return (
    <Animated.View testID={`order-${order.number}`} style={swellStyle}>
      <View
        testID={`pass-${order.number}`}
        accessibilityLiveRegion="polite"
        style={{
          backgroundColor: theme.colors[warn ? 'warningTint' : 'successTint'],
          borderRadius: theme.radius.xl,
          borderWidth: 2,
          borderColor: theme.colors[warn ? 'warning' : 'success'],
          padding: theme.space[4],
          gap: theme.space[3],
        }}
      >
        <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={t('merchant.detail.title', { number: order.number })} style={{ gap: theme.space[1] }}>
          <Text weight={700} tabular style={{ fontSize: 24, lineHeight: 34, color: theme.colors.text }} numberOfLines={2}>
            {warn ? t('merchant.pass.waiting', { who, duration }) : t('merchant.pass.headline', { who, number: order.number })}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="bike" size={20} color={fg} strokeWidth={2.2} />
            {warn ? (
              <Text weight={700} tabular color={fg} style={{ flex: 1, fontSize: 22, lineHeight: 30 }} numberOfLines={1}>
                {t('merchant.pass.hand_it', { number: order.number })}
              </Text>
            ) : (
              <Text variant="label" weight={700} color={fg} style={{ flex: 1 }} numberOfLines={1}>
                {pass.waitedMin < 1 ? t('merchant.pass.just_now') : t('merchant.pass.since', { duration })}
              </Text>
            )}
          </View>
        </Pressable>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space[2] }}>
          {pass.plate ? <PlateChip plate={pass.plate} accessibilityLabel={t('merchant.pass.plate')} size="lg" testID={`plate-${order.number}`} /> : null}
          <PaymentPill order={order} />
        </View>

        <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
          <OrderItems order={order} maxLines={4} />
        </View>

        <Button
          testID={`handed-${order.number}`}
          label={t('merchant.pass.hand_over')}
          icon="check"
          size="lg"
          fullWidth
          haptic="success"
          loading={busy}
          onPress={onHandOver}
          accessibilityHint={t('merchant.pass.hand_over_a11y', { number: order.number, who })}
        />
      </View>
    </Animated.View>
  );
}
