import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router, Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NEW_CUSTOMER_CAP_IQD } from '@/features/food/checkout';
import { afterFailure, attemptFor, newRequestKey, type PlaceAttempt } from '@/features/food/place-attempt';
import { Button, Icon, IconButton, SegmentedControl, Text, TextField, useTheme } from '@driver/ui';
import { useWalletBalance } from '@/features/account/queries';
import { FarePanel, PayOption, RouteSummary, SurchargeBanner, VehicleCard, VEHICLE } from '@/features/ride/ChooseParts';
import { buildRidePlaceInput, doorExtra, rideEstimate, rideProblem, RIDE_VERTICALS, surchargesOf, tuktukAvailability, walletCovers, zoneTitle, type RideVertical } from '@/features/ride/logic';
import { useCityConfig, usePlaceRide, useRideQuotes } from '@/features/ride/queries';
import { RideMap } from '@/features/ride/RideMap';
import { rideStore, useRideStore } from '@/features/ride/store';
import { useRideSpots } from '@/features/ride/useSpots';
import { apiErrorCode, apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { color as palette } from '@driver/design-tokens';

/**
 * Choose ride (customer spec §5): the trip on the map, تكسي and تكتك with the server's quote for
 * each (`pricing.quote`, the engine `orders.place` locks the fare with), the ride time, door pickup
 * or "أطلع للشارع" with its price difference, cash or wallet, a note for the driver, and the night /
 * peak line when it applies. Requests with the quoted fare; a fare that moved in between is
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
  const quotes = useRideQuotes(pickup, dropoff);
  const city = useCityConfig();
  const wallet = useWalletBalance();
  const place = usePlaceRide();
  const [problem, setProblem] = useState<string | null>(null);
  const [details, setDetails] = useState<RideVertical | null>(null);
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
    const attempt = attemptFor(attemptRef.current, `${vertical}|${pickup.pin.lat},${pickup.pin.lng}|${dropoff.pin.lat},${dropoff.pin.lng}`, () => newRequestKey('ride'));
    attemptRef.current = attempt;
    inFlight.current = true;
    try {
      const order = await place.mutateAsync(
        buildRidePlaceInput({ vertical, pickup, dropoff, doorPickup: d.doorPickup, fareIqd: quote.total, quoteId: quote.id, paymentMethod: d.payment, note: d.note, clientRequestId: attempt.key }),
      );
      attemptRef.current = null;
      rideStore.placed(order.id, { vertical, from: pickup.title, to: dropoff.title }, dropoff);
      void qc.invalidateQueries({ queryKey: api.orders.mine.queryKey() });
      if (router.canDismiss()) router.dismissAll();
      router.push({ pathname: '/order/[id]', params: { id: order.id } });
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
      else if (attemptRef.current) setProblem(t('checkout.lost_answer'));
      else setProblem(apiErrorMessage(err, t('error.network'), locale));
    } finally {
      inFlight.current = false;
    }
  };

  const mapH = Math.round(Math.min(Math.max(height * 0.36, 240), 380));
  const edgeReason = tuktuk.edgeZoneId && !d.allowEdgeTuktuk ? t('ride.tuktuk_edge', { zone: zoneTitle(tuktuk.edgeZoneId, lang) }) : null;

  return (
    <View testID="ride-choose" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ height: mapH + theme.space[6] }}>
        <RideMap pickup={pickup.pin} dropoff={dropoff.pin} pickupLabel={t('ride.pickup_here')} dropoffLabel={dropoff.title} topInset={insets.top} bottomInset={theme.space[6]} testID="ride-map" />
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
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: theme.space[5], paddingTop: theme.space[4], gap: theme.space[4], width: '100%', maxWidth: 560, alignSelf: 'center' }} testID="ride-choose-body">
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, marginBottom: -theme.space[1] }} />
          <RouteSummary pickup={pickup} dropoff={dropoff} onEdit={() => (router.canGoBack() ? router.back() : router.replace('/ride'))} />

          {surcharges.map((s) => (
            <SurchargeBanner key={s.key} s={s} city={city.data ?? undefined} vertical={vertical} />
          ))}

          <View style={{ gap: theme.space[2] }} accessibilityRole="radiogroup">
            {RIDE_VERTICALS.map((v) => (
              <VehicleCard
                key={v}
                vertical={v}
                quote={quotes.grid[v][mode]}
                loading={quotes.loading}
                selected={vertical === v}
                disabledReason={v === 'tuktuk' ? edgeReason : null}
                minutes={estimate?.[v].minutes ?? null}
                cheaperBy={v === 'tuktuk' ? cheaper : null}
                onPress={() => rideStore.update({ vertical: v })}
                onDetails={() => setDetails(v)}
                onTryAnyway={v === 'tuktuk' ? () => rideStore.update({ allowEdgeTuktuk: true, vertical: 'tuktuk' }) : undefined}
              />
            ))}
            {vertical === 'tuktuk' && d.allowEdgeTuktuk && tuktuk.edgeZoneId ? (
              <Text variant="footnote" color="textMuted" testID="ride-tuktuk-tried">
                {t('ride.tuktuk_edge_tried')}
              </Text>
            ) : null}
          </View>

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
                { value: 'door', label: extra ? `${t('ride.pickup_door')} ${amountParam(extra, { sign: true })}` : t('ride.pickup_door') },
              ]}
            />
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
              <Icon name={mode === 'door' ? 'home' : 'location-arrow'} size={15} color="textMuted" strokeWidth={2} />
              <Text variant="footnote" color="textMuted" style={{ flex: 1 }} testID="ride-pickup-hint">
                {mode === 'door' ? t('ride.pickup_door_hint', { amount: amountParam(extra ?? 0) }) : extra ? t('ride.pickup_street_hint', { amount: amountParam(extra) }) : t('ride.pickup_street_free')}
              </Text>
            </View>
          </View>

          <View style={{ gap: theme.space[2] }}>
            <Text variant="label" weight={600} color="textMuted">
              {t('checkout.payment')}
            </Text>
            <View style={{ flexDirection: 'row', gap: theme.space[2] }} accessibilityRole="radiogroup">
              <PayOption icon="wallet" title={t('ride.pay_cash')} subtitle={t('ride.pay_cash_hint')} selected={d.payment === 'cash'} onPress={() => rideStore.update({ payment: 'cash' })} testID="ride-pay-cash" />
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

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="shield" size={15} color="successText" strokeWidth={2.2} />
            <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
              {t('ride.cancel_policy')}
            </Text>
          </View>
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
            label={quote ? t('ride.request', { vehicle: t(VEHICLE[vertical].name), amount: amountParam(quote.total) }) : t('ride.choose_title')}
            loading={place.isPending}
            loadingLabel={t('ride.requesting')}
            disabled={!quote}
            haptic="success"
            onPress={() => void request()}
            style={{ maxWidth: 520, alignSelf: 'center', width: '100%' }}
          />
        </View>
      </View>

      {details && quotes.grid[details][mode] ? <FarePanel vertical={details} quote={quotes.grid[details][mode]!} city={city.data ?? undefined} locale={lang} onClose={() => setDetails(null)} /> : null}
    </View>
  );
}
