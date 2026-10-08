import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PartnerOffer } from '@driver/contracts';
import { partnerServices } from '@driver/design-tokens';
import { HoldButton, Icon, Text, useTheme, useToast } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { DriverMap, type MapPin } from '@/features/map/DriverMap';
import { arrivedTooLate, batchMinutes, riderTripsKey, serviceOf, SLIP_URGENT_S, speakText, timeShare } from '@/features/offer/slip';
import { KitchenTime, PayChips, SERVICE_ICON, SlipBand, SlipNote, TimeBar } from '@/features/offer/SlipParts';
import { speakOffer, stopSpeaking } from '@/features/offer/speak';
import { cargoLine, isRide, KIND_KEY, km, msToNextSecond, OFFER_SEEN_AFTER_MS, secondsLeft, VEHICLE_ICON, zoneName } from '@/features/work/logic';
import { offerLayout, offerSummary } from '@/features/work/offer-layout';
import { RouteNodes } from '@/features/work/OfferParts';
import { useCurrentOffer, useOfferRoute, useOfferSeen, useRefreshWork, useRespond, useStatus } from '@/features/work/queries';
import { OFFER_REPEAT_MS, playNudgeChime, startOfferAlert, stopOfferAlert } from '@/lib/alert';
import { apiErrorCode, apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * The order slip (partner redesign o1–o15, S-1): judged at a glance, answered with one thumb. A small
 * map on top; then the slip in the service's colour (food saffron, taxi yellow, tuktuk plum, trips
 * brown and gold) with the cash to collect as a dark chip and the time left as a bar; the money huge
 * with its named parts as chips; the kitchen's time; one-line notes (second order on the way, the
 * rider's nudge, AC on a hot day, cargo); both stops with a landmark; and at the bottom, under the
 * right thumb, «ثبّت حتى تقبل» — held half a second, so a bump can't accept — with «مو هسة» beside it.
 * The order is read aloud after the first ring (o4). Seen after 3 s in the foreground
 * (`dispatch.offerSeen`); the answer goes through `dispatch.respond`, the only accept path.
 */
export default function OfferScreen() {
  const status = useStatus();
  const offerQ = useCurrentOffer(true);
  // Keep the slip on screen through the refetch that follows our answer.
  const [held, setHeld] = useState<PartnerOffer | null>(null);
  useEffect(() => {
    if (offerQ.data) setHeld(offerQ.data);
  }, [offerQ.data]);
  const offer = offerQ.data ?? held;

  useEffect(() => {
    if (offerQ.isFetched && !offerQ.data && !held) router.back();
  }, [offerQ.isFetched, offerQ.data, held]);

  if (!offer) return <View style={{ flex: 1 }} />;
  return <OfferCard key={offer.offerId} offer={offer} vehicle={status.data?.vehicleClass ?? 'bike'} self={status.data?.position ?? null} />;
}

function OfferCard({ offer, vehicle, self }: { offer: PartnerOffer; vehicle: keyof typeof VEHICLE_ICON; self: { lat: number; lng: number } | null }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const respond = useRespond();
  const seen = useOfferSeen();
  const refresh = useRefreshWork();
  const qc = useQueryClient();
  const api = useApi();
  const answered = useRef(false);
  const ride = isRide(offer.vertical);
  const service = serviceOf(offer.vertical);
  const color = partnerServices[theme.scheme === 'dark' ? 'ember' : 'sun'][service];
  const cargo = cargoLine(offer.rideCargo ?? [], t);
  const [now, setNow] = useState(() => Date.now());
  const left = secondsLeft(offer.expiresAt, now);
  const { height: windowHeight } = useWindowDimensions();

  const pickupZone = zoneName(offer.pickup.zoneId, locale, t);
  const dropoffZone = zoneName(offer.dropoff.zoneId, locale, t);
  const pickupTitle = offer.pickup.label ?? (ride ? t('partner.offer_rider') : pickupZone);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const drop = (message: string | null) => {
    qc.setQueryData(api.partner.currentOffer.queryKey(), null);
    void refresh();
    if (message) toast.show({ message, tone: 'neutral' });
    close();
  };

  // Alert (P-01, o4, o15): heavy haptic, the doorbell and the vibration loop until he answers or the
  // offer goes; with reading on, one ring, then the order read aloud, then the doorbell again.
  useEffect(() => {
    // l8: an offer that was over before it reached the screen is dropped — never a surprise order.
    if (arrivedTooLate(offer.expiresAt, Date.now())) {
      answered.current = true;
      drop(null);
      return;
    }
    // Bug b2: a message from the last offer never sits over a new one.
    toast.hide();
    theme.haptic('heavy');
    startOfferAlert();
    const speakAt = setTimeout(() => {
      if (answered.current) return;
      const spoke = speakOffer(speakText(offer, pickupTitle, t, locale), locale, () => {
        if (!answered.current) startOfferAlert();
      });
      if (spoke) stopOfferAlert();
    }, OFFER_REPEAT_MS - 100);
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      id = setTimeout(tick, msToNextSecond(offer.expiresAt, at));
    };
    id = setTimeout(tick, msToNextSecond(offer.expiresAt, Date.now()));
    return () => {
      clearTimeout(speakAt);
      clearTimeout(id);
      stopOfferAlert();
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.offerId]);

  // o11: the rider nudged this offer — its own soft chime when it lands, not on an offer that opened
  // already nudged (the doorbell is ringing for it anyway).
  const nudged = Boolean(offer.nudgedAt);
  const wasNudged = useRef(nudged);
  useEffect(() => {
    if (nudged && !wasNudged.current && !answered.current) playNudgeChime();
    wasNudged.current = nudged;
  }, [nudged]);

  // o6: a soft tick each of the last seconds; at zero the offer goes (o14: a neutral word, no score talk).
  useEffect(() => {
    if (answered.current) return;
    if (left > 0 && left <= SLIP_URGENT_S) theme.haptic('light');
    if (left <= 0) {
      answered.current = true;
      stopOfferAlert();
      stopSpeaking();
      drop(t('partner.slip_gone'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  // Seen = 3 s with the app in the foreground (edge-case §6). Counted only while active.
  useEffect(() => {
    if (offer.seen) return;
    let foreground = AppState.currentState === 'active' || AppState.currentState == null ? 0 : -1;
    let since = Date.now();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') since = Date.now();
      else if (foreground >= 0) foreground += Date.now() - since;
    });
    const id = setTimeout(() => {
      const ms = Math.max(0, foreground) + (AppState.currentState === 'active' || AppState.currentState == null ? Date.now() - since : 0);
      if (ms >= OFFER_SEEN_AFTER_MS) seen.mutate({ offerId: offer.offerId, foregroundMs: Math.round(ms) });
    }, OFFER_SEEN_AFTER_MS + 100);
    return () => {
      clearTimeout(id);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.offerId]);

  const answer = async (accept: boolean) => {
    if (answered.current) return;
    answered.current = true;
    stopOfferAlert();
    stopSpeaking();
    try {
      await respond.mutateAsync({ offerId: offer.offerId, accept });
      qc.setQueryData(api.partner.currentOffer.queryKey(), null);
      if (accept) {
        // Speed audit o3: straight to the job, which loads there (a skeleton), instead of waiting here on
        // three refetches. The old "no job" answer is reset so the job screen never flashes "it ended".
        void qc.resetQueries({ queryKey: api.partner.activeJob.queryKey() });
        void refresh();
        theme.haptic('success');
        toast.show({ message: t('partner.offer_accepted'), tone: 'success', icon: 'check' });
        router.replace('/job');
      } else {
        void refresh();
        toast.show({ message: t('partner.slip_gone'), tone: 'neutral' });
        close();
      }
    } catch (err) {
      const code = apiErrorCode(err);
      // l3 / l8: someone was faster, or the time ran out on the way — said kindly, never a surprise order.
      const message = code === 'offer_taken' ? t('partner.slip_taken') : code === 'offer_expired' ? t('partner.slip_ran_out') : code === 'over_cap' ? t('partner.cash_cap_reached') : apiErrorMessage(err, t('error.network'), locale);
      toast.show({ message, tone: code === 'offer_taken' || code === 'offer_expired' ? 'neutral' : 'warning' });
      qc.setQueryData(api.partner.currentOffer.queryKey(), null);
      void refresh();
      close();
    }
  };

  const pins = useMemo<MapPin[]>(() => {
    const out: MapPin[] = [];
    if (offer.pickup.pin) out.push({ at: offer.pickup.pin, kind: 'pickup', label: offer.pickup.label ?? zoneName(offer.pickup.zoneId, locale, t) });
    if (offer.dropoff.pin) out.push({ at: offer.dropoff.pin, kind: 'dropoff', label: zoneName(offer.dropoff.zoneId, locale, t) });
    return out;
  }, [offer, locale, t]);
  const route = pins.map((p) => p.at);
  // Maps program d2: the road to the kitchen (a person's door never shapes an offer's road).
  const road = useOfferRoute(offer.offerId);
  const column = { width: '100%' as const, maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' as const };
  const layout = offerLayout(windowHeight);
  // The slip carries more than the old card: the map gives way first.
  const mapHeight = Math.min(layout.mapHeight, layout.compact ? 150 : 210);
  const sum = offerSummary(offer, vehicle, ride);
  const fromYou = offer.distanceToPickupKm === null ? null : sum.near ? t('partner.offer_near') : t('partner.offer_from_you', { km: km(offer.distanceToPickupKm) });
  const extraMin = batchMinutes(offer, vehicle);
  const busy = respond.isPending;
  const share = timeShare(offer.expiresAt, offer.ringSec, now);
  const remainingMs = Math.max(0, offer.expiresAt.getTime() - now);
  const near = (place: string | null) => (place ? t('partner.slip_near', { place }) : null);

  return (
    <View testID="offer" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ height: mapHeight }}>
        <DriverMap self={self} vehicleIcon={VEHICLE_ICON[vehicle]} online pins={pins} route={self ? [self, ...route] : route} road={road.data?.polyline6 ?? null} topInset={24} bottomInset={36} maxZoom={15.4} testID="offer-map" />
      </View>

      <View testID="slip" style={{ flex: 1, marginTop: -20, backgroundColor: theme.colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' }}>
        <View style={column}>
          <SlipBand
            color={color}
            icon={SERVICE_ICON[service]}
            kind={t(KIND_KEY[offer.vertical])}
            isNew={t('partner.new_offer')}
            cash={sum.collectIqd ? t('partner.offer_cash_chip', { amount: amountParam(sum.collectIqd) }) : null}
            prepaid={!sum.collectIqd && sum.prepaid ? t('partner.offer_prepaid_chip') : null}
          />
        </View>
        <TimeBar share={share} remainingMs={remainingMs} urgent={left <= SLIP_URGENT_S} ink={color.ink} label={t('partner.slip_time_left', { seconds: Math.max(0, left) })} />

        <ScrollView contentContainerStyle={[column, { paddingHorizontal: theme.space[5], paddingTop: theme.space[4], paddingBottom: theme.space[3], gap: layout.compact ? theme.space[3] : theme.space[4] }]}>
          {/* o2 · what he earns, the biggest thing, with its named parts under it */}
          <View style={{ gap: theme.space[2] }}>
            <Text testID="offer-pay" tabular weight={700} accessibilityLabel={`${t('partner.offer_you_earn')}: ${amountParam(offer.pay.totalIqd)} ${t('quote.currency')}`} style={{ fontSize: layout.payFontSize + 6, lineHeight: layout.payLineHeight + 6, letterSpacing: -1 }}>
              {`${amountParam(offer.pay.totalIqd)} `}
              <Text variant="title" weight={700} color="textMuted">
                {t('quote.currency')}
              </Text>
            </Text>
            <PayChips pay={offer.pay} />
          </View>

          {/* o7 · how far and how long in total · o9 · the kitchen's time */}
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space[2] }}>
            {sum.totalKm !== null && sum.minutes !== null ? (
              <Text testID="offer-summary" variant="title" weight={600} tabular style={{ flexShrink: 1 }}>
                {t('partner.offer_summary', { km: km(sum.totalKm), minutes: sum.minutes })}
              </Text>
            ) : null}
            {offer.merchant ? <KitchenTime prep={offer.merchant} /> : null}
          </View>

          {/* o13 · a second order on the way: the money and roughly the minutes it adds */}
          {offer.batch ? (
            <SlipNote
              testID="offer-batch"
              icon="plus"
              title={t('partner.offer_batch_title', { amount: amountParam(offer.batch.extraIqd, { sign: true }) })}
              body={extraMin ? t('partner.slip_batch_minutes', { n: extraMin }) : t('partner.offer_batch_body')}
              bg={theme.colors.accentTint}
              ink={theme.colors.accentText}
            />
          ) : null}
          {/* Joy l9: a rider booked this ride and asked for him. */}
          {offer.favourite ? <SlipNote testID="offer-favourite" icon="heart" title={t('partner.offer_favourite_title')} body={t('partner.offer_favourite_body')} bg={color.tint} ink={color.ink} /> : null}
          {/* o11 · the rider nudged him: a gold line */}
          {nudged ? <SlipNote testID="offer-nudged" icon="bell" title={t('partner.offer_nudged_title')} body={t('partner.offer_nudged_body')} bg={partnerServices.sun.taxi.tint} ink={partnerServices.sun.taxi.ink} /> : null}
          {/* o12 · a hot (cold) day: switch the AC (heating) on before the rider gets in */}
          {offer.climate ? (
            <SlipNote testID="offer-climate" icon={offer.climate === 'ac' ? 'snow' : 'flame'} title={t(offer.climate === 'ac' ? 'partner.slip_climate_ac' : 'partner.slip_climate_heating')} bg={theme.colors.surfaceSunken} ink={theme.colors.text} enter={false} />
          ) : null}
          {/* Ride idea x5: «عنده غراض: قنينة غاز». */}
          {cargo ? <SlipNote testID="offer-cargo" icon="bag" title={cargo} body={t('partner.offer_cargo_hint')} bg={theme.colors.surfaceSunken} ink={theme.colors.text} enter={false} /> : null}
          {/* Ride ideas c9/s3: booked for someone else. */}
          {offer.rider ? <SlipNote testID="offer-rider" icon="user" title={t('partner.offer_for_rider_title', { name: offer.rider.name })} body={t('partner.offer_for_rider_body')} bg={theme.colors.surfaceSunken} ink={theme.colors.text} enter={false} /> : null}

          {/* o7 · both stops, each with the landmark people give directions by */}
          <RouteNodes
            gap={layout.compact ? theme.space[3] : theme.space[4]}
            top={
              <View testID="offer-pickup">
                <Text variant="title" weight={700} numberOfLines={1}>
                  {pickupTitle}
                </Text>
                <Text variant="footnote" color="textMuted" numberOfLines={2} tabular>
                  {[near(offer.pickup.landmark), t('partner.offer_pickup_zone', { place: pickupZone }), fromYou].filter(Boolean).join(' · ')}
                </Text>
              </View>
            }
            bottom={
              <View testID="offer-dropoff">
                <Text variant="title" weight={700} numberOfLines={1}>
                  {ride ? dropoffZone : t('partner.offer_customer')}
                </Text>
                <Text variant="footnote" color="textMuted" numberOfLines={2} tabular>
                  {[near(offer.dropoff.landmark), ride ? null : t('partner.offer_dropoff_zone', { place: dropoffZone }), offer.tripKm !== null ? t('partner.offer_trip_km', { km: km(offer.tripKm) }) : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            }
          />

          {/* o10 · rides: the fare is locked, and who the rider is to us (never his name before accepting) */}
          {ride && offer.vertical !== 'khat' ? (
            <View testID="offer-ride-trust" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space[2] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, minHeight: 30, backgroundColor: theme.colors.successTint }}>
                <Icon name="lock" size={14} color="successText" strokeWidth={2.2} />
                <Text variant="caption" weight={700} color="successText">
                  {t('partner.slip_fare_locked')}
                </Text>
              </View>
              {offer.riderTrips !== null ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 10, minHeight: 30, backgroundColor: theme.colors.surfaceSunken }}>
                  <Icon name="user" size={14} color="textMuted" strokeWidth={2} />
                  <Text variant="caption" weight={600} color="textMuted" tabular>
                    {t(riderTripsKey(offer.riderTrips), { n: offer.riderTrips })}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        {/* o3 / o5 · under the right thumb: hold to accept; «مو هسة» beside it, never in a far corner */}
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.colors.surface, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
          {/* Laid out physically on purpose: accept sits on the right, where a right thumb rests. */}
          <View style={[column, { direction: 'ltr', flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[4], paddingTop: theme.space[3], paddingBottom: theme.space[4] }]}>
            <Pressable
              testID="offer-decline"
              accessibilityRole="button"
              accessibilityLabel={t('partner.decline')}
              disabled={busy}
              onPress={() => {
                theme.haptic('light');
                void answer(false);
              }}
              style={({ pressed }) => ({
                direction: theme.direction,
                height: 72,
                width: 96,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                borderRadius: theme.radius.xl,
                borderWidth: 1.5,
                borderColor: theme.colors.borderStrong,
                backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
              })}
            >
              <Icon name="x" size={20} color="textMuted" strokeWidth={2.2} />
              <Text variant="label" weight={600} color="textMuted">
                {t('partner.slip_not_now')}
              </Text>
            </Pressable>
            <View style={{ flex: 1, direction: theme.direction }}>
              <HoldButton
                testID="offer-accept"
                label={t('partner.slip_hold')}
                holdHint={t('partner.slip_hold_hint')}
                confirmLabel={t('partner.slip_confirm')}
                trailing={String(Math.max(0, left))}
                loading={busy && respond.variables?.accept === true}
                disabled={busy}
                onConfirm={() => void answer(true)}
              />
            </View>
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}
