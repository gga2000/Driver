import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PartnerOffer } from '@driver/contracts';
import { CountdownButton, Icon, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { DriverMap, type MapPin } from '@/features/map/DriverMap';
import { cargoLine, isRide, KIND_KEY, km, OFFER_SEEN_AFTER_MS, offerWarnTick, secondsLeft, VEHICLE_ICON, zoneName } from '@/features/work/logic';
import { offerDetailsOpen, offerLayout, offerSummary } from '@/features/work/offer-layout';
import { PayLines, PrepPill, RouteNodes } from '@/features/work/OfferParts';
import { useCurrentOffer, useOfferRoute, useOfferSeen, useRefreshWork, useRespond, useStatus } from '@/features/work/queries';
import { playNudgeChime, startOfferAlert, stopOfferAlert } from '@/lib/alert';
import { apiErrorCode, apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * The 2-second offer card (partner S-1, P-03, P-04): judged at a glance, answered with one thumb.
 * Top to bottom: the map (shrinks on short phones), a small "مو هسة" decline in the top-left corner,
 * far from a right thumb; the pay, huge; one line of total km and minutes with the cash to collect;
 * pickup → drop-off; the pay components folded under "تفاصيل الأجرة"; and a full-width accept whose
 * fill is the time left (15 s food / 20 s rides, from the server's deadline). The whole offer fits a
 * 360×740 phone without scrolling. Seen after 3 s in the foreground (`dispatch.offerSeen`); the
 * answer goes through `dispatch.respond`, the only accept path.
 */
export default function OfferScreen() {
  const status = useStatus();
  const offerQ = useCurrentOffer(true);
  // Keep the card on screen through the refetch that follows our answer.
  const [held, setHeld] = useState<PartnerOffer | null>(null);
  useEffect(() => {
    if (offerQ.data) setHeld(offerQ.data);
  }, [offerQ.data]);
  const offer = offerQ.data ?? held;

  useEffect(() => {
    if (offerQ.isFetched && !offerQ.data && !held) router.back();
  }, [offerQ.isFetched, offerQ.data, held]);

  if (!offer) return <View style={{ flex: 1 }} />;
  return <OfferCard offer={offer} vehicle={status.data?.vehicleClass ?? 'bike'} self={status.data?.position ?? null} />;
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
  const cargo = cargoLine(offer.rideCargo ?? [], t);
  const durationMs = offer.ringSec * 1000;
  const startedAt = offer.expiresAt.getTime() - durationMs;
  const [left, setLeft] = useState(() => secondsLeft(offer.expiresAt, Date.now()));
  const { height: windowHeight } = useWindowDimensions();

  // Alert (P-01): heavy haptic, then the doorbell and the vibration loop until he answers or the
  // offer goes (silent mode included on the phone); the last 5 s add a warning haptic every second.
  useEffect(() => {
    theme.haptic('heavy');
    startOfferAlert();
    const id = setInterval(() => setLeft(secondsLeft(offer.expiresAt, Date.now())), 250);
    return () => {
      clearInterval(id);
      stopOfferAlert();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.offerId]);
  // Ride step 3: the rider nudged this offer («راكب ينتظرك») — one soft chime when it lands, not on
  // an offer that opened already nudged (the doorbell is ringing for it anyway).
  const nudged = Boolean(offer.nudgedAt);
  const wasNudged = useRef(nudged);
  useEffect(() => {
    if (nudged && !wasNudged.current && !answered.current) playNudgeChime();
    wasNudged.current = nudged;
  }, [nudged]);
  useEffect(() => {
    if (offerWarnTick(left) && !answered.current) theme.haptic('warning');
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

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const answer = async (accept: boolean) => {
    if (answered.current) return;
    answered.current = true;
    stopOfferAlert();
    try {
      await respond.mutateAsync({ offerId: offer.offerId, accept });
      qc.setQueryData(api.partner.currentOffer.queryKey(), null);
      await refresh();
      if (accept) {
        theme.haptic('success');
        toast.show({ message: t('partner.offer_accepted'), tone: 'success', icon: 'check' });
        router.replace('/job');
      } else {
        toast.show({ message: t('partner.offer_declined'), tone: 'neutral' });
        close();
      }
    } catch (err) {
      const code = apiErrorCode(err);
      const message =
        code === 'offer_taken' ? t('partner.offer_taken') : code === 'offer_expired' ? t('partner.offer_missed') : code === 'over_cap' ? t('partner.cash_cap_reached') : apiErrorMessage(err, t('error.network'), locale);
      toast.show({ message, tone: 'warning' });
      qc.setQueryData(api.partner.currentOffer.queryKey(), null);
      void refresh();
      close();
    }
  };

  const onExpire = () => {
    if (answered.current) return;
    answered.current = true;
    stopOfferAlert();
    toast.show({ message: t('partner.offer_missed'), tone: 'warning', icon: 'clock' });
    qc.setQueryData(api.partner.currentOffer.queryKey(), null);
    void refresh();
    close();
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
  const sum = offerSummary(offer, vehicle, ride);
  const [details, setDetails] = useState(() => offerDetailsOpen(layout, { batch: Boolean(offer.batch), components: offer.pay.components.length }, windowHeight));
  const pickupZone = zoneName(offer.pickup.zoneId, locale, t);
  const dropoffZone = zoneName(offer.dropoff.zoneId, locale, t);
  const fromYou = offer.distanceToPickupKm === null ? null : sum.near ? t('partner.offer_near') : t('partner.offer_from_you', { km: km(offer.distanceToPickupKm) });
  const busy = respond.isPending;

  return (
    <View testID="offer" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ height: layout.mapHeight }}>
        <DriverMap self={self} vehicleIcon={VEHICLE_ICON[vehicle]} online pins={pins} route={self ? [self, ...route] : route} road={road.data?.polyline6 ?? null} topInset={84} bottomInset={44} maxZoom={15.4} testID="offer-map" />
        <SafeAreaView edges={['top']} pointerEvents="box-none" style={{ position: 'absolute', top: 0, start: 0, end: 0 }}>
          {/* Laid out physically on purpose: decline sits top-left, the far corner from a right thumb (P-03). */}
          <View pointerEvents="box-none" style={[column, { direction: 'ltr', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[2], paddingHorizontal: theme.space[4], paddingTop: theme.space[2] }]}>
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
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                minHeight: theme.hitTarget,
                paddingHorizontal: theme.space[4],
                borderRadius: theme.radius.pill,
                borderWidth: 1.5,
                borderColor: theme.colors.borderStrong,
                backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
                shadowColor: theme.colors.shadow,
                shadowOpacity: 0.12,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 },
                elevation: 3,
              })}
            >
              <Icon name="x" size={18} color="text" strokeWidth={2.2} />
              <Text variant="label" weight={600}>
                {t('partner.offer_not_now')}
              </Text>
            </Pressable>
            <View style={{ direction: theme.direction, flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <StatusPill label={t('partner.new_offer')} tone="accent" live size="md" />
              <StatusPill label={t(KIND_KEY[offer.vertical])} tone="neutral" icon={ride ? VEHICLE_ICON[vehicle] : 'bag'} size="md" />
            </View>
          </View>
        </SafeAreaView>
      </View>

      <View style={{ flex: 1, marginTop: -24, backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius['2xl'], borderTopRightRadius: theme.radius['2xl'] }}>
        <ScrollView contentContainerStyle={[column, { paddingHorizontal: theme.space[5], paddingTop: theme.space[5], paddingBottom: theme.space[3], gap: layout.compact ? theme.space[3] : theme.space[4] }]}>
          {/* 1 · what he earns, huge · 2 · how far and how long, and the cash */}
          <View style={{ gap: 2 }}>
            <Text
              testID="offer-pay"
              tabular
              weight={700}
              accessibilityLabel={`${t('partner.offer_you_earn')}: ${amountParam(offer.pay.totalIqd)} ${t('quote.currency')}`}
              style={{ fontSize: layout.payFontSize, lineHeight: layout.payLineHeight }}
            >
              {`${amountParam(offer.pay.totalIqd)} `}
              <Text variant="title" color="textMuted">
                {t('quote.currency')}
              </Text>
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space[2] }}>
              {sum.totalKm !== null && sum.minutes !== null ? (
                <Text testID="offer-summary" variant="title" tabular style={{ flexShrink: 1 }}>
                  {t('partner.offer_summary', { km: km(sum.totalKm), minutes: sum.minutes })}
                </Text>
              ) : null}
              {sum.collectIqd ? (
                <View testID="offer-cash" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[3], minHeight: 32 }}>
                  <Icon name="wallet" size={16} color="warningText" strokeWidth={2} />
                  <Text variant="label" weight={700} color="warningText" tabular>
                    {t('partner.offer_cash_chip', { amount: amountParam(sum.collectIqd) })}
                  </Text>
                </View>
              ) : sum.prepaid ? (
                <View testID="offer-cash" accessible accessibilityLabel={t('partner.offer_prepaid')} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: theme.colors.successTint, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[3], minHeight: 32 }}>
                  <Icon name="check" size={16} color="successText" strokeWidth={2.2} />
                  <Text variant="label" weight={700} color="successText">
                    {t('partner.offer_prepaid_chip')}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {offer.batch ? (
            <Animated.View entering={theme.reduceMotion ? undefined : FadeInDown.duration(260)} testID="offer-batch" style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center', backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="plus" size={18} color="onAccent" strokeWidth={2.6} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="label" weight={700} color="accentText" tabular>
                  {t('partner.offer_batch_title', { amount: amountParam(offer.batch.extraIqd, { sign: true }) })}
                </Text>
                <Text variant="caption" color="textMuted" numberOfLines={1}>
                  {t('partner.offer_batch_body')}
                </Text>
              </View>
            </Animated.View>
          ) : null}

          {/* Joy l9: a rider booked this ride and asked for him — it rings for him alone for a minute. */}
          {offer.favourite ? (
            <Animated.View entering={theme.reduceMotion ? undefined : FadeInDown.duration(260)} testID="offer-favourite" style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center', backgroundColor: theme.colors.liveTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="heart" size={18} color="liveText" strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="label" weight={700} color="liveText">
                  {t('partner.offer_favourite_title')}
                </Text>
                <Text variant="caption" color="textMuted">
                  {t('partner.offer_favourite_body')}
                </Text>
              </View>
            </Animated.View>
          ) : null}

          {/* Ride step 3: the rider tapped «نبّه السايق» on this offer. */}
          {nudged ? (
            <Animated.View entering={theme.reduceMotion ? undefined : FadeInDown.duration(260)} testID="offer-nudged" style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center', backgroundColor: theme.colors.liveTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bell" size={18} color="liveText" strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="label" weight={700} color="liveText">
                  {t('partner.offer_nudged_title')}
                </Text>
                <Text variant="caption" color="textMuted">
                  {t('partner.offer_nudged_body')}
                </Text>
              </View>
            </Animated.View>
          ) : null}

          {/* Ride idea x5: «عنده غراض: قنينة غاز» — so he knows there is room before he accepts. */}
          {cargo ? (
            <View testID="offer-cargo" style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center', backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bag" size={18} color="accentText" strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="label" weight={700} color="accentText">
                  {cargo}
                </Text>
                <Text variant="caption" color="textMuted">
                  {t('partner.offer_cargo_hint')}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Ride ideas c9/s3: booked for someone else — the name the booker gave, and who his calls reach. */}
          {offer.rider ? (
            <View testID="offer-rider" style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center', backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="user" size={18} color="text" strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="label" weight={700} numberOfLines={1}>
                  {t('partner.offer_for_rider_title', { name: offer.rider.name })}
                </Text>
                <Text variant="caption" color="textMuted">
                  {t('partner.offer_for_rider_body')}
                </Text>
              </View>
            </View>
          ) : null}

          {/* 3 · pickup → drop-off */}
          <RouteNodes
            gap={layout.compact ? theme.space[3] : theme.space[4]}
            top={
              <View testID="offer-pickup">
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                  <Text variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {offer.pickup.label ?? (ride ? (offer.rider?.name ?? t('partner.offer_rider')) : pickupZone)}
                  </Text>
                  {offer.merchant ? <PrepPill prep={offer.merchant} /> : null}
                </View>
                <Text variant="footnote" color="textMuted" numberOfLines={1} tabular>
                  {[t('partner.offer_pickup_zone', { place: pickupZone }), fromYou].filter(Boolean).join(' · ')}
                </Text>
              </View>
            }
            bottom={
              <View testID="offer-dropoff">
                <Text variant="title" numberOfLines={1}>
                  {ride ? dropoffZone : t('partner.offer_customer')}
                </Text>
                <Text variant="footnote" color="textMuted" numberOfLines={1} tabular>
                  {[t('partner.offer_dropoff_zone', { place: dropoffZone }), offer.tripKm !== null ? t('partner.offer_trip_km', { km: km(offer.tripKm) }) : null].filter(Boolean).join(' · ')}
                </Text>
              </View>
            }
          />

          {/* 4 · every pay component, folded under "تفاصيل الأجرة" */}
          <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border }}>
            <Pressable
              testID="offer-details"
              accessibilityRole="button"
              accessibilityState={{ expanded: details }}
              aria-expanded={details}
              onPress={() => {
                theme.haptic('selection');
                setDetails((d) => !d);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: theme.hitTarget }}
            >
              <Text variant="label" color="textMuted">
                {t('partner.offer_details')}
              </Text>
              <Icon name="chevron-down" size={18} color="textMuted" style={details ? { transform: [{ rotate: '180deg' }] } : undefined} />
            </Pressable>
            {details ? <PayLines pay={offer.pay} /> : null}
          </View>
        </ScrollView>

        {/* 5 · accept: one tap, the countdown drains inside it */}
        <SafeAreaView edges={['bottom']} style={{ backgroundColor: theme.colors.surface }}>
          <View style={[column, { paddingHorizontal: theme.space[4], paddingTop: theme.space[2], paddingBottom: theme.space[4] }]}>
            <CountdownButton
              testID="offer-accept"
              label={t('partner.accept')}
              startedAt={startedAt}
              durationMs={durationMs}
              onExpire={onExpire}
              loading={busy && respond.variables?.accept === true}
              disabled={busy}
              urgentHaptic={false}
              onPress={() => void answer(true)}
            />
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}
