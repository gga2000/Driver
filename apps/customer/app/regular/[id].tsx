import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { CalendarDate, type OccurrenceView, type RegularPoint } from '@driver/contracts';
import { formatClock, formatDay, formatWhen } from '@driver/i18n';
import { Button, Card, EmptyState, Icon, RetryState, retryKindFor, SketchScene, Skeleton, StatusPill, Text, useNetwork, useNow, useTheme } from '@driver/ui';
import { GuestGate } from '@/components/GuestGate';
import { Screen } from '@/components/Screen';
import { newRequestKey } from '@/features/food/place-attempt';
import { DepartureTile } from '@/features/rajaa/DepartureTile';
import { useDriverCards } from '@/features/rajaa/queries';
import { DriverFace, regularRoute } from '@/features/ride-habits/Cards';
import { occurrenceAction, searchStartsAt } from '@/features/ride-habits/logic';
import { useConfirmOccurrence, useOccurrence, useSkipOccurrence } from '@/features/ride-habits/queries';
import type { Spot } from '@/features/ride/logic';
import { rideStore } from '@/features/ride/store';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { appNow } from '@/lib/dev-clock';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useSignedIn } from '@/lib/session';

/**
 * One day of a regular trip (joy r5), opened from «تأكد رحلتك؟» or the trip's card: what «أكدها»
 * books — a ride for later at the server's fare for that time (with the favourite asked first), or a
 * seat on one of that day's cars (the favourite's first), or «أريد أرجع» when no car is announced yet —
 * and «مو هالمرة». Nothing is ever booked without the tap.
 */
export default function OccurrencePage() {
  return useSignedIn() ? <Occurrence /> : <GuestGate kind="account" />;
}

function Occurrence() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const params = useLocalSearchParams<{ id: string; date?: string }>();
  const date = CalendarDate.safeParse(params.date);
  const q = useOccurrence(params.id, date.success ? date.data : undefined);
  const tick = useNow(true, 30_000);
  const now = useMemo(() => appNow(tick), [tick]);
  const v = q.data;

  if (!date.success) return <EmptyState icon="refresh" title={t('habits.occ_load_error')} action={{ label: t('habits.regular_title'), onPress: () => router.replace('/regular') }} />;

  return (
    <Screen edges={['bottom']} testID="occurrence" contentStyle={{ gap: theme.space[4] }}>
      {q.isError && !v ? (
        <RetryState
          kind={retryKindFor({ net, error: q.error })}
          locale={locale}
          art={net.state !== 'online' ? <SketchScene name="offline" /> : undefined}
          {...(retryKindFor({ net, error: q.error }) === 'server' ? { title: t('habits.occ_load_error') } : {})}
          onRetry={() => void q.refetch()}
        />
      ) : !v ? (
        <View style={{ gap: theme.space[3] }} testID="occurrence-loading">
          <Skeleton height={110} />
          <Skeleton height={140} />
          <Skeleton height={56} />
        </View>
      ) : (
        <Body v={v} now={now} />
      )}
    </Screen>
  );
}

function Header({ v, now }: { v: OccurrenceView; now: Date }) {
  const theme = useTheme();
  const t = useT();
  const plan = v.trip.plan;
  const icon = plan.kind === 'rajaa' ? 'rajaa' : plan.rideVertical === 'tuktuk' ? 'tuktuk' : 'taxi';
  return (
    <Card padding={4} elevation={1} testID="occurrence-head">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 52, height: 52, borderRadius: theme.radius.lg, backgroundColor: theme.colors.liveTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={28} color="liveText" />
        </View>
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text variant="caption" weight={600} color="liveText">
            {formatDay(v.occurrence.at, now)}
          </Text>
          <Text variant="heading" tabular testID="occurrence-time">
            {formatClock(v.occurrence.at)}
          </Text>
          <Text variant="bodyStrong" numberOfLines={2}>
            {regularRoute(t, v.trip)}
          </Text>
        </View>
      </View>
    </Card>
  );
}

function Body({ v, now }: { v: OccurrenceView; now: Date }) {
  const action = occurrenceAction(v.occurrence);
  if (action === 'booked') return <Booked v={v} now={now} />;
  if (action === 'skipped' || action === 'closed') return <Passed v={v} now={now} closed={action === 'closed'} />;
  return v.trip.plan.kind === 'ride' ? <ConfirmRide v={v} now={now} /> : <ConfirmSeat v={v} now={now} />;
}

/** The favourite asked first, with his face. */
function FavouriteLine({ v }: { v: OccurrenceView }) {
  const theme = useTheme();
  const t = useT();
  const f = v.trip.favourite;
  if (!f) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }} testID="occurrence-fav">
      <DriverFace name={f.firstName} photoUrl={f.photoUrl} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{t('habits.occ_fav', { name: f.firstName ?? t('habits.fav_unnamed') })}</Text>
        <Text variant="caption" color="textMuted">
          {t('habits.favourite_hint')}
        </Text>
      </View>
    </View>
  );
}

function useActions(v: OccurrenceView) {
  const t = useT();
  const locale = useLocale();
  const confirm = useConfirmOccurrence();
  const skip = useSkipOccurrence();
  const key = useRef<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = (extra: { fareIqd?: number; departureId?: string; waitForCar?: boolean }, after?: (view: OccurrenceView) => void) => {
    setProblem(null);
    key.current ??= newRequestKey('rgt');
    confirm.mutate(
      { id: v.trip.id, date: v.occurrence.date, clientRequestId: key.current, ...extra },
      {
        onSuccess: (view) => {
          key.current = null;
          after?.(view);
        },
        onError: (e) => {
          const code = apiErrorCode(e);
          // A changed fare or a car that filled up is re-read before the next tap (a fresh key with it).
          if (code === 'price_changed' || code === 'seat_unavailable') key.current = null;
          setProblem(code === 'price_changed' ? t('habits.occ_price_changed') : apiErrorMessage(e, t('error.network'), locale));
        },
      },
    );
  };
  const pass = () => skip.mutate({ id: v.trip.id, date: v.occurrence.date }, { onError: (e) => setProblem(apiErrorMessage(e, t('error.network'), locale)) });
  return { run, pass, problem, confirming: confirm.isPending, skipping: skip.isPending };
}

function Problem({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <Text variant="footnote" color="dangerText" testID="occurrence-problem" accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

function ConfirmRide({ v, now }: { v: OccurrenceView; now: Date }) {
  const theme = useTheme();
  const t = useT();
  const a = useActions(v);
  const plan = v.trip.plan;
  const fare = v.ride?.fareIqd ?? null;
  const remember = (view: OccurrenceView) => {
    if (plan.kind === 'ride' && view.occurrence.orderId) rideStore.remember(view.occurrence.orderId, { vertical: plan.rideVertical, from: plan.pickup.label, to: plan.dropoff.label, doorPickup: plan.doorPickup });
  };
  return (
    <>
      <Header v={v} now={now} />
      <Card padding={4} elevation={0} testID="occurrence-fare">
        <View style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] }}>
            <Text variant="label" color="textMuted">
              {t('habits.occ_fare')}
            </Text>
            <Text variant="title" tabular testID="occurrence-fare-amount">
              {fare !== null ? t('habits.amount', { amount: amountParam(fare) }) : '…'}
            </Text>
          </View>
          <Text variant="footnote" color="textMuted">
            {[v.trip.paymentMethod === 'wallet' ? t('ride.pay_wallet') : t('ride.pay_cash'), plan.kind === 'ride' && plan.doorPickup ? t('habits.door') : null, t('habits.occ_server_price')].filter(Boolean).join(' · ')}
          </Text>
          <FavouriteLine v={v} />
        </View>
      </Card>
      {v.occurrence.state === 'waiting' ? (
        <Text variant="footnote" color="textMuted" testID="occurrence-early">
          {t('habits.occ_early', { when: formatWhen(v.occurrence.askAt, now) })}
        </Text>
      ) : null}
      <Problem text={a.problem} />
      <Button testID="occurrence-confirm" size="lg" haptic="success" label={fare !== null ? t('habits.occ_confirm_ride', { amount: amountParam(fare) }) : t('habits.confirm_cta')} disabled={fare === null} loading={a.confirming} fullWidth onPress={() => fare !== null && a.run({ fareIqd: fare }, remember)} />
      <Button testID="occurrence-skip" variant="ghost" label={t('habits.occ_skip')} loading={a.skipping} onPress={a.pass} />
    </>
  );
}

function ConfirmSeat({ v, now }: { v: OccurrenceView; now: Date }) {
  const theme = useTheme();
  const t = useT();
  const a = useActions(v);
  const departures = useMemo(() => (v.rajaa?.departures ?? []).filter((d) => d.fill.free > 0), [v.rajaa]);
  const favDriver = v.trip.favourite?.driverId ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!picked || !departures.some((d) => d.id === picked)) setPicked(departures[0]?.id ?? null);
  }, [departures, picked]);
  const cards = useDriverCards(departures.map((d) => d.id));
  const driverOf = (id: string) => cards.data?.get(id);
  const chosen = departures.find((d) => d.id === picked) ?? null;

  return (
    <>
      <Header v={v} now={now} />
      <FavouriteLine v={v} />
      {departures.length === 0 ? (
        <Card padding={4} elevation={0} testID="occurrence-no-cars">
          <View style={{ gap: theme.space[2] }}>
            <Text variant="bodyStrong">{t('habits.occ_no_cars')}</Text>
            <Text variant="footnote" color="textMuted">
              {t('habits.occ_wait_hint')}
            </Text>
          </View>
        </Card>
      ) : (
        <View style={{ gap: theme.space[3] }} accessibilityRole="radiogroup">
          <Text variant="label" weight={600} color="textMuted">
            {t('habits.occ_cars')}
          </Text>
          {departures.map((d) => (
            <DepartureTile key={d.id} dep={d} now={now} driver={driverOf(d.id)} favourite={d.driverId === favDriver} selected={d.id === picked} onPress={() => setPicked(d.id)} />
          ))}
        </View>
      )}
      <Problem text={a.problem} />
      {departures.length === 0 ? (
        <Button testID="occurrence-wait" size="lg" label={t('habits.occ_wait_car')} loading={a.confirming} fullWidth onPress={() => a.run({ waitForCar: true })} />
      ) : (
        <Button testID="occurrence-confirm" size="lg" haptic="success" label={chosen ? t('habits.occ_confirm_seat', { time: formatClock(chosen.departAt), amount: amountParam(chosen.seatPriceIqd) }) : t('habits.occ_pick_car')} disabled={!chosen} loading={a.confirming} fullWidth onPress={() => chosen && a.run({ departureId: chosen.id })} />
      )}
      <Button testID="occurrence-skip" variant="ghost" label={t('habits.occ_skip')} loading={a.skipping} onPress={a.pass} />
    </>
  );
}

function Booked({ v, now }: { v: OccurrenceView; now: Date }) {
  const theme = useTheme();
  const t = useT();
  const o = v.occurrence;
  const starts = searchStartsAt({ scheduledFor: o.at });
  const line = o.orderId ? t('habits.occ_booked_ride', { time: starts ? formatClock(starts) : '' }) : o.bookingId ? t('habits.occ_booked_seat') : t('habits.occ_booked_demand');
  const go = () => {
    if (o.orderId) router.push({ pathname: '/ride/booked/[id]', params: { id: o.orderId } });
    else if (o.bookingId) router.push({ pathname: '/rajaa/pass/[id]', params: { id: o.bookingId } });
    else router.push('/rajaa/demand');
  };
  return (
    <>
      <Header v={v} now={now} />
      <Card padding={4} elevation={1} testID="occurrence-booked">
        <View style={{ gap: theme.space[3], alignItems: 'flex-start' }}>
          <StatusPill tone="success" icon="check" label={t('habits.occ_booked')} />
          <Text variant="bodyStrong">{line}</Text>
          <FavouriteLine v={v} />
        </View>
      </Card>
      <Button testID="occurrence-view" size="lg" label={o.orderId ? t('habits.occ_view_booking') : o.bookingId ? t('habits.occ_view_pass') : t('habits.occ_view_demand')} fullWidth onPress={go} />
      <Button testID="occurrence-all" variant="ghost" label={t('habits.regular_title')} onPress={() => router.replace('/regular')} />
    </>
  );
}

function Passed({ v, now, closed }: { v: OccurrenceView; now: Date; closed: boolean }) {
  const theme = useTheme();
  const t = useT();
  const plan = v.trip.plan;
  const rideNow = () => {
    if (plan.kind === 'ride') {
      rideStore.update({ vertical: plan.rideVertical, doorPickup: plan.doorPickup, pickup: spotOf(plan.pickup, 'from'), dropoff: spotOf(plan.dropoff, 'to') });
      router.push('/ride/choose');
    } else router.push('/rajaa');
  };
  return (
    <>
      <Header v={v} now={now} />
      <Card padding={4} elevation={0} testID={closed ? 'occurrence-closed' : 'occurrence-skipped'}>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="bodyStrong">{closed ? t('habits.occ_closed') : t('habits.occ_skipped')}</Text>
          {v.trip.next ? (
            <Text variant="footnote" color="textMuted">
              {t('habits.next_waiting', { when: formatWhen(v.trip.next.at, now) })}
            </Text>
          ) : null}
        </View>
      </Card>
      {closed ? <Button testID="occurrence-now" size="lg" label={plan.kind === 'ride' ? t('habits.occ_ride_now') : t('habits.occ_rajaa_now')} fullWidth onPress={rideNow} /> : null}
      <Button testID="occurrence-all" variant="ghost" label={t('habits.regular_title')} onPress={() => router.replace('/regular')} />
    </>
  );
}

/** A regular trip's end as the ride flow's place. */
function spotOf(p: RegularPoint, tag: string): Spot {
  return { id: p.placeId ? `saved:${p.placeId}` : `regular-${tag}`, kind: p.placeId ? 'saved' : 'pin', title: p.label, zoneId: p.zoneKey, pin: p.pin };
}
