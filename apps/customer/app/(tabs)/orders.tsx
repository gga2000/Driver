import { router } from 'expo-router';
import { View } from 'react-native';
import { orderTicketNumber, type Order, type OrderType } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Card, EmptyState, formatClock, ListRow, Skeleton, StatusPill, Text, useTheme, type IconName, type StatusTone } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { isActiveOrder, useMyOrders } from '@/features/home/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';

const TYPE_ICON: Record<OrderType, IconName> = {
  food: 'bag',
  grocery_catalog: 'cart',
  errand: 'bag',
  parcel: 'parcel',
  ride: 'car',
  seat: 'seat',
  subscription: 'clock',
};

function tone(o: Order): StatusTone {
  if (isActiveOrder(o)) return 'accent';
  if (o.state === 'delivered' || o.state === 'completed' || o.state === 'closed') return 'success';
  if (o.state === 'disputed') return 'warning';
  return 'neutral';
}

/** طلباتي: the person's own orders (`orders.mine`), newest first. Detail opens /order/[id]. */
export default function Orders() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const orders = useMyOrders();

  return (
    <Screen testID="orders">
      <Text variant="heading" accessibilityRole="header">
        {t('nav.orders')}
      </Text>
      {orders.isPending ? (
        <Card elevation={0} padding={0}>
          <View accessibilityLabel={t('status.loading')} style={{ padding: theme.space[4], gap: theme.space[5] }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
                <Skeleton width={40} height={40} radius={10} />
                <View style={{ flex: 1, gap: theme.space[2] }}>
                  <Skeleton height={14} width="60%" />
                  <Skeleton height={12} width="40%" />
                </View>
              </View>
            ))}
          </View>
        </Card>
      ) : orders.isError ? (
        <EmptyState
          icon="x"
          title={apiErrorMessage(orders.error, t('error.network'), locale)}
          action={{ label: t('action.retry'), onPress: () => void orders.refetch() }}
        />
      ) : orders.data.length === 0 ? (
        <EmptyState
          icon="receipt"
          title={t('empty.orders')}
          body={t('empty.orders_hint')}
          action={{ label: t('home.order_now'), onPress: () => router.navigate('/') }}
        />
      ) : (
        <Card elevation={0} padding={0}>
          {orders.data.map((o, i) => (
            <ListRow
              key={o.id}
              testID={`order-${o.id}`}
              leading={TYPE_ICON[o.type]}
              title={`${t(`order.type.${o.type}` as MessageKey)} · ${t('order.number', { id: orderTicketNumber(o.id) })}`}
              subtitle={`${formatClock(o.placedAt)} · ${iqd(o.totalIqd, { locale })}`}
              trailing={<StatusPill size="sm" tone={tone(o)} live={isActiveOrder(o)} label={t(`order.status.${o.state}` as MessageKey)} />}
              divider={i < orders.data.length - 1}
              onPress={() => router.push({ pathname: '/order/[id]', params: { id: o.id } })}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}
