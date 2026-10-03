import { router } from 'expo-router';
import { View } from 'react-native';
import type { Order } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Card, Icon, StatusPill, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/** Pinned pill for the order or ride in progress (spec §1). Opens the live screen. */
export function ActiveOrderPill({ order }: { order: Order }) {
  const theme = useTheme();
  const t = useT();
  const isRide = order.type === 'ride';
  return (
    <Card
      testID="home-active-order"
      tone="tint"
      padding={3}
      onPress={() => router.push({ pathname: '/order/[id]', params: { id: order.id } })}
      accessibilityLabel={t(isRide ? 'home.active_trip' : 'home.active_order')}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name={isRide ? 'car' : 'bag'} size={22} color="accentText" strokeWidth={2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{t(isRide ? 'home.active_trip' : 'home.active_order')}</Text>
          <StatusPill live tone="accent" size="sm" label={t(isRide ? rideStatusKey(order.state) : (`order.status.${order.state}` as MessageKey))} />
        </View>
        <Icon name="chevron-forward" size={20} color="accentText" />
      </View>
    </Card>
  );
}

/** A ride's order states read as the trip does ("ندور لك سايق", "السايق بالطريق إلك"). */
function rideStatusKey(state: Order['state']): MessageKey {
  if (state === 'placed') return 'trip.status.offered';
  if (state === 'matched') return 'trip.status.en_route_to_pickup';
  return `order.status.${state}` as MessageKey;
}
