import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Icon, Text, useTheme } from '@driver/ui';
import { useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';

/** How far the coin travels to the wallet badge (px), and when (same rhythm as the points coin). */
const FLIGHT_PX = 150;

/**
 * "الخردة علينا" (customer d-1): the courier had no change and the rest of the note landed in the
 * wallet — "+7,250 دينار رصيد (الباقي)". A coin flies from the amount into the wallet badge, which
 * pops, with one success buzz (the points coin's motion); reduce motion shows the strip without the
 * flight. Announced to screen readers once.
 */
export function ChangeCreditStrip({ amountIqd, testID = 'change-credited' }: { amountIqd: number; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const api = useApi();
  const queryClient = useQueryClient();
  const fly = useSharedValue(theme.reduceMotion ? 1 : 0);
  const pop = useSharedValue(1);
  useEffect(() => {
    theme.haptic('success');
    // The wallet tab shows the new balance and the "باقي الكاش" line without a pull to refresh.
    void queryClient.invalidateQueries({ queryKey: api.wallet.balance.queryKey() });
    void queryClient.invalidateQueries({ queryKey: api.wallet.transactions.pathKey() });
    if (theme.reduceMotion) return;
    fly.value = withDelay(500, withTiming(1, { duration: 650, easing: Easing.in(Easing.cubic) }));
    pop.value = withDelay(1100, withSequence(withSpring(1.25, { damping: 6 }), withSpring(1)));
    // Once, when the credit lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The badge sits at the end; the coin starts over the amount (toward the start) and lands on it.
  const toStart = theme.isRTL ? 1 : -1;
  const coin = useAnimatedStyle(() => ({
    opacity: fly.value === 0 || fly.value === 1 ? (fly.value === 0 ? 1 : 0) : 1,
    transform: [{ translateX: toStart * FLIGHT_PX * (1 - fly.value) }, { translateY: -28 * Math.sin(Math.PI * fly.value) }, { scale: 1 - 0.35 * fly.value }],
  }));
  const badge = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <Animated.View
      testID={testID}
      entering={theme.reduceMotion ? undefined : FadeIn.duration(theme.motion.duration.base)}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={t('cashchange.credited_a11y', { amount: amountParam(amountIqd) })}
      style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.successTint }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="title" weight={700} color="successText" tabular testID={`${testID}-amount`}>
          {t('cashchange.credited', { amount: amountParam(amountIqd, { sign: true }) })}
        </Text>
        <Text variant="footnote" color="textMuted">
          {t('cashchange.credited_sub')}
        </Text>
      </View>
      <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ width: 52, height: 52, borderRadius: 16, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }, badge]}>
          <Icon name="wallet" size={28} color="successText" strokeWidth={2} />
        </Animated.View>
        {theme.reduceMotion ? null : (
          <Animated.View
            pointerEvents="none"
            style={[{ position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: theme.colors.accent, borderWidth: 2, borderColor: theme.colors.accentText }, coin]}
          />
        )}
      </View>
    </Animated.View>
  );
}

/** The receipt's line after the hand-off: "باقي الكاش (رصيد) +7,250 دينار" and what he paid. */
export function ChangeReceiptLine({ paidIqd, creditedIqd }: { paidIqd: number; creditedIqd: number }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  return (
    <View testID="receipt-change-to-wallet" style={{ gap: 2, padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: theme.colors.successTint }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="wallet" size={16} color="successText" strokeWidth={2.2} />
        <Text variant="label" weight={600} color="successText" style={{ flex: 1 }}>
          {t('cashchange.receipt_line')}
        </Text>
        <Text variant="label" weight={700} color="successText" tabular>
          {iqd(creditedIqd, { locale, sign: true })}
        </Text>
      </View>
      <Text variant="caption" color="textMuted" tabular>
        {t('cashchange.receipt_paid', { amount: amountParam(paidIqd) })}
      </Text>
    </View>
  );
}
