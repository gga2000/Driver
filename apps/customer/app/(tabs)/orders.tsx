import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { Card, EmptyState, QueryBoundary, SketchScene, Skeleton, Text, useNow, useTheme } from '@driver/ui';
import { GuestGate } from '@/components/GuestGate';
import { MAX_CONTENT_WIDTH, Screen } from '@/components/Screen';
import { BookedRideRow } from '@/features/orders/BookedRideRow';
import { canReorder, sectionByDay } from '@/features/orders/history';
import { flattenHistory } from '@/features/orders/history-list';
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

  const items = useMemo(
    () =>
      flattenHistory(coming, sections, {
        coming: (c) => (c.kind === 'ride' ? c.row.order.id : c.booking.id),
        row: (r) => (r.kind === 'trip' ? r.booking.id : r.row.order.id),
      }),
    [coming, sections],
  );
  type Item = (typeof items)[number];
  const column = { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' } as const;
  const gutter = theme.space[5];
  // One row of a card that the fast list draws piece by piece: the first row opens the card, the last closes it.
  const segment = (tint: boolean, first: boolean, last: boolean) => ({
    backgroundColor: tint ? theme.colors.accentTint : theme.colors.surface,
    borderColor: tint ? theme.colors.tintBorder : theme.colors.border,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopWidth: first ? 1 : 0,
    borderBottomWidth: last ? 1 : 0,
    borderTopLeftRadius: first ? theme.radius.xl : 0,
    borderTopRightRadius: first ? theme.radius.xl : 0,
    borderBottomLeftRadius: last ? theme.radius.xl : 0,
    borderBottomRightRadius: last ? theme.radius.xl : 0,
    overflow: 'hidden' as const,
  });
  const renderItem = ({ item }: { item: Item }) => {
    if (item.type === 'label') {
      const l = item.label;
      return (
        <Text
          variant="label"
          weight={600}
          color={l.kind === 'day' ? 'textMuted' : 'accentText'}
          accessibilityRole="header"
          testID={`orders-section-${l.kind === 'day' ? item.key.slice('label:'.length) : l.kind}`}
          style={{ marginTop: item.first ? 0 : theme.space[5], marginBottom: theme.space[2] }}
        >
          {l.kind === 'trips' ? t('orders.section_trips') : l.kind === 'running' ? t('orders.section_running') : l.day ? dayLabel(t, l.day) : ''}
        </Text>
      );
    }
    if (item.type === 'coming') {
      const c = item.value;
      return (
        <View style={segment(true, item.first, item.last)}>
          {c.kind === 'ride' ? (
            <BookedRideRow row={c.row} now={now} divider={!item.last} />
          ) : (
            <TripRow booking={c.booking} network={network.data} now={now} divider={!item.last} />
          )}
        </View>
      );
    }
    const r = item.value;
    return (
      <View style={segment(item.tint, item.first, item.last)}>
        {r.kind === 'trip' ? (
          <TripRow booking={r.booking} network={network.data} now={now} divider={!item.last} />
        ) : (
          <OrderRow
            row={r.row}
            now={now}
            divider={!item.last}
            action={
              canReorder(r.row.order) && (!me || r.row.order.ordererId === me) ? (
                <ReorderButton testID={`reorder-${r.row.order.id}`} loading={reorder.busyOrderId === r.row.order.id} onPress={() => void reorder.start(r.row)} />
              ) : undefined
            }
          />
        )}
      </View>
    );
  };

  return (
    <Screen testID="orders" scroll={false} padded={false}>
      <View style={[column, { flex: 1 }]}>
        <View style={{ paddingHorizontal: gutter, paddingTop: theme.space[3], paddingBottom: theme.space[5], gap: theme.space[5] }}>
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
        </View>
        {/* W8: no network, slow or a server failure each say so with a retry; orders already on the phone stay
            on screen (marked old) when a refresh fails, instead of being swapped for an error. */}
        <QueryBoundary
          query={history}
          locale={locale}
          testID="orders-state"
          style={{ flex: 1 }}
          skeleton={
            <View style={{ paddingHorizontal: gutter }}>
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
            </View>
          }
        >
          {() =>
            items.length === 0 ? (
              <View style={{ paddingHorizontal: gutter }}>
                <EmptyState icon="receipt" art={<SketchScene name="empty_orders" />} title={t('empty.orders')} body={t('empty.orders_hint')} action={{ label: t('empty.orders_cta'), onPress: () => router.push('/restaurants') }} />
              </View>
            ) : (
              <FlashList
                data={items}
                renderItem={renderItem}
                keyExtractor={(i) => i.key}
                getItemType={(i) => (i.type === 'label' ? 'label' : i.type === 'coming' ? (i.value.kind === 'ride' ? 'ride' : 'seat') : i.value.kind)}
                extraData={{ now, busy: reorder.busyOrderId, network: network.data }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
                contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: theme.space[10] }}
                testID="orders-list"
              />
            )
          }
        </QueryBoundary>
      </View>
      {reorder.sheet}
    </Screen>
  );
}
