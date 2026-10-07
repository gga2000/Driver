import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import { formatClock, formatDay } from '@driver/i18n';
import { Button, Card, EmptyState, Icon, RetryState, retryKindFor, SketchScene, Skeleton, StatusPill, Text, useNetwork, useNow, useTheme, useToast } from '@driver/ui';
import { GuestGate } from '@/components/GuestGate';
import { Screen } from '@/components/Screen';
import { DriverFace } from '@/features/ride-habits/Cards';
import { bookedMemory } from '@/features/ride-habits/booked-memory';
import { regularDraft } from '@/features/ride-habits/draft';
import { isBookedRide, searchStartsAt } from '@/features/ride-habits/logic';
import { useBookedRoute, useFavourites } from '@/features/ride-habits/queries';
import { apiErrorMessage, useApi, useApiClient } from '@/lib/api';
import { appNow } from '@/lib/dev-clock';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useSignedIn } from '@/lib/session';

/**
 * «مشوارك محجوز» (joy J7d): a ride booked for later until its search starts 15 minutes before — when,
 * from where to where, the fare the server fixed, the favourite asked first, and a free cancel. Then
 * the order opens the live ride screen like any ride. «خليها رحلة ثابتة» saves it as a regular trip.
 */
export default function BookedRidePage() {
  return useSignedIn() ? <BookedRide /> : <GuestGate kind="orders" />;
}

function BookedRide() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const toast = useToast();
  const api = useApi();
  const client = useApiClient();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const order = useQuery({ ...api.orders.get.queryOptions({ orderId: id ?? '' }), enabled: Boolean(id), refetchInterval: 30_000 });
  const favs = useFavourites();
  const memo = useBookedRoute(id ?? '');
  const tick = useNow(true, 15_000);
  const now = useMemo(() => appNow(tick), [tick]);
  const o = order.data;
  const cancel = useQuery({ ...api.orders.cancellationPreview.queryOptions({ orderId: id ?? '' }), enabled: Boolean(o && o.state === 'placed') });

  // The search started (or a driver took it): the live ride screen from here on.
  const waiting = o ? isBookedRide(o, now) : true;
  useEffect(() => {
    if (o && !waiting && o.state !== 'customer_cancelled' && o.state !== 'platform_cancelled') router.replace({ pathname: '/order/[id]', params: { id: o.id } });
  }, [o, waiting]);

  const doCancel = async () => {
    try {
      await client.orders.cancel.mutate({ orderId: id ?? '', reason: 'booked_ride_cancelled' });
      toast.show({ message: t('habits.booked_cancelled'), tone: 'neutral', icon: 'check' });
      void qc.invalidateQueries({ queryKey: api.orders.mine.queryKey() });
      void order.refetch();
    } catch (e) {
      toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' });
    }
  };

  const fav = o?.preferredDriverId ? (favs.data ?? []).find((f) => f.driverId === o.preferredDriverId) : null;
  const starts = o ? searchStartsAt(o) : null;
  const cancelled = o?.state === 'customer_cancelled' || o?.state === 'platform_cancelled';
  const vertical = memo?.vertical ?? 'taxi';
  const ends = id ? bookedMemory.get(id) : null;

  const makeRegular = () => {
    if (!o?.scheduledFor) return;
    regularDraft.start('ride', {
      timeMin: Math.round((o.scheduledFor.getTime() + 3 * 3_600_000) / 60_000) % (24 * 60),
      ride: { rideVertical: vertical, pickup: ends?.pickup ?? null, dropoff: ends?.dropoff ?? null, doorPickup: memo?.doorPickup ?? false },
      ...(fav ? { favouriteId: fav.id } : {}),
      paymentMethod: o.paymentMethod === 'wallet' ? 'wallet' : 'cash',
    });
    router.push('/regular/edit');
  };

  return (
    <Screen edges={['bottom']} testID="booked-ride" contentStyle={{ gap: theme.space[4] }}>
      {order.isError && !o ? (
        <RetryState kind={retryKindFor({ net, error: order.error })} locale={locale} art={net.state !== 'online' ? <SketchScene name="offline" /> : undefined} onRetry={() => void order.refetch()} />
      ) : !o ? (
        <View style={{ gap: theme.space[3] }} testID="booked-loading">
          <Skeleton height={180} />
          <Skeleton height={56} />
        </View>
      ) : o.type !== 'ride' || !o.scheduledFor ? (
        <EmptyState icon="taxi" title={t('habits.booked_not_found')} action={{ label: t('nav.orders'), onPress: () => router.replace('/orders') }} />
      ) : (
        <>
          <Card padding={0} elevation={1} testID="booked-card">
            <SketchScene name="safe_arrival" animate={false} vehicle={vertical === 'tuktuk' ? 'tuktuk' : 'car'} style={{ width: '100%', aspectRatio: 2.4 }} />
            <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
              <StatusPill tone={cancelled ? 'neutral' : 'success'} icon={cancelled ? 'x' : 'check'} label={cancelled ? t('habits.booked_cancelled_pill') : t('habits.booked_pill')} />
              <Text variant="caption" weight={600} color="liveText">
                {formatDay(o.scheduledFor, now)}
              </Text>
              <Text variant="heading" tabular testID="booked-time">
                {formatClock(o.scheduledFor)}
              </Text>
              {memo ? (
                <Text variant="bodyStrong" numberOfLines={2}>
                  {t('rajaa.route', { from: memo.from, to: memo.to })}
                </Text>
              ) : null}
              <Text variant="footnote" color="textMuted" tabular>
                {[t(vertical === 'tuktuk' ? 'ride.vehicle_tuktuk' : 'ride.vehicle_taxi'), t('habits.amount', { amount: amountParam(o.totalIqd) }), o.paymentMethod === 'wallet' ? t('ride.pay_wallet') : t('ride.pay_cash')].join(' · ')}
              </Text>
            </View>
          </Card>

          {fav ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }} testID="booked-fav">
              <DriverFace name={fav.firstName} photoUrl={fav.photoUrl} size={44} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{t('habits.booked_fav', { name: fav.firstName ?? t('habits.fav_unnamed') })}</Text>
                <Text variant="caption" color="textMuted">
                  {t('habits.favourite_hint')}
                </Text>
              </View>
            </View>
          ) : null}

          {!cancelled && starts ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
              <Icon name="clock" size={18} color="liveText" />
              <Text variant="body" style={{ flex: 1 }} testID="booked-search">
                {t('habits.booked_search', { time: formatClock(starts) })}
              </Text>
            </View>
          ) : null}

          {!cancelled ? (
            <>
              <Button testID="booked-regular" variant="secondary" icon="refresh" label={t('habits.booked_make_regular')} fullWidth onPress={makeRegular} />
              <Button testID="booked-cancel" variant="ghost" label={t('habits.booked_cancel')} onPress={() => void doCancel()} />
              {cancel.data?.free ? (
                <Text variant="caption" color="textMuted" align="center">
                  {t('habits.booked_cancel_free')}
                </Text>
              ) : null}
            </>
          ) : (
            <Button testID="booked-new" label={t('habits.booked_new')} fullWidth onPress={() => router.replace('/ride')} />
          )}
        </>
      )}
    </Screen>
  );
}
