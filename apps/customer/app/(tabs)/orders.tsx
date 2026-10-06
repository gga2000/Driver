import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { Card, EmptyState, SketchScene, Skeleton, Text, useNow, useTheme } from '@driver/ui';
import { GuestGate } from '@/components/GuestGate';
import { Screen } from '@/components/Screen';
import { canReorder, sectionByDay } from '@/features/orders/history';
import { dayLabel, OrderRow } from '@/features/orders/OrderRow';
import { useMyPersonId, useOrderHistory } from '@/features/orders/queries';
import { ReorderButton, useReorderFlow } from '@/features/orders/ReorderSheet';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';

/**
 * طلباتي (audit C-15 / C-44): `orders.history` — what's running now pinned on top, then by day
 * ("اليوم", "أمس", "الجمعة 2/10"). Each row names the restaurant and the dishes, the time, total and
 * ticket number, a one-word status; food that reached the door has "اطلبه مرة ثانية". Detail opens
 * /order/[id]. Guests see what lives here and add their number (audit C-18).
 */
export default function OrdersTab() {
  return useSignedIn() ? <Orders /> : <GuestGate kind="orders" />;
}

function Orders() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const history = useOrderHistory();
  const me = useMyPersonId();
  const reorder = useReorderFlow();
  const tick = useNow(true, 60_000);
  const now = useMemo(() => new Date(tick), [tick]);
  const sections = useMemo(() => sectionByDay(history.data ?? [], now), [history.data, now]);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await history.refetch().catch(() => undefined);
    setRefreshing(false);
  };

  return (
    <Screen testID="orders" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />} contentStyle={{ gap: theme.space[5] }}>
      <Text variant="heading" accessibilityRole="header">
        {t('nav.orders')}
      </Text>
      {history.isPending ? (
        <Card elevation={0} padding={0}>
          <View accessibilityLabel={t('status.loading')} style={{ padding: theme.space[4], gap: theme.space[5] }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
                <Skeleton width={48} height={48} radius={theme.radius.lg} />
                <View style={{ flex: 1, gap: theme.space[2] }}>
                  <Skeleton height={14} width="55%" />
                  <Skeleton height={12} width="75%" />
                  <Skeleton height={10} width="40%" />
                </View>
              </View>
            ))}
          </View>
        </Card>
      ) : history.isError ? (
        <EmptyState icon="x" title={apiErrorMessage(history.error, t('error.network'), locale)} action={{ label: t('action.retry'), onPress: () => void history.refetch() }} />
      ) : sections.length === 0 ? (
        <EmptyState icon="receipt" art={<SketchScene name="empty_orders" />} title={t('empty.orders')} body={t('empty.orders_hint')} action={{ label: t('empty.orders_cta'), onPress: () => router.push('/restaurants') }} />
      ) : (
        sections.map((s) => (
          <View key={s.id} style={{ gap: theme.space[2] }} testID={`orders-section-${s.running ? 'running' : s.id}`}>
            <Text variant="label" weight={600} color={s.running ? 'accentText' : 'textMuted'} accessibilityRole="header">
              {s.running ? t('orders.section_running') : s.day ? dayLabel(t, s.day) : ''}
            </Text>
            <Card elevation={0} padding={0} tone={s.running ? 'tint' : 'surface'}>
              {s.rows.map((row, i) => (
                <OrderRow
                  key={row.order.id}
                  row={row}
                  now={now}
                  divider={i < s.rows.length - 1}
                  action={
                    canReorder(row.order) && (!me || row.order.ordererId === me) ? (
                      <ReorderButton testID={`reorder-${row.order.id}`} loading={reorder.busyOrderId === row.order.id} onPress={() => void reorder.start(row)} />
                    ) : undefined
                  }
                />
              ))}
            </Card>
          </View>
        ))
      )}
      {reorder.sheet}
    </Screen>
  );
}
