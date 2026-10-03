import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FOOD_RATED_TYPES, type OrderTracking } from '@driver/contracts';
import { Button, Icon, ltr, Text, useCountUp, useTheme, useToast, withAlpha } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { BottomPanel } from './Panels';
import { useRateOrder } from './queries';

/**
 * The arrival moment (spec §4): a success haptic and a full-screen "وصل!" with the place photo
 * (placeholder until place photos ship), then the two-tap rating.
 */
export function ArrivalOverlay({
  view,
  onRate,
  onLater,
}: {
  view: OrderTracking;
  onRate: () => void;
  onLater: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const ride = view.order.type === 'ride';
  useEffect(() => {
    theme.haptic('success');
    // Once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View
      testID="arrival"
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(200)}
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: theme.colors.bg,
          paddingTop: insets.top + theme.space[10],
          paddingBottom: Math.max(insets.bottom, theme.space[6]),
          paddingHorizontal: theme.space[6],
        },
      ]}
    >
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          gap: theme.space[5],
          width: '100%',
          maxWidth: 480,
          alignSelf: 'center',
        }}
      >
        <Animated.View
          entering={ZoomIn.springify().damping(11)}
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: theme.colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: theme.colors.accent,
            shadowOpacity: 0.45,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
          }}
        >
          <Icon name="check" size={52} color="onAccent" strokeWidth={3} />
        </Animated.View>
        <View style={{ alignItems: 'center', gap: theme.space[1] }}>
          <Text
            variant="display"
            style={{ fontSize: 44, lineHeight: 64 }}
            accessibilityRole="header"
          >
            {t('track.arrived_title')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {ride
              ? t('track.arrived_ride')
              : t('track.arrived_food', { merchant: view.merchant?.name ?? '' })}
          </Text>
        </View>
        {/* Gate photo placeholder: the saved place's photo replaces it when places carry photos. A ride
            ends wherever the rider asked, not at a door: no door picture there. */}
        {ride ? null : (
          <View
            testID="arrival-photo"
            style={{
              width: '100%',
              flex: 1,
              maxHeight: 260,
              minHeight: 150,
              borderRadius: theme.radius.xl,
              backgroundColor: theme.colors.surfaceSunken,
              borderWidth: 1,
              borderColor: theme.colors.border,
              alignItems: 'center',
              justifyContent: 'center',
              gap: theme.space[2],
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: '38%',
                backgroundColor: withAlpha(theme.colors.borderStrong, 0.18),
              }}
            />
            <View
              style={{
                width: 76,
                height: 104,
                borderTopLeftRadius: 38,
                borderTopRightRadius: 38,
                borderWidth: 3,
                borderColor: theme.colors.borderStrong,
                backgroundColor: theme.colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  end: 12,
                  top: 56,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: theme.colors.accent,
                }}
              />
              <Icon name="home" size={30} color="borderStrong" />
            </View>
            <Text variant="caption" color="textMuted">
              {t('track.arrived_photo')}
            </Text>
          </View>
        )}
      </View>
      <View style={{ gap: theme.space[2], width: '100%', maxWidth: 480, alignSelf: 'center' }}>
        <Button
          label={t('track.arrived_continue')}
          icon="star"
          size="lg"
          fullWidth
          onPress={onRate}
          testID="arrival-rate"
        />
        <Button label={t('track.rate_later')} variant="ghost" fullWidth onPress={onLater} />
      </View>
    </Animated.View>
  );
}

function Stars({
  value,
  onPick,
  testID,
}: {
  value: number;
  onPick: (n: number) => void;
  testID: string;
}) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      style={{
        flexDirection: 'row',
        justifyContent: 'center',
        gap: theme.space[2],
        direction: 'ltr',
      }}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Pressable
          key={n}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === n }}
          accessibilityLabel={t('track.stars', { n })}
          testID={`${testID}-${n}`}
          onPress={() => {
            theme.haptic('selection');
            onPick(n);
          }}
          hitSlop={4}
          style={({ pressed }) => ({ padding: 4, transform: [{ scale: pressed ? 0.88 : 1 }] })}
        >
          <Icon
            name="star"
            size={44}
            color={n <= value ? 'accent' : 'borderStrong'}
            filled={n <= value}
            strokeWidth={1.6}
          />
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Two taps: the courier/driver, then the food (kitchen orders only). The second tap sends
 * `orders.rate`; then the points this order earned count up and fly into the wallet.
 */
export function RatingPanel({ view, onDone }: { view: OrderTracking; onDone: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const rate = useRateOrder(view.order.id);
  const food =
    (FOOD_RATED_TYPES as readonly string[]).includes(view.order.type) && view.merchant !== null;
  const total = food ? 2 : 1;
  const [step, setStep] = useState(view.order.rating ? total + 1 : 1);
  const [delivery, setDelivery] = useState(view.order.rating?.delivery ?? 0);
  const [foodScore, setFoodScore] = useState(view.order.rating?.food ?? 0);
  const name =
    view.courier?.firstName ??
    t(view.order.type === 'ride' ? 'track.driver_fallback' : 'track.courier_fallback');

  const submit = (d: number, f: number | null) =>
    rate.mutate(
      { orderId: view.order.id, delivery: d, ...(f ? { food: f } : {}) },
      {
        onSuccess: () => setStep(total + 1),
        onError: (e) =>
          toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' }),
      },
    );

  return (
    <BottomPanel onClose={step > total ? onDone : undefined} testID="rating-panel">
      {step <= total ? (
        <View style={{ alignItems: 'center', gap: theme.space[1] }}>
          <Text variant="caption" color="textMuted" tabular>
            {t('track.rate_step', { n: step, total })}
          </Text>
          <Text variant="heading" align="center">
            {step === 1
              ? t('track.rate_delivery_q', { name })
              : t('track.rate_food_q', { merchant: view.merchant?.name ?? '' })}
          </Text>
        </View>
      ) : null}
      {step === 1 ? (
        <Stars
          value={delivery}
          testID="stars-delivery"
          onPick={(n) => {
            setDelivery(n);
            if (food) setTimeout(() => setStep(2), 220);
            else submit(n, null);
          }}
        />
      ) : step === 2 && food ? (
        <Stars
          value={foodScore}
          testID="stars-food"
          onPick={(n) => {
            setFoodScore(n);
            submit(delivery, n);
          }}
        />
      ) : (
        <PointsEarned points={view.pointsEarned} />
      )}
      {step <= total ? (
        <Button
          label={t('track.rate_later')}
          variant="ghost"
          fullWidth
          onPress={onDone}
          disabled={rate.isPending}
          loading={rate.isPending}
        />
      ) : (
        <Button label={t('action.done')} fullWidth onPress={onDone} testID="rating-done" />
      )}
    </BottomPanel>
  );
}

/** "+42 نقطة" counting up, then a coin flying into the wallet icon. */
function PointsEarned({ points }: { points: number | null }) {
  const theme = useTheme();
  const t = useT();
  const [target, setTarget] = useState(0);
  const shown = useCountUp(target);
  const fly = useSharedValue(0);
  const pop = useSharedValue(1);
  useEffect(() => {
    if (!points) return;
    setTarget(points);
    fly.value = withDelay(700, withTiming(1, { duration: 650, easing: Easing.in(Easing.cubic) }));
    pop.value = withDelay(1300, withSequence(withSpring(1.25, { damping: 6 }), withSpring(1)));
    theme.haptic('success');
  }, [points, fly, pop, theme]);
  // The coin travels from the number to the wallet badge on the end side.
  const coin = useAnimatedStyle(() => ({
    opacity: fly.value === 0 || fly.value === 1 ? 0 : 1,
    transform: [
      { translateX: -110 * fly.value },
      { translateY: -10 * Math.sin(Math.PI * fly.value) * 4 },
      { scale: 1 - 0.4 * fly.value },
    ],
  }));
  const wallet = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <View
      testID="points-earned"
      style={{ alignItems: 'center', gap: theme.space[2], paddingVertical: theme.space[2] }}
    >
      <Text variant="title" align="center">
        {t('track.rate_thanks')}
      </Text>
      {points ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[4],
            direction: 'ltr',
          }}
        >
          <Animated.View
            style={[
              {
                width: 52,
                height: 52,
                borderRadius: 16,
                backgroundColor: theme.colors.accentTint,
                alignItems: 'center',
                justifyContent: 'center',
              },
              wallet,
            ]}
          >
            <Icon name="wallet" size={28} color="accentText" strokeWidth={2} />
          </Animated.View>
          <View style={{ alignItems: 'center' }}>
            <Animated.View
              style={[
                {
                  position: 'absolute',
                  top: 6,
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: theme.colors.accent,
                  borderWidth: 2,
                  borderColor: theme.colors.accentText,
                },
                coin,
              ]}
            />
            <Text variant="display" color="accentText" tabular testID="points-value">
              {ltr(`+${shown}`)}
            </Text>
            <Text variant="label" color="textMuted">
              {t('points.earned', { n: points })}
            </Text>
          </View>
        </View>
      ) : (
        <Text color="textMuted" align="center">
          {t('track.points_soon')}
        </Text>
      )}
      {points ? (
        <Text variant="caption" color="successText">
          {t('track.points_to_wallet')}
        </Text>
      ) : null}
    </View>
  );
}
