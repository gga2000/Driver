import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, EmptyState, Icon, IconButton, initialOf, Skeleton, Text, useLiteMode, useNetwork as useNet, useTheme, useToast } from '@driver/ui';
import { useMe } from '@/features/account/queries';
import { cityName, plate, routeLabel, seatsList } from '@/features/rajaa/labels';
import { stopNameOf } from '@/features/rajaa/agree';
import { clockLabel, endpoints, publicPlaceName } from '@/features/rajaa/logic';
import { passPhase } from '@/features/rajaa/pass';
import { endGarageFor } from '@/features/rajaa/road';
import { bookingRoadTrip } from '@/features/rajaa/road-trip';
import { ROAD_MAP, ROAD_TILT, RoadMap } from '@/features/rajaa/RoadMap';
import { namesList } from '@/features/rajaa/RoadParts';
import { roadWords, TownRail } from '@/features/rajaa/RoadTripParts';
import { garageName, useBoardingPass, useBooking, useDriverCards, useNetwork } from '@/features/rajaa/queries';
import { shareUrl } from '@/features/rajaa/share';
import { useNow } from '@/features/rajaa/useNow';
import { SosControl } from '@/features/safety/SosControl';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

const TOP_BAR = 56;
const SHADOW = '0 2px 8px rgba(40,24,8,0.18)';
const MIN = 60_000;
/** The car's place is called old after this long without a new one. */
const STALE_MIN = 2;

/**
 * «الطريق كله» (map idea N13, view A) and «الشباك» (view B): a الرجعة booking's whole road on the map,
 * the driven part gold and the rest a cream dash, the towns as chips and the car with what was passed
 * and what is left; the sheet says when it reaches, what comes next and each town's time, and shares the
 * trip. «شوف قدامك» tilts the camera behind the car down the road (not in lite mode). Only this rider's
 * road, driver and plate: never other riders' names or stops.
 */
export default function RoadScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const client = useApiClient();
  const insets = useSafeAreaInsets();
  const lite = useLiteMode();
  const net = useNet();
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookingId = String(id ?? '');
  const booking = useBooking(bookingId);
  const b = booking.data ?? null;
  const live = !!b && (b.state === 'booked' || b.state === 'checked_in');
  const pass = useBoardingPass(bookingId, live);
  const network = useNetwork();
  const driverCard = useDriverCards(b ? [b.departure.id] : []).data?.get(b?.departure.id ?? '');
  const me = useMe();
  const now = useNow(5000);
  const [view, setView] = useState<'whole' | 'window'>('whole');
  const [failed, setFailed] = useState(false);
  const [sheetH, setSheetH] = useState(320);

  const back = () => (router.canGoBack() ? router.back() : router.replace(bookingId ? `/rajaa/pass/${bookingId}` : '/rajaa'));
  const centred = (node: React.ReactNode) => <View style={{ flex: 1, justifyContent: 'center', paddingTop: insets.top + TOP_BAR, paddingHorizontal: theme.space[4] }}>{node}</View>;

  const p = pass.data ?? null;
  const corridor = b ? network.data?.corridors.find((c) => c.id === b.departure.corridorId) : undefined;
  const toCity = corridor && b ? endpoints(corridor.cityId, b.departure.direction).to : null;
  const endGarage = toCity ? endGarageFor(network.data?.garages ?? [], toCity) : null;
  const garage = b ? garageName(network.data, b.departure.garageId) : '';
  const stopName = b ? stopNameOf(b.pickup, garage, { pin: t('rajaa.agree_pin_title'), door: t('rajaa.pickup_door'), place: publicPlaceName }) : '';
  const trip =
    b && endGarage
      ? bookingRoadTrip({ departure: b.departure, pickup: b.pickup, network: network.data, endGarageId: endGarage.id, car: p?.car ?? null, now, startName: garage, stopName, checkpointName: publicPlaceName })
      : null;
  const words = roadWords(trip, t, locale);
  const phase = b ? passPhase(b, now) : null;
  const ended = !!b && (!live || phase === 'kept' || phase === 'closed');

  const route = corridor && b ? routeLabel(t, corridor.cityId, b.departure.direction) : '';
  const onShare = async () => {
    if (!b) return;
    let link: string;
    try {
      link = shareUrl((await client.tracking.createShareLink.mutate({ bookingId: b.id })).path);
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning', placement: 'top' });
      return;
    }
    const message = t('rajaa.share_message', { route, time: clockLabel(b.departure.departAt), plate: plate(b.departure.vehicle.plate), link });
    try {
      await Share.share({ message });
    } catch {
      toast.show({ message: t('rajaa.share_copied', { link }), placement: 'top' }, 6000);
    }
  };
  let body: React.ReactNode = null;
  let sheet: React.ReactNode = null;
  if (booking.isPending || (b && !ended && network.isPending)) {
    body = centred(
      <View testID="road-loading" style={{ padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface }}>
        <Skeleton lines={3} />
      </View>,
    );
  } else if ((booking.error && !b) || (network.error && !network.data)) {
    body = centred(
      <EmptyState
        icon={net.online ? 'refresh' : 'wifi-off'}
        title={net.online ? apiErrorMessage(booking.error ?? network.error, t('rajaa_road.error'), locale) : t('net.offline_title')}
        action={{ label: t('action.retry'), onPress: () => void Promise.all([booking.refetch(), network.refetch()]) }}
      />,
    );
  } else if (!b || ended || !trip || !toCity) {
    body = centred(<EmptyState icon="rajaa" title={b && !ended ? t('rajaa_road.error') : t('rajaa_road.closed')} body={t('rajaa_road.closed_body')} action={{ label: t('action.back'), onPress: back }} />);
  } else {
    const city = cityName(t, toCity);
    const departed = b.departure.state === 'departed';
    const fixAgeMin = departed && p?.car ? Math.floor((now.getTime() - p.car.at.getTime()) / MIN) : null;
    const stale = fixAgeMin !== null && fixAgeMin >= STALE_MIN;
    const canWindow = ROAD_MAP && ROAD_TILT && !lite && !failed && departed && trip.carM !== null;
    const mode = canWindow ? view : 'whole';
    const trusted = (me.data?.trustedContacts ?? []).map((c) => c.name);
    // A failed profile read just leaves the line out (the pass says who follows).
    const watching = !me.isError && me.data?.safety.autoShareRajaa && trusted.length > 0 ? t(trusted.length > 1 ? 'rajaa.watching_many' : 'rajaa.watching_one', { names: namesList(t, trusted) }) : null;
    const line = mode === 'window' ? [words?.subtitle, trip.pace === 'moving' ? t('rajaa_road.pace_moving') : trip.pace === 'slow' ? t('rajaa_road.pace_slow') : null].filter(Boolean).join(' ') : departed ? words?.nextLine : t('rajaa_road.not_left');
    const driverLine = [driverCard?.firstName, b.departure.vehicle.model, plate(b.departure.vehicle.plate)].filter(Boolean).join(' · ');

    sheet = (
      <View
        testID="road-sheet"
        onLayout={(e) => setSheetH(Math.round(e.nativeEvent.layout.height))}
        style={[styles.card, { backgroundColor: theme.colors.surface, borderTopLeftRadius: theme.radius.xl, borderTopRightRadius: theme.radius.xl, paddingTop: theme.space[3], paddingHorizontal: theme.space[5], paddingBottom: insets.bottom + theme.space[4], gap: theme.space[3] }]}
      >
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border }} />
        <View style={{ gap: 2 }}>
          <Text testID="road-arrive" variant="heading" tabular accessibilityRole="header" accessibilityLiveRegion="polite">
            {t('rajaa.road_arrive', { city, time: clockLabel(trip.arriveAt) })}
          </Text>
          {line ? (
            <Text testID="road-line" variant="footnote" color="textMuted" tabular>
              {line}
            </Text>
          ) : null}
          {stale && fixAgeMin !== null ? (
            <View testID="road-stale" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name={net.online ? 'clock' : 'wifi-off'} size={14} color="warningText" />
              <Text variant="caption" color="warningText">
                {t('rajaa_road.stale', { n: fixAgeMin })}
              </Text>
            </View>
          ) : !net.online || pass.isError ? (
            <View testID="road-offline" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="wifi-off" size={14} color="warningText" />
              <Text variant="caption" color="warningText">
                {t('rajaa_road.offline')}
              </Text>
            </View>
          ) : null}
          {failed ? (
            <Text variant="caption" color="textMuted">
              {t('rajaa_road.map_failed')}
            </Text>
          ) : null}
        </View>
        <TownRail trip={trip} />
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {canWindow ? (
            <Button
              testID="road-window-toggle"
              variant="secondary"
              icon={mode === 'window' ? 'map-pin' : 'location-arrow'}
              label={mode === 'window' ? t('rajaa_road.window_off') : t('rajaa_road.window_on')}
              onPress={() => setView(mode === 'window' ? 'whole' : 'window')}
            />
          ) : null}
          <Button testID="road-share" style={{ flex: 1 }} icon="share" label={t('rajaa.share_trip')} onPress={() => void onShare()} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 24 }}>
          {watching ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }} testID="road-watching">
              <Icon name="heart" size={14} color="successText" />
              <Text variant="caption" weight={600} numberOfLines={1} style={{ flexShrink: 1 }}>
                {watching}
              </Text>
            </View>
          ) : null}
          <Text testID="road-driver" variant="caption" color="textMuted" numberOfLines={1} style={{ flex: 1, textAlign: watching ? 'left' : undefined }}>
            {driverLine}
          </Text>
        </View>
      </View>
    );

    body = ROAD_MAP && !failed ? (
      <>
        <RoadMap
          road={trip.road}
          carM={trip.carM}
          mode={mode}
          startName={garage}
          initial={initialOf(driverCard?.firstName ?? '') || '·'}
          carTag={words?.tag ?? null}
          horizon={words?.horizon ?? null}
          topInset={insets.top + TOP_BAR}
          bottomInset={sheetH}
          lite={lite}
          onFail={() => setFailed(true)}
          accessibilityLabel={t('rajaa_road.map_a11y', { from: trip.stops[0]!.name, to: city })}
        />
        {mode === 'window' ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + TOP_BAR + theme.space[2], end: theme.space[3], paddingHorizontal: theme.space[3], paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: theme.colors.inverse }} testID="road-end-chip">
            <Text variant="label" weight={700} color="onInverse" tabular>
              {t('rajaa_road.end_chip', { city, time: clockLabel(trip.arriveAt) })}
            </Text>
          </View>
        ) : null}
        <View pointerEvents="box-none" style={styles.bottom}>
          {sheet}
        </View>
      </>
    ) : (
      // No map on this build, or it failed: the sheet alone says it all.
      <View style={{ flex: 1, justifyContent: 'flex-end', paddingTop: insets.top + TOP_BAR + theme.space[2] }}>{sheet}</View>
    );
  }

  const sos = b && (b.state === 'checked_in' || (live && (b.departure.state === 'boarding' || b.departure.state === 'departed')));
  const sosCar = b ? [driverCard?.firstName ?? t('track.driver_fallback'), b.departure.vehicle.model, plate(b.departure.vehicle.plate)].filter(Boolean).join(' · ') : '';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }} testID="rajaa-road-screen">
      <Stack.Screen options={{ headerShown: false, title: t('rajaa.road_title') }} />
      {body}
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + theme.space[2], paddingHorizontal: theme.space[3], gap: theme.space[2] }]}>
        <View style={{ borderRadius: 22, backgroundColor: theme.colors.surface, boxShadow: SHADOW }}>
          <IconButton icon="arrow-back" variant="plain" accessibilityLabel={t('action.back')} onPress={back} testID="header-back" />
        </View>
        {b && live ? (
          <Pressable
            testID="road-seat-chip"
            accessibilityRole="button"
            onPress={() => router.push(`/rajaa/pass/${b.id}`)}
            style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 44, paddingHorizontal: theme.space[4], borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, boxShadow: SHADOW }}
          >
            <Icon name="seat" size={18} color="accentText" strokeWidth={2} />
            <Text variant="label" weight={700} numberOfLines={1} style={{ flexShrink: 1 }}>
              {t('rajaa_road.seat_chip', { seat: seatsList(t, b.seatIds) })}
            </Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        {sos && b ? <SosControl subject={{ kind: 'booking', id: b.id }} car={sosCar} onShareLocation={() => void onShare()} style={{ boxShadow: SHADOW }} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  card: { boxShadow: '0 -2px 16px rgba(40,24,8,0.12)' },
});
