import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { Card, EmptyState, SketchScene, Skeleton, Text, useNow, useTheme } from '@driver/ui';
import { GuestGate } from '@/components/GuestGate';
import { Screen } from '@/components/Screen';
import { canReorder, sectionByDay } from '@/features/orders/history';
import { dayLabel, OrderRow } from '@/features/orders/OrderRow';
import { canOrderAgain, drawsAsFood } from '@/features/orders/orders-v2';
import { FoodOrderRow, LiveOrderCard } from '@/features/orders/OrdersV2Parts';
import { useMyPersonId, useOrderHistory } from '@/features/orders/queries';
import { ReorderButton, useReorderFlow } from '@/features/orders/ReorderSheet';
import { useMyBookings, useNetwork } from '@/features/rajaa/queries';
import { pastTrips, upcomingTrips, withTrips } from '@/features/rajaa/trips';
import { TripRow } from '@/features/rajaa/TripRow';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';
import { useUiSwitch } from '@/lib/ui-switches';

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
  const v2 = useUiSwitch('orders_v2');
  const tick = useNow(true, 60_000);
  const now = useMemo(() => new Date(tick), [tick]);
  // r4: الرجعة seats live here too — coming trips pinned on top, past ones in their day.
  const bookings = useMyBookings();
  const network = useNetwork();
  const upcoming = useMemo(() => upcomingTrips(bookings.data ?? [], now), [bookings.data, now]);
  const sections = useMemo(() => withTrips(sectionByDay(history.data ?? [], now), pastTrips(bookings.data ?? []), now), [history.data, bookings.data, now]);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([history.refetch(), bookings.refetch()]);
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
      ) : sections.length === 0 && upcoming.length === 0 ? (
        <EmptyState icon="receipt" art={<SketchScene name="empty_orders" />} title={t('empty.orders')} body={t('empty.orders_hint')} action={{ label: t('empty.orders_cta'), onPress: () => router.push('/restaurants') }} />
      ) : (
        <>
        {upcoming.length > 0 ? (
          <View style={{ gap: theme.space[2] }} testID="orders-section-trips">
            <Text variant="label" weight={600} color="accentText" accessibilityRole="header">
              {t('orders.section_trips')}
            </Text>
            <Card elevation={0} padding={0} tone="tint">
              {upcoming.map((b, i) => (
                <TripRow key={b.id} booking={b} network={network.data} now={now} divider={i < upcoming.length - 1} />
              ))}
            </Card>
          </View>
        ) : null}
        {sections.map((s) => {
          // After-order Step 4 (`orders_v2`): a running kitchen order is a live card with its road (o2);
          // rides, seats and parcels keep their own rows in the same place.
          const live = v2 && s.running ? s.rows.filter((r) => r.kind === 'order' && drawsAsFood(r.row)) : [];
          const rows = live.length > 0 ? s.rows.filter((r) => !live.includes(r)) : s.rows;
          return (
            <View key={s.id} style={{ gap: theme.space[2] }} testID={`orders-section-${s.running ? 'running' : s.id}`}>
              <Text variant="label" weight={600} color={s.running ? 'accentText' : 'textMuted'} accessibilityRole="header">
                {s.running ? t('orders.section_running') : s.day ? dayLabel(t, s.day) : ''}
              </Text>
              {live.map((item) => (item.kind === 'order' ? <LiveOrderCard key={item.row.order.id} row={item.row} /> : null))}
              {rows.length > 0 ? (
                <Card elevation={0} padding={0} tone={s.running ? 'tint' : 'surface'}>
                  {rows.map((item, i) =>
                    item.kind === 'trip' ? (
                      <TripRow key={item.booking.id} booking={item.booking} network={network.data} now={now} divider={i < rows.length - 1} />
                    ) : v2 && drawsAsFood(item.row) ? (
                      <FoodOrderRow
                        key={item.row.order.id}
                        row={item.row}
                        divider={i < rows.length - 1}
                        again={canOrderAgain(item.row, me) ? { loading: reorder.busyOrderId === item.row.order.id, onPress: () => void reorder.start(item.row) } : undefined}
                      />
                    ) : (
                      <OrderRow
                        key={item.row.order.id}
                        row={item.row}
                        now={now}
                        divider={i < rows.length - 1}
                        action={
                          canReorder(item.row.order) && (!me || item.row.order.ordererId === me) ? (
                            <ReorderButton testID={`reorder-${item.row.order.id}`} loading={reorder.busyOrderId === item.row.order.id} onPress={() => void reorder.start(item.row)} />
                          ) : undefined
                        }
                      />
                    ),
                  )}
                </Card>
              ) : null}
            </View>
          );
        })}
        </>
      )}
      {reorder.sheet}
    </Screen>
  );
}
