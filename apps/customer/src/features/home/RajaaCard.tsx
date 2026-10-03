import { router } from 'expo-router';
import { View } from 'react-native';
import { Card, Icon, Skeleton, Text, useTheme } from '@driver/ui';
import { routeLabel } from '@/features/rajaa/labels';
import { bookingHref, clockLabel } from '@/features/rajaa/logic';
import { useRajaaHome } from '@/features/rajaa/queries';
import { useT } from '@/lib/i18n';

/**
 * الرجعة card, second on home: the live board of cars back to Aziziyah (`routes.board`), or the
 * rider's own booked trip when there is one.
 */
export function RajaaCard() {
  const theme = useTheme();
  const t = useT();
  const r = useRajaaHome();
  const route = r.trip && r.tripCityId ? routeLabel(t, r.tripCityId, r.trip.departure.direction) : routeLabel(t, 'baghdad', 'to_aziziyah');
  const summary = r.trip
    ? r.trip.state === 'held' && r.trip.heldUntil
      ? t('rajaa.home_hold', { time: clockLabel(r.trip.heldUntil) })
      : t('rajaa.home_trip', { time: clockLabel(r.trip.departure.departAt) })
    : r.count === 0 || !r.next
      ? t('rajaa.home_summary_none')
      : r.count === 1
        ? t('rajaa.home_summary_one', { time: clockLabel(r.next.departAt) })
        : t('rajaa.home_summary', { n: r.count, time: clockLabel(r.next.departAt) });
  const open = () => router.push((r.trip ? bookingHref(r.trip) : '/rajaa') as never);
  return (
    <Card testID="home-rajaa" padding={4} onPress={open} accessibilityLabel={`${t('home.rajaa_title')}: ${route}`}>
      <View style={{ flexDirection: 'row', gap: theme.space[4], alignItems: 'center' }}>
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
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" weight={600} color="accentText">
            {t('home.rajaa_title')}
            {r.garage ? ` · ${r.garage}` : ''}
          </Text>
          <Text variant="title">{route}</Text>
          {r.loading ? (
            <Skeleton height={14} width="70%" />
          ) : (
            <Text variant="footnote" color="textMuted" tabular testID="home-rajaa-summary">
              {r.error ? t('rajaa.load_failed') : summary}
            </Text>
          )}
        </View>
        <Icon name="chevron-forward" size={20} color="textMuted" />
      </View>
    </Card>
  );
}
