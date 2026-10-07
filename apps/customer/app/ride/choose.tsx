import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router, Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NEW_CUSTOMER_CAP_IQD } from '@/features/food/checkout';
import { afterFailure, attemptFor, newRequestKey, type PlaceAttempt } from '@/features/food/place-attempt';
import { Button, Chip, ChipGroup, Icon, IconButton, SegmentedControl, Text, TextField, useTheme } from '@driver/ui';
import { formatClock, formatHourPart, formatWhen } from '@driver/i18n';
import { bookedMemory } from '@/features/ride-habits/booked-memory';
import { favouritesFor, firstSlot, hourOptions, minuteOptions, scheduleAt, SCHEDULE_DAYS, settleChoice, type ScheduleChoice, type ScheduleDay } from '@/features/ride-habits/logic';
import { useFavourites } from '@/features/ride-habits/queries';
import { useWalletBalance } from '@/features/account/queries';
import { FarePanel, OptionsRow, PayOption, RideOptionsPanel, RouteSummary, SurchargeBanner, VehicleCard, VEHICLE } from '@/features/ride/ChooseParts';
import { buildRidePlaceInput, destinationPinKind, doorExtra, rideEstimate, rideProblem, RIDE_VERTICALS, surchargesOf, tuktukAvailability, walletCovers, zoneTitle, type RideVertical } from '@/features/ride/logic';
import { useCityConfig, useNearbyVehicles, usePlaceRide, useRideQuotes } from '@/features/ride/queries';
import { RideMap } from '@/features/ride/RideMap';
import { rideStore, useRideStore } from '@/features/ride/store';
import { useRideSpots } from '@/features/ride/useSpots';
import { apiErrorCode, apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { color as palette } from '@driver/design-tokens';

/**
 * Choose ride (customer spec §5; ride ideas c1–c7): the trip on the map, then on one screen تكسي and
 * تكتك as slim rows with the server's quote for each (`pricing.quote`, the engine `orders.place` locks
 * the fare with) and the clock you get there, one row for how you pay, where he picks you up and the
 * note (its sheet holds door pickup or "أطلع للشارع" with its price difference, cash or wallet, and
 * the note), the night / peak line when it applies, and «السعر مثبّت» under the button. Requests with the quoted fare; a fare that moved in between is
 * re-quoted and explained (`price_changed`), never charged silently.
 */
export default function RideChoose() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const lang = locale === 'en' ? 'en' : 'ar-IQ';
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const api = useApi();
  const qc = useQueryClient();
  const ride = useRideStore();
  const { defaultPickup } = useRideSpots();
  const d = ride.draft;
  const pickup = d.pickup ?? defaultPickup;
  const dropoff = d.dropoff;
  // Joy J7d: now, or booked for later (20 min – 7 days), quoted for that time; l9: a favourite asked first.
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [choice, setChoice] = useState<ScheduleChoice>(() => firstSlot(new Date()));
  const [favouriteId, setFavouriteId] = useState<string | null>(null);
  const settled = settleChoice(new Date(), choice);
  const bookedAtMs = when === 'later' ? scheduleAt(new Date(), settled).getTime() : null;
  const bookedAt = useMemo(() => (bookedAtMs === null ? null : new Date(bookedAtMs)), [bookedAtMs]);
  const quotes = useRideQuotes(pickup, dropoff, bookedAt);
  const favs = useFavourites();
  // Free vehicles around the pickup (maps program c10): the chosen kind on the map, the nearest one's minutes on each card.
  const nearby = { taxi: useNearbyVehicles(pickup?.pin ?? null, 'taxi'), tuktuk: useNearbyVehicles(pickup?.pin ?? null, 'tuktuk') };
  const city = useCityConfig();
  const wallet = useWalletBalance();
  const place = usePlaceRide();
  const [problem, setProblem] = useState<string | null>(null);
  const [details, setDetails] = useState<RideVertical | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // The arrival clocks on the rows («توصل 11:55») move with the minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const attemptRef = useRef<PlaceAttempt | null>(null);
  const inFlight = useRef(false);

  const tuktuk = pickup && dropoff ? tuktukAvailability(pickup.zoneId, dropoff.zoneId, d.allowEdgeTuktuk) : { ok: true, edgeZoneId: null };
  // Started from the tuktuk tile but the trip touches an edge zone: the car is the sure choice.
  const vertical: RideVertical = d.vertical === 'tuktuk' && !tuktuk.ok ? 'taxi' : d.vertical;
  const mode = d.doorPickup ? 'door' : 'street';
  const quote = quotes.grid[vertical][mode];
  const extra = doorExtra(quotes.grid[vertical].door, quotes.grid[vertical].street);
  const surcharges = surchargesOf(quote);
  const estimate = useMemo(() => (pickup && dropoff ? Object.fromEntries(RIDE_VERTICALS.map((v) => [v, rideEstimate(pickup.pin, dropoff.pin, v, new Date())])) : null), [pickup, dropoff]) as Record<RideVertical, { minutes: number }> | null;
  const vertFavs = favouritesFor(favs.data ?? [], vertical);
  const askFav = when === 'later' && favouriteId && vertFavs.some((f) => f.id === favouriteId) ? favouriteId : null;
  const balance = wallet.data?.moneyIqd ?? null;
  const walletOk = walletCovers(balance, quote?.total);

  useEffect(() => {
    // The wallet stopped covering the fare (door pickup, night): back to cash.
    if (d.payment === 'wallet' && quote && balance !== null && !walletOk) rideStore.update({ payment: 'cash' });
  }, [d.payment, quote, balance, walletOk]);

  useEffect(() => setProblem(null), [vertical, mode, d.payment]);

  if (!pickup || !dropoff) return <Redirect href="/ride" />;

  const taxiTotal = quotes.grid.taxi[mode]?.total;
  const tukTotal = quotes.grid.tuktuk[mode]?.total;
  const cheaper = taxiTotal != null && tukTotal != null ? taxiTotal - tukTotal : null;

  const request = async () => {
    if (!quote || inFlight.current) return;
    setProblem(null);
    // No duplicate rides: one key per request attempt, kept when the answer is lost so a second tap
    // gets the ride already requested (the server answers a repeated key with it).
    const attempt = attemptFor(attemptRef.current, `${vertical}|${pickup.pin.lat},${pickup.pin.lng}|${dropoff.pin.lat},${dropoff.pin.lng}|${bookedAtMs ?? 'now'}|${askFav ?? ''}`, () => newRequestKey('ride'));
    attemptRef.current = attempt;
    inFlight.current = true;
    try {
      const order = await place.mutateAsync(
        buildRidePlaceInput({ vertical, pickup, dropoff, doorPickup: d.doorPickup, fareIqd: quote.total, quoteId: quote.id, paymentMethod: d.payment, note: d.note, clientRequestId: attempt.key, scheduledFor: bookedAt, favouriteId: askFav }),
      );
      attemptRef.current = null;
      rideStore.placed(order.id, { vertical, from: pickup.title, to: dropoff.title, doorPickup: d.doorPickup, toHome: destinationPinKind(dropoff) === 'home' }, dropoff);
      void qc.invalidateQueries({ queryKey: api.orders.mine.queryKey() });
      if (router.canDismiss()) router.dismissAll();
      if (bookedAt) {
        bookedMemory.remember(order.id, pickup, dropoff);
        router.push({ pathname: '/ride/booked/[id]', params: { id: order.id } });
      } else router.push({ pathname: '/order/[id]', params: { id: order.id } });
    } catch (err) {
      attemptRef.current = afterFailure(attempt, apiErrorCode(err));
      const kind = rideProblem(apiErrorCode(err));
      if (kind === 'price_changed') {
        // Night started, or the city changed a fare, between the quote and the tap: show the new one.
        const fresh = await quotes.refetch();
        const idx = RIDE_VERTICALS.indexOf(vertical) * 2 + (d.doorPickup ? 0 : 1);
        const next = fresh[idx]?.data as { total: number } | undefined;
        setProblem(next ? t('ride.price_changed', { amount: amountParam(next.total) }) : t('error.price_changed'));
      } else if (kind === 'cash_cap') setProblem(t('ride.cash_cap', { amount: amountParam(NEW_CUSTOMER_CAP_IQD) }));
      else if (kind === 'location') setProblem(t('ride.location_problem'));
      else if (kind === 'wallet') setProblem(t('error.wallet_insufficient'));
      else if (kind === 'schedule') setProblem(t('error.ride_schedule_invalid'));
      else if (attemptRef.current) setProblem(t('checkout.lost_answer'));
      else setProblem(apiErrorMessage(err, t('error.network'), locale));
    } finally {
      inFlight.current = false;
    }
  };

  // c1: map, route, both vehicles, the options row and the button fit on one phone screen.
  const mapH = Math.round(Math.min(Math.max(Math.min(height * 0.4, height - 520), 170), 380));
  const edgeReason = tuktuk.edgeZoneId && !d.allowEdgeTuktuk ? t('ride.tuktuk_edge', { zone: zoneTitle(tuktuk.edgeZoneId, lang) }) : null;

  return (
    <View testID="ride-choose" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ height: mapH + theme.space[6] }}>
        <RideMap
          pickup={pickup.pin}
          dropoff={dropoff.pin}
          pickupLabel={t('ride.pickup_here')}
          dropoffLabel={dropoff.title}
          dropoffKind={destinationPinKind(dropoff)}
          topInset={insets.top}
          bottomInset={theme.space[6]}
          nearby={{ data: nearby[vertical].data, kind: vertical === 'tuktuk' ? 'tuktuk' : 'car' }}
          testID="ride-map"
        />
        <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + theme.space[3], left: theme.space[4], right: theme.space[4], flexDirection: 'row' }}>
          <IconButton icon="chevron-back" variant="outline" accessibilityLabel={t('action.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/ride'))} style={{ backgroundColor: theme.colors.surface }} testID="ride-choose-back" />
        </View>
      </View>

      <View
        style={{
          flex: 1,
          marginTop: -theme.space[6],
          backgroundColor: theme.colors.bg,
          borderTopLeftRadius: theme.radius['2xl'],
          borderTopRightRadius: theme.radius['2xl'],
          shadowColor: palette.neutral[1000],
          shadowOpacity: 0.1,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
          elevation: 10,
          overflow: 'hidden',
        }}
      >
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: theme.space[4], paddingTop: theme.space[3], gap: theme.space[3], width: '100%', maxWidth: 560, alignSelf: 'center' }} testID="ride-choose-body">
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, marginBottom: -theme.space[1] }} />
          <RouteSummary pickup={pickup} dropoff={dropoff} onEdit={() => (router.canGoBack() ? router.back() : router.replace('/ride'))} />

          {surcharges.map((s) => (
            <SurchargeBanner key={s.key} s={s} city={city.data ?? undefined} vertical={vertical} />
          ))}

          <View style={{ gap: theme.space[2] }} accessibilityRole="radiogroup">
            {RIDE_VERTICALS.map((v, i) => {
              const near = nearby[v].data?.nearestMinutes ?? null;
              const trip = estimate?.[v].minutes ?? null;
              return (
                <VehicleCard
                  key={v}
                  index={i}
                  vertical={v}
                  quote={quotes.grid[v][mode]}
                  loading={quotes.loading}
                  selected={vertical === v}
                  disabledReason={v === 'tuktuk' ? edgeReason : null}
                  minutes={trip}
                  nearMinutes={near}
                  arriveAt={trip ? new Date(now + ((near ?? 0) + trip) * 60_000) : null}
                  cheaperBy={v === 'tuktuk' ? cheaper : null}
                  onPress={() => rideStore.update({ vertical: v })}
                  onDetails={() => setDetails(v)}
                  onTryAnyway={v === 'tuktuk' ? () => rideStore.update({ allowEdgeTuktuk: true, vertical: 'tuktuk' }) : undefined}
                />
              );
            })}
            {vertical === 'tuktuk' && d.allowEdgeTuktuk && tuktuk.edgeZoneId ? (
              <Text variant="footnote" color="textMuted" testID="ride-tuktuk-tried">
                {t('ride.tuktuk_edge_tried')}
              </Text>
            ) : null}
          </View>

          <OptionsRow
            when={bookedAt ? formatWhen(bookedAt, new Date()) : null}
            payment={d.payment === 'wallet' ? t('ride.pay_wallet') : t('ride.pay_cash')}
            pickup={mode === 'door' ? (extra ? `${t('ride.pickup_door')} ${iqd(extra, { locale, sign: true })}` : t('ride.pickup_door')) : t('ride.pickup_street')}
            note={d.note}
            onPress={() => setOptionsOpen(true)}
          />
        </ScrollView>

        <View style={{ paddingHorizontal: theme.space[5], paddingTop: theme.space[3], paddingBottom: Math.max(insets.bottom, theme.space[3]), gap: theme.space[2], borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.bg }}>
          {problem ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2], width: '100%', maxWidth: 520, alignSelf: 'center' }} testID="ride-problem" accessibilityLiveRegion="polite">
              <Icon name="receipt" size={18} color="dangerText" />
              <Text variant="footnote" color="dangerText" style={{ flex: 1 }}>
                {problem}
              </Text>
            </View>
          ) : null}
          <Button
            testID="ride-request"
            size="lg"
            fullWidth
            label={
              quote
                ? bookedAt
                  ? t('ride.book_later', { vehicle: t(VEHICLE[vertical].name), when: formatWhen(bookedAt, new Date()), amount: amountParam(quote.total) })
                  : t('ride.request', { vehicle: t(VEHICLE[vertical].name), amount: amountParam(quote.total) })
                : t('ride.choose_title')
            }
            loading={place.isPending}
            loadingLabel={t('ride.requesting')}
            disabled={!quote}
            haptic="success"
            onPress={() => void request()}
            style={{ maxWidth: 520, alignSelf: 'center', width: '100%' }}
          />
          {quote ? (
            <View testID="ride-price-locked" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[1] }}>
              <Icon name="lock" size={13} color="textMuted" strokeWidth={2.2} />
              <Text variant="caption" color="textMuted">
                {t('ride.price_locked')}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {optionsOpen ? (
        <RideOptionsPanel onClose={() => setOptionsOpen(false)}>
          <View style={{ gap: theme.space[2] }}>
            <Text variant="label" weight={600} color="textMuted">
              {t('ride.pickup_mode')}
            </Text>
            <SegmentedControl
              accessibilityLabel={t('ride.pickup_mode')}
              value={mode}
              onChange={(m) => rideStore.update({ doorPickup: m === 'door' })}
              options={[
                { value: 'street', label: t('ride.pickup_street') },
                { value: 'door', label: extra ? `${t('ride.pickup_door')} ${iqd(extra, { locale, sign: true })}` : t('ride.pickup_door') },
              ]}
            />
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
              <Icon name={mode === 'door' ? 'home' : 'location-arrow'} size={15} color="textMuted" strokeWidth={2} />
              <Text variant="footnote" color="textMuted" style={{ flex: 1 }} testID="ride-pickup-hint">
                {mode === 'door' ? t('ride.pickup_door_hint', { amount: amountParam(extra ?? 0) }) : extra ? t('ride.pickup_street_hint', { amount: amountParam(extra) }) : t('ride.pickup_street_free')}
              </Text>
            </View>
          </View>

          <WhenPicker when={when} onWhen={setWhen} choice={settled} onChoice={setChoice} />

          {when === 'later' && vertFavs.length > 0 ? (
            <View style={{ gap: theme.space[2] }} testID="ride-fav">
              <Text variant="label" weight={600} color="textMuted">
                {t('ride.fav_title')}
              </Text>
              <ChipGroup
                accessibilityLabel={t('ride.fav_title')}
                mode="single"
                required
                value={[askFav ?? 'any']}
                onChange={(next) => setFavouriteId(next[0] === 'any' || !next[0] ? null : next[0])}
                items={[{ id: 'any', label: t('habits.favourite_any') }, ...vertFavs.map((f) => ({ id: f.id, label: f.firstName ?? t('habits.fav_unnamed'), icon: 'heart' as const }))]}
              />
              <Text variant="footnote" color="textMuted">
                {t('habits.favourite_hint')}
              </Text>
            </View>
          ) : null}

          <View style={{ gap: theme.space[2] }}>
            <Text variant="label" weight={600} color="textMuted">
              {t('checkout.payment')}
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.space[2] }} accessibilityRole="radiogroup">
              <PayOption icon="cash" title={t('ride.pay_cash')} subtitle={t('ride.pay_cash_hint')} selected={d.payment === 'cash'} onPress={() => rideStore.update({ payment: 'cash' })} testID="ride-pay-cash" />
              <PayOption
                icon="wallet"
                title={t('ride.pay_wallet')}
                subtitle={balance === null ? '…' : walletOk ? t('ride.wallet_balance', { amount: amountParam(balance) }) : t('ride.wallet_short', { amount: amountParam(balance) })}
                selected={d.payment === 'wallet'}
                disabled={!walletOk}
                onPress={() => rideStore.update({ payment: 'wallet' })}
                testID="ride-pay-wallet"
              />
            </View>
          </View>

          <TextField testID="ride-note" value={d.note} onChangeText={(note) => rideStore.update({ note })} placeholder={t('ride.note_placeholder')} leadingIcon="chat" maxLength={200} />
        </RideOptionsPanel>
      ) : null}
      {details && quotes.grid[details][mode] ? <FarePanel vertical={details} quote={quotes.grid[details][mode]!} city={city.data ?? undefined} locale={lang} onClose={() => setDetails(null)} /> : null}
    </View>
  );
}

/**
 * «وكتها» (joy J7d): هسة, or a time from 20 minutes to the day after tomorrow on the quarter hour (the
 * server takes 20 min – 7 days). The fare above is the server's quote for that time.
 */
function WhenPicker({ when, onWhen, choice, onChoice }: { when: 'now' | 'later'; onWhen: (w: 'now' | 'later') => void; choice: ScheduleChoice; onChoice: (c: ScheduleChoice) => void }) {
  const theme = useTheme();
  const t = useT();
  const now = new Date();
  const hours = hourOptions(now, choice.day);
  const minutes = minuteOptions(now, choice.day, choice.hour);
  const dayLabel = (day: ScheduleDay) => (day === 0 ? t('time.today') : day === 1 ? t('time.tomorrow') : t('ride.when_day_after'));
  return (
    <View style={{ gap: theme.space[2] }} testID="ride-when">
      <Text variant="label" weight={600} color="textMuted">
        {t('ride.when')}
      </Text>
      <SegmentedControl
        accessibilityLabel={t('ride.when')}
        value={when}
        onChange={onWhen}
        options={[
          { value: 'now', label: t('ride.when_now') },
          { value: 'later', label: t('ride.when_later') },
        ]}
      />
      {when === 'later' ? (
        <View style={{ gap: theme.space[2] }}>
          <SegmentedControl
            accessibilityLabel={t('ride.when_day')}
            value={String(choice.day) as '0' | '1' | '2'}
            onChange={(v) => onChoice(settleChoice(now, { ...choice, day: Number(v) as ScheduleDay }))}
            options={SCHEDULE_DAYS.filter((day) => hourOptions(now, day).length > 0).map((day) => ({ value: String(day) as '0' | '1' | '2', label: dayLabel(day) }))}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2] }} testID="ride-when-hours">
            {hours.map((h) => (
              <Chip key={h} role="radio" label={formatHourPart(scheduleAt(now, { day: choice.day, hour: h, minute: 0 }))} selected={choice.hour === h} onPress={() => onChoice(settleChoice(now, { ...choice, hour: h }))} testID={`ride-hour-${h}`} />
            ))}
          </ScrollView>
          <SegmentedControl
            accessibilityLabel={t('ride.when_minute')}
            value={String(choice.minute) as '0' | '15' | '30' | '45'}
            onChange={(v) => onChoice(settleChoice(now, { ...choice, minute: Number(v) }))}
            options={minutes.map((m) => ({ value: String(m) as '0' | '15' | '30' | '45', label: formatClock(scheduleAt(now, { ...choice, minute: m }), { period: false }) }))}
          />
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
            <Icon name="clock" size={15} color="liveText" strokeWidth={2} />
            <Text variant="footnote" color="textMuted" style={{ flex: 1 }} testID="ride-when-hint">
              {t('ride.later_hint')}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
