import { router } from 'expo-router';
import { View } from 'react-native';
import { Card, DepartureTime, Icon, Skeleton, Text, useTheme } from '@driver/ui';
import { routeLabel } from '@/features/rajaa/labels';
import { bookingHref, clockLabel } from '@/features/rajaa/logic';
import { useRajaaHome } from '@/features/rajaa/queries';
import { useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';

/**
 * الرجعة card, second on home: the live board of cars back to Aziziyah (`routes.board`), or the
 * rider's own booked trip when there is one. Read like a departure board (audit d-2): the time on
 * split-flap tiles first, then where it goes.
 */
export function RajaaCard() {
  const theme = useTheme();
  const t = useT();
  const r = useRajaaHome();
  // Guests see what الرجعة is; the live board (and booking) comes with their number (audit C-18).
  const guest = !useSignedIn();
  const route = r.trip && r.tripCityId ? routeLabel(t, r.tripCityId, r.trip.departure.direction) : routeLabel(t, 'baghdad', 'to_aziziyah');
  // The time on the board: the rider's own departure, else the next car.
  const at = guest || r.error ? null : r.trip ? r.trip.departure.departAt : (r.next?.departAt ?? null);
  const summary = r.trip
    ? r.trip.state === 'held' && r.trip.heldUntil
      ? t('rajaa.home_hold', { time: clockLabel(r.trip.heldUntil) })
      : t('rajaa.home_trip_booked')
    : r.count === 0 || !r.next
      ? t('rajaa.home_summary_none')
      : t('rajaa.home_cars', { n: r.count });
  const open = () => router.push((r.trip ? bookingHref(r.trip) : '/rajaa') as never);
  return (
    <Card testID="home-rajaa" padding={4} onPress={open} accessibilityLabel={`${t('home.rajaa_title')}: ${route}`}>
      <View style={{ flexDirection: 'row', gap: theme.space[4], alignItems: 'center' }}>
        {at ? (
          <DepartureTime testID="home-rajaa-time" at={at} size="compact" />
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
            <Icon name={r.trip ? 'seat' : 'garage'} size={26} color={r.trip ? 'successText' : 'accentText'} strokeWidth={1.8} />
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" weight={600} color="accentText">
            {t('home.rajaa_title')}
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
