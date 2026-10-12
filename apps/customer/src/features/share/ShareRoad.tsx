import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { MessageKey } from '@driver/i18n';
import { formatMinutes } from '@driver/i18n';
import type { SharedTrip } from '@driver/contracts';
import { formatClock, Icon, initialOf, Text, useLiteMode, useTheme } from '@driver/ui';
import { roadForCities, sharedRoadTrip, type RoadTrip } from '@/features/rajaa/road-trip';
import { ROAD_MAP, RoadMap } from '@/features/rajaa/RoadMap';
import { TownRail } from '@/features/rajaa/RoadTripParts';
import { useLocale, useT } from '@/lib/i18n';

/**
 * The family's page for a الرجعة trip (map idea N13, view A only): the real road from the garage to
 * the far city, gold as far as the car has come, and in words when they reach and what comes next.
 * Built only from what the share already sends (the two cities, the car's fix, the arrival time and the
 * driver's first name): only this rider's road, the driver and the plate, never another rider.
 */

const cityKey = (id: string) => `rajaa.city_${id}` as MessageKey;

/** The road and the car on it for a shared intercity trip; null for a city ride or a road we don't have. */
export function useSharedRoad(trip: SharedTrip | undefined, now: number): { trip: RoadTrip | null; road: ReturnType<typeof roadForCities>; carM: number | null } | null {
  const t = useT();
  const from = trip?.subject === 'intercity' ? trip.route?.fromCityId : undefined;
  const to = trip?.route?.toCityId;
  const road = useMemo(() => (from && to ? roadForCities(from, to) : null), [from, to]);
  if (!trip || !road || !trip.route) return null;
  const onTrip = trip.status === 'on_trip' && trip.position;
  const rt = onTrip ? sharedRoadTrip({ road, startName: t(cityKey(trip.route.fromCityId)), car: trip.position, eta: trip.eta, now: new Date(now) }) : null;
  return { trip: rt, road, carM: rt?.carM ?? null };
}

/** The map half of the page: the whole road, framed once; on a failure the page's own map takes over. */
export function ShareRoadMap({ shared, trip, fallback }: { shared: NonNullable<ReturnType<typeof useSharedRoad>>; trip: SharedTrip; fallback: React.ReactNode }) {
  const t = useT();
  const locale = useLocale();
  const lite = useLiteMode();
  const [failed, setFailed] = useState(false);
  if (!ROAD_MAP || failed || !shared.road || !trip.route) return <>{fallback}</>;
  const words = tagOf(shared.trip, t, locale);
  return (
    <RoadMap
      testID="share-road-map"
      road={shared.road}
      carM={shared.carM}
      mode="whole"
      startName={t(cityKey(trip.route.fromCityId))}
      initial={trip.driverFirstName ? initialOf(trip.driverFirstName) : ''}
      carTag={words}
      topInset={56}
      bottomInset={24}
      lite={lite}
      onFail={() => setFailed(true)}
      accessibilityLabel={t('rajaa_road.map_a11y', { from: t(cityKey(trip.route.fromCityId)), to: t(cityKey(trip.route.toCityId)) })}
    />
  );
}

function tagOf(rt: RoadTrip | null, t: ReturnType<typeof useT>, locale: ReturnType<typeof useLocale>) {
  if (!rt) return null;
  const passed = rt.lastPassed && rt.lastPassed.kind !== 'start' ? rt.lastPassed : null;
  return { top: passed ? t('rajaa_road.tag_passed', { town: passed.name }) : t('rajaa_road.tag_from', { town: rt.stops[0]!.name }), bottom: t('rajaa_road.left', { duration: formatMinutes(rt.minutesLeft, { locale }) }) };
}

/**
 * The words on the family's page: «بالطريق · يوصلون بغداد 9:05», what was passed and what is left,
 * the next town, the town rail and how fresh the car's place is.
 */
export function ShareRoadBlock({ shared, trip, ageMin }: { shared: NonNullable<ReturnType<typeof useSharedRoad>>; trip: SharedTrip; ageMin: number | null }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const rt = shared.trip;
  if (!trip.route) return null;
  const city = t(cityKey(trip.route.toCityId));
  const dur = (n: number) => formatMinutes(n, { locale });
  const passed = rt?.lastPassed && rt.lastPassed.kind !== 'start' ? rt.lastPassed : null;
  return (
    <View testID="share-road" style={{ gap: theme.space[3] }}>
      <View style={{ gap: 2 }}>
        <Text variant="heading" tabular testID="share-road-headline" accessibilityRole="header">
          {trip.status === 'on_trip' && trip.eta ? t('rajaa_road.share_headline', { city, time: formatClock(rt?.arriveAt ?? trip.eta) }) : t('rajaa_road.share_waiting')}
        </Text>
        {rt ? (
          <Text variant="footnote" color="textMuted" tabular testID="share-road-line">
            {passed ? t('rajaa_road.share_passed', { town: passed.name, duration: dur(rt.minutesLeft), city }) : t('rajaa_road.left', { duration: dur(rt.minutesLeft) })}
          </Text>
        ) : null}
        {rt?.next && rt.nextInMin !== null && rt.next.kind !== 'end' ? (
          <Text variant="footnote" weight={600} color="accentText" tabular testID="share-road-next">
            {t('rajaa_road.share_next', { town: rt.next.name, duration: dur(rt.nextInMin) })}
          </Text>
        ) : null}
        {ageMin !== null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} testID="share-road-updated">
            <Icon name="clock" size={14} color={ageMin >= 2 ? 'warningText' : 'textMuted'} />
            <Text variant="caption" color={ageMin >= 2 ? 'warningText' : 'textMuted'}>
              {ageMin < 1 ? t('rajaa_road.updated_now') : t('rajaa_road.updated_ago', { n: ageMin })}
            </Text>
          </View>
        ) : null}
      </View>
      {rt ? <TownRail trip={rt} /> : null}
    </View>
  );
}
