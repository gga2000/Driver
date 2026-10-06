import { router, Stack } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { Button, Card, formatClock, ListRow, Skeleton, Text, useNow, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { HeaderBack } from '@/features/food/HeaderBack';
import { Faq, WhatsAppCard } from '@/features/help/HelpParts';
import { dayKey } from '@/features/orders/history';
import { dayLabel, OrderArt, orderTitle } from '@/features/orders/OrderRow';
import { useOrderHistory } from '@/features/orders/queries';
import { itemsSummary } from '@/features/orders/reorder';
import { useSupportWhatsApp } from '@/features/help/HelpParts';
import { useMyBookings, useNetwork } from '@/features/rajaa/queries';
import { pastTrips, upcomingTrips } from '@/features/rajaa/trips';
import { tripRoute, TripRow } from '@/features/rajaa/TripRow';
import { clockLabel } from '@/features/rajaa/logic';
import { seatsList } from '@/features/rajaa/labels';
import { useLocale, useT } from '@/lib/i18n';

/** Recent orders offered for "عندي مشكلة". */
const RECENT = 5;

/**
 * مساعدة (audit C-13, spec §10: self-serve first, then a person): my recent orders → "عندي مشكلة"
 * (a complaint on the order, which opens a support ticket), the WhatsApp line, and five short
 * answers to what people ask most (cash, change, cancelling, lateness, الرجعة).
 */
export default function Help() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const history = useOrderHistory();
  const tick = useNow(true, 60_000);
  const now = useMemo(() => new Date(tick), [tick]);
  const recent = (history.data ?? []).slice(0, RECENT);
  // r4: a الرجعة seat can reach help too: the WhatsApp line with the trip already typed.
  const bookings = useMyBookings();
  const network = useNetwork();
  const support = useSupportWhatsApp();
  const trips = useMemo(() => [...upcomingTrips(bookings.data ?? [], now), ...pastTrips(bookings.data ?? [])].slice(0, RECENT), [bookings.data, now]);

  return (
    <Screen testID="help" edges={[]} contentStyle={{ gap: theme.space[6] }}>
      <Stack.Screen options={{ title: t('help.title'), headerShown: true, headerLeft: () => <HeaderBack /> }} />

      <View style={{ gap: theme.space[3] }}>
        <View style={{ gap: 2 }}>
          <SectionHeader title={t('help.orders_heading')} />
          <Text variant="footnote" color="textMuted">
            {t('help.orders_hint')}
          </Text>
        </View>
        <Card elevation={0} padding={0}>
          {history.isPending ? (
            <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
              <Skeleton height={48} />
              <Skeleton height={48} />
            </View>
          ) : recent.length === 0 ? (
            <ListRow leading="receipt" title={t('help.orders_empty')} chevron={false} />
          ) : (
            recent.map((row, i) => {
              const day = dayKey(row.order.placedAt, now);
              return (
                <ListRow
                  key={row.order.id}
                  testID={`help-order-${row.order.id}`}
                  leading={<OrderArt row={row} size={44} />}
                  title={orderTitle(t, row, locale)}
                  subtitle={[`${dayLabel(t, day)} ${formatClock(row.order.placedAt)}`, itemsSummary(row.items, 2)].filter(Boolean).join(' · ')}
                  value={t('help.order_problem')}
                  onPress={() => router.push({ pathname: '/help/[orderId]', params: { orderId: row.order.id } })}
                  divider={i < recent.length - 1}
                />
              );
            })
          )}
        </Card>
        {(history.data?.length ?? 0) > RECENT ? <Button variant="ghost" label={t('help.orders_all')} onPress={() => router.push('/orders')} /> : null}
      </View>

      {trips.length > 0 ? (
        <View style={{ gap: theme.space[3] }} testID="help-trips">
          <SectionHeader title={t('help.trips_heading')} />
          <Card elevation={0} padding={0}>
            {trips.map((b, i) => (
              <TripRow
                key={b.id}
                testID={`help-trip-${b.id}`}
                booking={b}
                network={network.data}
                now={now}
                divider={i < trips.length - 1}
                onPress={() =>
                  void support(t('rajaa.safe_problem_message', { route: tripRoute(t, b, network.data), day: dayLabel(t, dayKey(b.departure.departAt, now)), time: clockLabel(b.departure.departAt), seat: seatsList(t, b.seatIds) }))
                }
              />
            ))}
          </Card>
        </View>
      ) : null}

      <WhatsAppCard message={t('help.whatsapp_message')} />

      <View style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('help.faq_heading')} />
        <Faq />
      </View>
    </Screen>
  );
}
