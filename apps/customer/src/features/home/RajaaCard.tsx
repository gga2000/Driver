import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { IntercityDirection } from '@driver/contracts';
import { Card, DepartureTime, Icon, Skeleton, Text, useTheme } from '@driver/ui';
import { routeLabel, wayKey } from '@/features/rajaa/labels';
import { lastKnownLocation } from '@/features/rajaa/location';
import { bookingHref, clockLabel, PRIMARY_CORRIDOR, type LatLngLike } from '@/features/rajaa/logic';
import { useNetwork, useRajaaHome } from '@/features/rajaa/queries';
import { useT } from '@/lib/i18n';
import { selectedPlace, useProfile } from '@/lib/profile';
import { useSignedIn } from '@/lib/session';
import { rajaaHomeDirection } from './rajaa-direction';

/** h10: the card's direction from where the person is (phone near a garage, deliver-to place) and the hour. */
function useHomeDirection(hour: number): { direction: IntercityDirection; cityId: string } {
  const network = useNetwork();
  const hasPlace = selectedPlace(useProfile()) !== null;
  const [position, setPosition] = useState<LatLngLike | null>(null);
  useEffect(() => {
    let live = true;
    void lastKnownLocation()
      .then((at) => {
        if (live) setPosition(at);
      })
      .catch(() => undefined); // no position: the place and the hour decide
    return () => {
      live = false;
    };
  }, []);
  return rajaaHomeDirection({ position, garages: network.data?.garages ?? [], hasAziziyahPlace: hasPlace, hour });
}

/**
 * الرجعة card, second on home: the live board (`routes.board`) in the direction this person most
 * likely travels (joy h10: at home in Aziziyah → «العزيزية ← بغداد»; in Baghdad → the way back), or the
 * rider's own booked trip when there is one. Read like a departure board (audit d-2): the next car's
 * time big on split-flap tiles first, then where it goes and from which garage.
 */
export function RajaaCard({ hour }: { hour: number }) {
  const theme = useTheme();
  const t = useT();
  const way = useHomeDirection(hour);
  const r = useRajaaHome(way.direction);
  // Guests see what الرجعة is; the live board (and booking) comes with their number (audit C-18).
  const guest = !useSignedIn();
  // «سفرة» going out, «الرجعة» only on the way back (f1/n1).
  const dir = r.trip ? r.trip.departure.direction : way.direction;
  const route = r.trip && r.tripCityId ? routeLabel(t, r.tripCityId, r.trip.departure.direction) : routeLabel(t, way.cityId, way.direction);
  // The time on the board: the rider's own departure, else the next car.
  const at = guest || r.error ? null : r.trip ? r.trip.departure.departAt : (r.next?.departAt ?? null);
  const summary = r.trip
    ? r.trip.state === 'held' && r.trip.heldUntil
      ? t('rajaa.home_hold', { time: clockLabel(r.trip.heldUntil) })
      : t('rajaa.home_trip_booked')
    : r.count === 0 || !r.next
      ? t(wayKey('rajaa.home_summary_none', dir))
      : t('rajaa.home_cars', { n: r.count });
  const open = () =>
    r.trip ? router.push(bookingHref(r.trip) as never) : router.push({ pathname: '/rajaa', params: { corridor: PRIMARY_CORRIDOR, direction: way.direction } });
  return (
    <Card testID="home-rajaa" padding={4} onPress={open} accessibilityLabel={`${t(wayKey('rajaa.kind', dir))}: ${route}`}>
      <View style={{ flexDirection: 'row', gap: theme.space[4], alignItems: 'center' }}>
        {at ? (
          <DepartureTime testID="home-rajaa-time" at={at} size="card" />
        ) : (
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: theme.radius.lg,
              backgroundColor: r.trip ? theme.colors.successTint : theme.colors.accentTint,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={r.trip ? 'seat' : 'rajaa'} size={26} color={r.trip ? 'successText' : 'accentText'} strokeWidth={1.8} />
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" weight={600} color="accentText">
            {t(wayKey('rajaa.kind', dir))}
            {r.garage ? ` · ${r.garage}` : ''}
          </Text>
          <Text variant="title">{route}</Text>
          {guest ? (
            <Text variant="footnote" color="textMuted" testID="home-rajaa-summary">
              {t('rajaa.home_guest')}
            </Text>
          ) : r.loading ? (
            <Skeleton height={14} width="70%" />
          ) : (
            <Text variant="footnote" color={r.trip && r.trip.state !== 'held' ? 'successText' : 'textMuted'} weight={r.trip ? 600 : 400} tabular testID="home-rajaa-summary">
              {r.error ? t('rajaa.load_failed') : summary}
            </Text>
          )}
        </View>
        <Icon name="chevron-forward" size={20} color="textMuted" />
      </View>
    </Card>
  );
}
