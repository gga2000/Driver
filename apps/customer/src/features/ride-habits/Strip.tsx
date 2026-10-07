import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { ListRow, useNow, useTheme } from '@driver/ui';
import { appNow } from '@/lib/dev-clock';
import { useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';
import { RecentDriverCard, RegularDueCard } from './Cards';
import { askingNow } from './logic';
import { useRegularTrips } from './queries';

/**
 * The ride habits on the ride and الرجعة tabs (joy J7d): the regular trips asking now («أكدها»), the
 * last good driver to keep as a favourite (rides only), and the way to «رحلاتي الثابتة».
 */
export function RideHabitsStrip({ kind }: { kind: 'ride' | 'rajaa' }) {
  const theme = useTheme();
  const t = useT();
  const signedIn = useSignedIn();
  const trips = useRegularTrips();
  const tick = useNow(true, 60_000);
  const now = useMemo(() => appNow(tick), [tick]);
  if (!signedIn) return null;
  const due = askingNow(trips.data ?? [], kind);
  return (
    <View style={{ gap: theme.space[3] }} testID={`habits-strip-${kind}`}>
      {due.map((trip) => (
        <RegularDueCard key={trip.id} trip={trip} now={now} />
      ))}
      {kind === 'ride' ? <RecentDriverCard /> : null}
      <ListRow
        testID={`habits-regular-${kind}`}
        leading="refresh"
        title={t('habits.regular_title')}
        subtitle={(trips.data?.length ?? 0) > 0 ? t('habits.regular_count', { n: trips.data!.length }) : t('habits.regular_row_sub')}
        onPress={() => router.push('/regular')}
      />
    </View>
  );
}
