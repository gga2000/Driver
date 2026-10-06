import { router } from 'expo-router';
import { View } from 'react-native';
import type { Order } from '@driver/contracts';
import { cityParts, formatClock } from '@driver/i18n';
import { AnimatedPressable, Icon, Text, useNow, usePressScale, useTheme, withAlpha } from '@driver/ui';
import { liveEta } from '@/features/track/eta';
import { useTracking } from '@/features/track/queries';
import { useT } from '@/lib/i18n';
import { LIVE_SEGMENTS, liveStatusKey, liveStep } from './live-card';

/**
 * The order or ride in progress (spec §1), as the Istikan inverse card (joy S2-11, report 5 §5 A):
 * ink, a tea live dot, «مطعم خالد · دا يتحضّر», «طلبك يوصل» and the arrival time large in Alexandria
 * on the end side, then a 4-step bar. The time is the live estimate the tracking screen uses (kitchen
 * ready time + the ride to the door), else the promised time; none is shown until one is known.
 * Opens the live screen.
 */
export function ActiveOrderPill({ order }: { order: Order }) {
  const theme = useTheme();
  const t = useT();
  const press = usePressScale(0.985);
  const track = useTracking(order.id);
  const now = useNow(true, 30_000);
  const v = track.data;
  const isRide = order.type === 'ride';
  const eta = v ? (liveEta(v, null, new Date(now)) ?? v.promisedAt) : null;
  const status = t(liveStatusKey(order));
  const line = v?.merchant ? t('home.live_line', { name: v.merchant.name, status }) : status;
  const step = liveStep(order);
  const title = isRide ? t('home.active_trip') : eta ? t('home.live_arrives') : t('home.active_order');
  const c = theme.colors;
  return (
    <AnimatedPressable
      testID="home-active-order"
      accessibilityRole="button"
      accessibilityLabel={[title, line, eta ? formatClock(eta) : null].filter(Boolean).join('، ')}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => router.push({ pathname: '/order/[id]', params: { id: order.id } })}
      style={[{ backgroundColor: c.inverse, borderRadius: theme.radius.xl, padding: theme.space[4], gap: theme.space[3] }, press.style]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent, borderWidth: 2, borderColor: withAlpha(c.accent, 0.35) }} />
            <Text variant="footnote" weight={600} color="onInverseAccent" numberOfLines={1} style={{ flexShrink: 1 }} testID="home-active-line">
              {line}
            </Text>
          </View>
          <Text variant="title" weight={700} color="onInverse" numberOfLines={1}>
            {title}
          </Text>
        </View>
        {eta ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }} testID="home-active-eta">
            <Text variant="numeralHero" face="display" color="onInverse">
              {formatClock(eta, { period: false })}
            </Text>
            <Text variant="label" weight={600} color="onInverseMuted">
              {t(cityParts(eta).hour < 12 ? 'time.am' : 'time.pm')}
            </Text>
          </View>
        ) : (
          <Icon name="chevron-forward" size={20} color="onInverseMuted" />
        )}
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: LIVE_SEGMENTS, now: step }}
        style={{ flexDirection: 'row', gap: 4 }}
        testID="home-active-bar"
      >
        {Array.from({ length: LIVE_SEGMENTS }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < step ? c.accent : withAlpha(c.onInverseMuted, 0.3) }} />
        ))}
      </View>
    </AnimatedPressable>
  );
}
