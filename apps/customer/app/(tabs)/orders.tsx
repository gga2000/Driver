import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { Card, EmptyState, QueryBoundary, SketchScene, Skeleton, Text, useNow, useTheme } from '@driver/ui';
import { GuestGate } from '@/components/GuestGate';
import { Screen } from '@/components/Screen';
import { BookedRideRow } from '@/features/orders/BookedRideRow';
import { canReorder, sectionByDay } from '@/features/orders/history';
import { dayLabel, OrderRow } from '@/features/orders/OrderRow';
import { useMyPersonId, useOrderHistory } from '@/features/orders/queries';
import { ReorderButton, useReorderFlow } from '@/features/orders/ReorderSheet';
import { useMyBookings, useNetwork } from '@/features/rajaa/queries';
import { pastTrips, upcomingTrips, withTrips } from '@/features/rajaa/trips';
import { TripRow } from '@/features/rajaa/TripRow';
import { isBookedRide } from '@/features/ride-habits/logic';
import { useLocale, useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';

/**
 * طلباتي (audit C-15 / C-44): `orders.history` — what's running now pinned on top, then by day
 * ("اليوم", "أمس", "الجمعة 2/10"). Each row names the restaurant and the dishes, the time, total and
 * ticket number, a one-word status; food that reached the door has "اطلبه مرة ثانية". Detail opens
 * /order/[id]. Guests see what lives here and add their number (audit C-18). Rides booked «بعدين»
 * (step 4, c10) sit with the coming trips, soonest first, with their time and a cancel.
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
  // r4: الرجعة seats live here too — coming trips pinned on top, past ones in their day.
  const bookings = useMyBookings();
  const network = useNetwork();
  const upcoming = useMemo(() => upcomingTrips(bookings.data ?? [], now), [bookings.data, now]);
  // Coming: الرجعة seats and rides booked «بعدين», in time order.
  const coming = useMemo(
    () =>
      [
        ...(history.data ?? []).filter((r) => isBookedRide(r.order, now)).map((row) => ({ kind: 'ride' as const, at: row.order.scheduledFor?.getTime() ?? 0, row })),
        ...upcoming.map((booking) => ({ kind: 'seat' as const, at: booking.departure.departAt.getTime(), booking })),
      ].sort((a, b) => a.at - b.at),
    [history.data, upcoming, now],
  );
  const sections = useMemo(
    () =>
      withTrips(
        sectionByDay(
          (history.data ?? []).filter((r) => !isBookedRide(r.order, now)),
          now,
        ),
        pastTrips(bookings.data ?? []),
        now,
      ),
    [history.data, bookings.data, now],
  );
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
      {/* W8: a failed seat-bookings read says so in one row above the orders (not while the whole list failed). */}
      {bookings.isError && bookings.data === undefined && history.data !== undefined ? (
        <QueryBoundary
          query={bookings}
          size="inline"
          locale={locale}
          testID="orders-trips-state"
          skeleton={null}
          retry={{ server: { title: t('orders.trips_failed') }, slow: { title: t('orders.trips_failed') }, unreachable: { title: t('orders.trips_failed') } }}
        >
          {() => null}
        </QueryBoundary>
      ) : null}
      {/* W8: no network, slow or a server failure each say so with a retry; orders already on the phone stay
          on screen (marked old) when a refresh fails, instead of being swapped for an error. */}
      <QueryBoundary
        query={history}
        locale={locale}
        testID="orders-state"
        style={{ gap: theme.space[5] }}
        skeleton={
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
        }
      >
        {() => (sections.length === 0 && coming.length === 0 ? (
        <EmptyState icon="receipt" art={<SketchScene name="empty_orders" />} title={t('empty.orders')} body={t('empty.orders_hint')} action={{ label: t('empty.orders_cta'), onPress: () => router.push('/restaurants') }} />
      ) : (
        <>
        {coming.length > 0 ? (
          <View style={{ gap: theme.space[2] }} testID="orders-section-trips">
            <Text variant="label" weight={600} color="accentText" accessibilityRole="header">
              {t('orders.section_trips')}
            </Text>
            <Card elevation={0} padding={0} tone="tint">
              {coming.map((c, i) =>
                c.kind === 'ride' ? (
                  <BookedRideRow key={c.row.order.id} row={c.row} now={now} divider={i < coming.length - 1} />
                ) : (
                  <TripRow key={c.booking.id} booking={c.booking} network={network.data} now={now} divider={i < coming.length - 1} />
                ),
              )}
            </Card>
          </View>
        ) : null}
        {sections.map((s) => (
          <View key={s.id} style={{ gap: theme.space[2] }} testID={`orders-section-${s.running ? 'running' : s.id}`}>
            <Text variant="label" weight={600} color={s.running ? 'accentText' : 'textMuted'} accessibilityRole="header">
              {s.running ? t('orders.section_running') : s.day ? dayLabel(t, s.day) : ''}
            </Text>
            <Card elevation={0} padding={0} tone={s.running ? 'tint' : 'surface'}>
              {s.rows.map((item, i) =>
                item.kind === 'trip' ? (
                  <TripRow key={item.booking.id} booking={item.booking} network={network.data} now={now} divider={i < s.rows.length - 1} />
                ) : (
                  <OrderRow
                    key={item.row.order.id}
                    row={item.row}
                    now={now}
                    divider={i < s.rows.length - 1}
                    action={
                      canReorder(item.row.order) && (!me || item.row.order.ordererId === me) ? (
                        <ReorderButton testID={`reorder-${item.row.order.id}`} loading={reorder.busyOrderId === item.row.order.id} onPress={() => void reorder.start(item.row)} />
                      ) : undefined
                    }
                  />
                ),
              )}
            </Card>
          </View>
        ))}
        </>
      ))}
      </QueryBoundary>
      {reorder.sheet}
    </Screen>
  );
}
