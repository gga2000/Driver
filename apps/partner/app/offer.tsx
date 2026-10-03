import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PartnerOffer } from '@driver/contracts';
import { Button, CountdownRing, Icon, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { DriverMap, type MapPin } from '@/features/map/DriverMap';
import { isRide, KIND_KEY, km, OFFER_SEEN_AFTER_MS, secondsLeft, VEHICLE_ICON, zoneName } from '@/features/work/logic';
import { MetaChip, PayLines, PrepPill, RouteNodes } from '@/features/work/OfferParts';
import { useCurrentOffer, useOfferSeen, useRefreshWork, useRespond, useStatus } from '@/features/work/queries';
import { playOfferChime } from '@/lib/alert';
import { apiErrorCode, apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * The offer (partner spec: full-screen card). Map preview of pickup → dropoff, the ring (15 s
 * food / 20 s rides, from the server's deadline), pay with every component, distance to pickup,
 * the kitchen's state, cash to collect, a batch banner ("طلب ثاني على طريقك +700"), and two big
 * answers. It counts as seen after 3 s in the foreground (`dispatch.offerSeen`); the answer goes
 * through `dispatch.respond`, the only accept path.
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
  const durationMs = offer.ringSec * 1000;
  const startedAt = offer.expiresAt.getTime() - durationMs;
  const [left, setLeft] = useState(() => secondsLeft(offer.expiresAt, Date.now()));

  // Alert: heavy haptic + chime on arrival, again with 5 s left.
  useEffect(() => {
    theme.haptic('heavy');
    playOfferChime();
    const id = setInterval(() => setLeft(secondsLeft(offer.expiresAt, Date.now())), 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer.offerId]);
  useEffect(() => {
    if (left === 5) playOfferChime();
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
  const column = { width: '100%' as const, maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' as const };

  return (
    <View testID="offer" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <View style={{ height: 300 }}>
        <DriverMap self={self} vehicleIcon={VEHICLE_ICON[vehicle]} online pins={pins} route={self ? [self, ...route] : route} topInset={92} bottomInset={70} maxZoom={15.4} testID="offer-map" />
        <SafeAreaView edges={['top']} pointerEvents="box-none" style={{ position: 'absolute', top: 0, start: 0, end: 0 }}>
          <View style={[column, { flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[4], paddingTop: theme.space[2] }]}>
            <StatusPill label={t('partner.new_offer')} tone="accent" live size="md" />
            <StatusPill label={t(KIND_KEY[offer.vertical])} tone="neutral" icon={ride ? VEHICLE_ICON[vehicle] : 'bag'} size="md" />
          </View>
        </SafeAreaView>
      </View>

      <View style={{ flex: 1, marginTop: -28, backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius['2xl'], borderTopRightRadius: theme.radius['2xl'] }}>
        {/* The ring sits on the seam between map and card, end side. */}
        <View style={{ position: 'absolute', top: -52, end: theme.space[5], width: 104, height: 104, borderRadius: 52, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', zIndex: 2, shadowColor: theme.colors.shadow, shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
          <CountdownRing mode="accept" startedAt={startedAt} durationMs={durationMs} size={92} strokeWidth={8} onExpire={onExpire} testID="offer-ring" />
        </View>

        <ScrollView contentContainerStyle={[column, { padding: theme.space[5], paddingTop: theme.space[5], gap: theme.space[4] }]}>
          <View style={{ gap: 2, paddingEnd: 110 }}>
            <Text variant="label" color="textMuted">
              {t('partner.offer_you_earn')}
            </Text>
            <Text testID="offer-pay" tabular weight={700} style={{ fontSize: 44, lineHeight: 60 }}>
              {`${amountParam(offer.pay.totalIqd)} `}
              <Text variant="title" color="textMuted">
                {t('quote.currency')}
              </Text>
            </Text>
          </View>

          {offer.batch ? (
            <Animated.View entering={theme.reduceMotion ? undefined : FadeInDown.duration(260)} testID="offer-batch" style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center', backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
              <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="plus" size={20} color="onAccent" strokeWidth={2.6} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="label" weight={700} color="accentText" tabular>
                  {t('partner.offer_batch_title', { amount: amountParam(offer.batch.extraIqd, { sign: true }) })}
                </Text>
                <Text variant="caption" color="textMuted">
                  {t('partner.offer_batch_body')}
                </Text>
              </View>
            </Animated.View>
          ) : null}

          <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
            <PayLines pay={offer.pay} />
          </View>

          <RouteNodes
            top={
              <View style={{ gap: theme.space[1] }}>
                <Text variant="caption" color="textMuted">
                  {t('partner.offer_pickup_zone', { place: zoneName(offer.pickup.zoneId, locale, t) })}
                </Text>
                <Text variant="title" numberOfLines={1}>
                  {offer.pickup.label ?? (ride ? t('partner.offer_rider') : zoneName(offer.pickup.zoneId, locale, t))}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                  {offer.distanceToPickupKm !== null ? <MetaChip icon="location-arrow" label={t('partner.offer_from_you', { km: km(offer.distanceToPickupKm) })} /> : null}
                  {offer.merchant ? <PrepPill prep={offer.merchant} /> : null}
                </View>
              </View>
            }
            bottom={
              <View style={{ gap: theme.space[1] }}>
                <Text variant="caption" color="textMuted">
                  {t('partner.offer_dropoff_zone', { place: zoneName(offer.dropoff.zoneId, locale, t) })}
                </Text>
                <Text variant="title">{ride ? zoneName(offer.dropoff.zoneId, locale, t) : t('partner.offer_customer')}</Text>
                {offer.tripKm !== null ? (
                  <View style={{ flexDirection: 'row' }}>
                    <MetaChip icon="map-pin" label={t('partner.offer_trip_km', { km: km(offer.tripKm) })} />
                  </View>
                ) : null}
              </View>
            }
          />

          {!ride || offer.collectIqd ? (
            <View
              testID="offer-cash"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space[3],
                borderRadius: theme.radius.lg,
                padding: theme.space[3],
                backgroundColor: offer.collectIqd ? theme.colors.warningTint : theme.colors.successTint,
              }}
            >
              <Icon name="wallet" size={22} color={offer.collectIqd ? 'warningText' : 'successText'} />
              <Text variant="label" weight={600} color={offer.collectIqd ? 'warningText' : 'successText'} style={{ flex: 1 }}>
                {offer.collectIqd ? t('partner.offer_collect') : t('partner.offer_prepaid')}
              </Text>
              {offer.collectIqd ? (
                <Text variant="title" tabular color="warningText">
                  {`${amountParam(offer.collectIqd)} ${t('quote.currency')}`}
                </Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        <SafeAreaView edges={['bottom']} style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
          <View style={[column, { flexDirection: 'row', gap: theme.space[3], padding: theme.space[4] }]}>
            <Button testID="offer-decline" label={t('partner.decline')} variant="secondary" size="lg" style={{ flex: 1 }} disabled={respond.isPending} haptic="light" onPress={() => void answer(false)} />
            <Button
              testID="offer-accept"
              label={t('partner.accept')}
              size="lg"
              icon="check"
              style={{ flex: 2 }}
              loading={respond.isPending && respond.variables?.accept === true}
              trailing={`${left}`}
              haptic="medium"
              onPress={() => void answer(true)}
            />
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}
