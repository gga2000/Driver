import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import type { DriverRequestRide, RequestPostView } from '@driver/contracts';
import { Button, Card, Chip, EmptyState, Icon, IconButton, Rule, Skeleton, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SosControl } from '@/features/safety/SosControl';
import { rideState, seatsCount, timeWithPeriod, travellingAsLabel, whenLabel } from '@/features/intercity/labels';
import { clampOffer, depositFor, OFFER_STEP_IQD, privateRideNet, suggestedOffer } from '@/features/intercity/logic';
import { useMyRides, useOpenRequests, useRequestActions } from '@/features/intercity/queries';
import { useNow } from '@/features/intercity/useNow';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { currentFix } from '@/lib/location';
import { amountParam } from '@/lib/money';

/**
 * A request-board post (another destination, a private car, or a stranded rider at her seat price):
 * the trip, and his offer in steps of 1,000 with the money spelled out (deposit from the rider's
 * wallet, the cash part, what he keeps after 8 %). Once the rider picks him it becomes his ride:
 * "وصلت" → "وصّلت الراكب", or "الراكب ما إجا" when the wait has passed (the deposit is his).
 */
export default function RequestScreen() {
  const theme = useTheme();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const open = useOpenRequests();
  const rides = useMyRides();
  const ride = rides.data?.find((r) => r.id === id) ?? null;
  const post = open.data?.find((r) => r.id === id) ?? null;

  if (ride) return <RideView ride={ride} />;
  if (post) return <OfferView post={post} />;
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: t('partner.ic_req_title') }} />
      {open.isFetched && rides.isFetched ? (
        <EmptyState icon="map-pin" title={t('partner.ic_req_gone')} action={{ label: t('partner.ic_back_board'), onPress: () => (router.canGoBack() ? router.back() : router.replace('/intercity')) }} />
      ) : (
        <View style={{ gap: theme.space[4] }}>
          <Skeleton height={140} radius={20} />
          <Skeleton height={200} radius={20} />
        </View>
      )}
    </Screen>
  );
}

function TripCard({ post, extra }: { post: RequestPostView; extra?: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const now = useNow(30_000);
  return (
    <Card padding={5} testID="request-trip">
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
          <View style={{ alignItems: 'center', paddingTop: 6 }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 3, borderColor: theme.colors.text }} />
            <View style={{ width: 2, flex: 1, minHeight: 22, backgroundColor: theme.colors.border, marginVertical: 3 }} />
            <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: theme.colors.accent }} />
          </View>
          <View style={{ flex: 1, gap: theme.space[3] }}>
            <Text variant="bodyStrong">{post.from.label}</Text>
            <Text variant="bodyStrong">{post.to.label}</Text>
          </View>
        </View>
        <Rule />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          <StatusPill label={whenLabel(t, post.when, now)} tone="neutral" icon="clock" size="sm" />
          <StatusPill label={seatsCount(t, post.seats)} tone="neutral" icon="seat" size="sm" />
          <StatusPill label={t('partner.ic_req_travelling', { as: travellingAsLabel(t, post.travellingAs) })} tone="neutral" icon="user" size="sm" />
          {post.privateCar ? <StatusPill label={t('partner.ic_req_private')} tone="info" icon="car" size="sm" /> : null}
          {post.origin === 'stranded' ? <StatusPill label={t('partner.ic_req_stranded')} tone="warning" size="sm" /> : null}
        </View>
        {post.note ? (
          <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.md, padding: theme.space[3], gap: 2 }}>
            <Text variant="caption" color="textMuted">
              {t('partner.ic_req_note')}
            </Text>
            <Text variant="footnote">{post.note}</Text>
          </View>
        ) : null}
        {extra}
      </View>
    </Card>
  );
}

function OfferView({ post }: { post: RequestPostView }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { offer } = useRequestActions();
  const mine = post.offers.find((o) => o.state === 'open') ?? null;
  const [price, setPrice] = useState(() => mine?.priceIqd ?? suggestedOffer(post));
  useEffect(() => {
    if (mine) setPrice(mine.priceIqd);
  }, [mine]);
  const cap = post.priceCapIqd;
  const deposit = depositFor(price);
  const quick = [price - 5_000, price + 5_000].map((p) => clampOffer(p, cap)).filter((p, i, a) => p !== price && a.indexOf(p) === i);

  const send = async () => {
    try {
      await offer.mutateAsync({ postId: post.id, priceIqd: price });
      theme.haptic('success');
      toast.show({ message: t('partner.ic_req_sent'), tone: 'success' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  const same = mine?.priceIqd === price;
  return (
    <Screen
      testID="request-offer"
      edges={['bottom']}
      footer={
        <Button
          testID="offer-send"
          label={mine ? (same ? t('partner.ic_req_waiting', { amount: amountParam(price) }) : t('partner.ic_req_update', { amount: amountParam(price) })) : t('partner.ic_req_send', { amount: amountParam(price) })}
          size="lg"
          fullWidth
          disabled={same}
          loading={offer.isPending}
          onPress={() => void send()}
        />
      }
    >
      <Stack.Screen options={{ title: t('partner.ic_req_title') }} />
      <TripCard post={post} />

      <Card padding={5} testID="offer-price">
        <View style={{ gap: theme.space[4] }}>
          <Text variant="label" color="textMuted">
            {t('partner.ic_req_your_price')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <IconButton icon="minus" variant="tonal" size={52} accessibilityLabel="−1,000" onPress={() => setPrice((p) => clampOffer(p - OFFER_STEP_IQD, cap))} />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text variant="display" tabular testID="offer-amount">
                {amountParam(price)}
              </Text>
              <Text variant="label" color="textMuted">
                {t('quote.currency')}
              </Text>
            </View>
            <IconButton icon="plus" variant="tonal" size={52} accessibilityLabel="+1,000" onPress={() => setPrice((p) => clampOffer(p + OFFER_STEP_IQD, cap))} />
          </View>
          {quick.length > 0 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: theme.space[2] }}>
              {quick.map((p) => (
                <Chip key={p} role="button" label={amountParam(p)} onPress={() => setPrice(p)} />
              ))}
            </View>
          ) : null}
          {cap !== null ? (
            <Text variant="footnote" color="warningText" align="center" tabular>
              {t('partner.ic_req_cap_note', { amount: amountParam(cap) })}
            </Text>
          ) : null}
          <Rule />
          <View style={{ gap: theme.space[2] }}>
            <MoneyLine icon="wallet" text={t('partner.ic_req_deposit_note', { deposit: amountParam(deposit), cash: amountParam(price - deposit) })} />
            <MoneyLine icon="receipt" text={t('partner.ic_req_net', { net: amountParam(privateRideNet(price)) })} strong />
          </View>
        </View>
      </Card>
    </Screen>
  );
}

function MoneyLine({ icon, text, strong = false }: { icon: 'wallet' | 'receipt'; text: string; strong?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start' }}>
      <Icon name={icon} size={16} color="textMuted" style={{ marginTop: 3 }} />
      <Text variant="footnote" weight={strong ? 600 : 400} color={strong ? 'text' : 'textMuted'} style={{ flex: 1 }} tabular>
        {text}
      </Text>
    </View>
  );
}

function RideView({ ride }: { ride: DriverRequestRide }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const now = useNow(5_000);
  const actions = useRequestActions();
  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
  const noShowOpen = ride.riderNoShowAt !== null && ride.riderNoShowAt.getTime() <= now.getTime();
  const deposit = ride.depositIqd ?? 0;

  const arrived = async () => {
    const fix = await currentFix(5000);
    // The server records the GPS; without a fix (desktop) the pickup point itself stands in.
    const at = fix ?? (ride.from.lat !== undefined && ride.from.lng !== undefined ? { lat: ride.from.lat, lng: ride.from.lng } : null);
    if (!at) {
      toast.show({ message: t('partner.location_needed'), tone: 'warning' });
      return;
    }
    try {
      await actions.arrived.mutateAsync({ postId: ride.id, ...at });
      theme.haptic('success');
    } catch (err) {
      fail(err);
    }
  };
  const complete = async () => {
    try {
      await actions.complete.mutateAsync({ postId: ride.id });
      theme.haptic('success');
      toast.show({ message: t('partner.ic_ride_done', { amount: amountParam(privateRideNet(ride.priceIqd)) }), tone: 'success' });
    } catch (err) {
      fail(err);
    }
  };
  const noShow = async () => {
    try {
      await actions.riderNoShow.mutateAsync({ postId: ride.id });
      toast.show({ message: t('partner.ic_ride_noshow_done', { amount: amountParam(deposit) }), tone: 'neutral' });
    } catch (err) {
      fail(err);
    }
  };

  const live = ride.state === 'matched' || ride.state === 'driver_arrived';
  const footer =
    ride.state === 'matched' ? (
      <Button testID="ride-arrived" label={t('partner.ic_ride_arrived_cta')} icon="map-pin" size="lg" fullWidth loading={actions.arrived.isPending} onPress={() => void arrived()} />
    ) : ride.state === 'driver_arrived' ? (
      <View style={{ gap: theme.space[2] }}>
        <Button testID="ride-complete" label={t('partner.ic_ride_complete_cta')} icon="check" size="lg" fullWidth loading={actions.complete.isPending} onPress={() => void complete()} />
        <Button
          testID="ride-noshow"
          label={noShowOpen || !ride.riderNoShowAt ? t('partner.ic_ride_noshow_cta') : t('partner.ic_ride_noshow_wait', { time: timeWithPeriod(t, ride.riderNoShowAt) })}
          variant="ghost"
          disabled={!noShowOpen}
          loading={actions.riderNoShow.isPending}
          onPress={() => void noShow()}
        />
      </View>
    ) : (
      <Button label={t('partner.ic_back_board')} variant="secondary" size="lg" fullWidth onPress={() => (router.canGoBack() ? router.back() : router.replace('/intercity'))} />
    );

  return (
    <Screen testID="request-ride" edges={['bottom']} footer={footer}>
      <Stack.Screen options={{ title: t('partner.ic_ride_title'), headerRight: live ? () => <SosControl subject={{ kind: 'request', id: ride.id }} style={{ marginEnd: theme.space[3] }} /> : undefined }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <StatusPill label={rideState(t, ride.state)} tone={live ? 'accent' : ride.state === 'completed' ? 'success' : 'neutral'} live={live} />
      </View>
      <TripCard post={ride} />
      <Card padding={5} testID="ride-money">
        <View style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
            <Text variant="amount" tabular>
              {amountParam(ride.priceIqd)}
            </Text>
            <Text variant="label" color="textMuted">
              {t('quote.currency')}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.md, padding: theme.space[3] }}>
            <Icon name="wallet" size={20} color="accentText" />
            <Text variant="label" weight={700} color="accentText" style={{ flex: 1 }} tabular>
              {t('partner.ic_ride_collect', { amount: amountParam(ride.cashToCollectIqd) })}
            </Text>
          </View>
          <Text variant="footnote" color="textMuted" tabular>
            {[t('partner.ic_ride_deposit', { amount: amountParam(deposit) }), t('partner.ic_req_net', { net: amountParam(privateRideNet(ride.priceIqd)) })].join(' · ')}
          </Text>
        </View>
      </Card>
    </Screen>
  );
}
