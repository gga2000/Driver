import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import type { RegularTripView } from '@driver/contracts';
import { formatWhen } from '@driver/i18n';
import { Button, Card, EmptyState, Icon, RetryState, retryKindFor, SketchScene, Skeleton, StatusPill, Text, useNetwork, useNow, useTheme, type StatusTone } from '@driver/ui';
import { GuestGate } from '@/components/GuestGate';
import { Screen } from '@/components/Screen';
import { DriverFace, regularRoute, regularWhen } from '@/features/ride-habits/Cards';
import { useRegularTrips } from '@/features/ride-habits/queries';
import { regularDraft } from '@/features/ride-habits/draft';
import { appNow } from '@/lib/dev-clock';
import { useLocale, useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';

/**
 * «رحلاتي الثابتة» (joy r5): the rides and الرجعة trips this person takes every week. Each shows its
 * days and time, the next one and where it stands (asking, booked, skipped), and its favourite
 * driver. Nothing books by itself: «أكدها» opens that day.
 */
export default function RegularTripsPage() {
  return useSignedIn() ? <RegularTrips /> : <GuestGate kind="account" />;
}

function RegularTrips() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const trips = useRegularTrips();
  const tick = useNow(true, 60_000);
  const now = useMemo(() => appNow(tick), [tick]);
  const list = trips.data;
  const add = (kind: 'ride' | 'rajaa') => {
    regularDraft.start(kind);
    router.push('/regular/edit');
  };

  return (
    <Screen edges={['bottom']} testID="regular">
      {trips.isError && !list ? (
        <RetryState
          kind={retryKindFor({ net, error: trips.error })}
          locale={locale}
          art={net.state !== 'online' ? <SketchScene name="offline" /> : undefined}
          {...(retryKindFor({ net, error: trips.error }) === 'server' ? { title: t('habits.regular_load_error') } : {})}
          onRetry={() => void trips.refetch()}
        />
      ) : !list ? (
        <View style={{ gap: theme.space[3] }} testID="regular-loading">
          <Skeleton height={120} />
          <Skeleton height={120} />
        </View>
      ) : list.length === 0 ? (
        <EmptyState icon="refresh" art={<SketchScene name="safe_arrival" />} title={t('habits.regular_empty_title')} body={t('habits.regular_empty_body')} />
      ) : (
        <View style={{ gap: theme.space[3] }}>
          {list.map((trip) => (
            <TripCard key={trip.id} trip={trip} now={now} />
          ))}
        </View>
      )}

      {list || trips.isError ? (
        <View style={{ gap: theme.space[2] }}>
          <Button testID="regular-add-ride" variant={list && list.length > 0 ? 'secondary' : 'primary'} icon="taxi" label={t('habits.regular_add_ride')} fullWidth onPress={() => add('ride')} />
          <Button testID="regular-add-rajaa" variant="secondary" icon="rajaa" label={t('habits.regular_add_rajaa')} fullWidth onPress={() => add('rajaa')} />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2], paddingVertical: theme.space[2] }}>
        <Icon name="shield" size={16} color="textMuted" />
        <Text variant="caption" color="textMuted" style={{ flex: 1 }} testID="regular-rule">
          {t('habits.rule')}
        </Text>
      </View>
    </Screen>
  );
}

const NEXT: Record<'waiting' | 'asking' | 'confirmed' | 'skipped' | 'closed', { key: 'habits.next_waiting' | 'habits.next_asking' | 'habits.next_confirmed' | 'habits.next_skipped'; tone: StatusTone }> = {
  waiting: { key: 'habits.next_waiting', tone: 'neutral' },
  asking: { key: 'habits.next_asking', tone: 'accent' },
  confirmed: { key: 'habits.next_confirmed', tone: 'success' },
  skipped: { key: 'habits.next_skipped', tone: 'neutral' },
  closed: { key: 'habits.next_waiting', tone: 'neutral' },
};

function TripCard({ trip, now }: { trip: RegularTripView; now: Date }) {
  const theme = useTheme();
  const t = useT();
  const next = trip.next;
  const edit = () => {
    regularDraft.edit(trip);
    router.push({ pathname: '/regular/edit', params: { id: trip.id } });
  };
  const open = () => next && router.push({ pathname: '/regular/[id]', params: { id: trip.id, date: next.date } });
  const icon = trip.plan.kind === 'rajaa' ? 'rajaa' : trip.plan.rideVertical === 'tuktuk' ? 'tuktuk' : 'taxi';
  return (
    <Card padding={4} elevation={1} testID={`regular-trip-${trip.id}`}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 44, height: 44, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={24} color="text" />
          </View>
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {regularRoute(t, trip)}
            </Text>
            <Text variant="footnote" color="textMuted" numberOfLines={1} tabular>
              {regularWhen(t, trip, now)}
            </Text>
          </View>
          {trip.favourite ? <DriverFace name={trip.favourite.firstName} photoUrl={trip.favourite.photoUrl} size={36} /> : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space[2] }}>
          {!trip.active ? (
            <StatusPill label={t('habits.paused')} tone="neutral" size="sm" />
          ) : next ? (
            <StatusPill testID={`regular-next-${trip.id}`} label={t(NEXT[next.state].key, { when: formatWhen(next.at, now) })} tone={NEXT[next.state].tone} size="sm" />
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          <Button testID={`regular-edit-${trip.id}`} variant="secondary" label={t('habits.edit')} onPress={edit} style={{ flex: 1 }} />
          {trip.active && next && (next.state === 'asking' || next.state === 'waiting') ? (
            <Button testID={`regular-open-${trip.id}`} label={t('habits.confirm_cta')} onPress={open} style={{ flex: 1 }} />
          ) : trip.active && next && next.state === 'confirmed' ? (
            <Button testID={`regular-open-${trip.id}`} variant="secondary" label={t('habits.occ_view_booking')} onPress={open} style={{ flex: 1 }} />
          ) : null}
        </View>
      </View>
    </Card>
  );
}
