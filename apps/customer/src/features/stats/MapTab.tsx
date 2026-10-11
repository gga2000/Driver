import { useState } from 'react';
import { View } from 'react-native';
import type { StatsTrips, StatsView } from '@driver/contracts';
import { Card, EmptyState, Icon, SketchScene, Text, useTheme } from '@driver/ui';
import { GOLDEN_MAP } from '@/features/track/map/credit';
import { useT } from '@/lib/i18n';
import { STACK } from './format';
import { useStackColours } from './MonthColumns';
import { TripsMap } from './TripsMap';

const MAP_HEIGHT = 440;

/** How many trips of each service the map draws (the legend under it). */
export function tripCounts(trips: StatsTrips): Record<(typeof STACK)[number], number> {
  const out = { food: 0, tuktuk: 0, taxi: 0, rajaa: 0 };
  for (const tr of trips.traces) out[tr.service] += tr.count;
  return out;
}

/**
 * «خريطتك»: his own meals, rides and الرجعة trips as lines on the town (kitchens with their counts, home in
 * a cream ring), a legend that names every colour with its count, and a line saying nobody else sees it.
 * Where this build has no map, the legend stays and says so.
 */
export function MapTab({ v }: { v: StatsView }) {
  const theme = useTheme();
  const t = useT();
  const colours = useStackColours();
  const [failed, setFailed] = useState(false);
  const counts = tripCounts(v.trips);
  if (v.trips.traces.length === 0) {
    return <EmptyState icon="map-pin" art={<SketchScene name="safe_arrival" />} title={t('stats.map_title')} body={t('stats.map_empty')} />;
  }
  return (
    <View style={{ gap: theme.space[3] }}>
      {GOLDEN_MAP && !failed ? (
        <TripsMap trips={v.trips} height={MAP_HEIGHT} onFail={() => setFailed(true)} />
      ) : (
        <Card elevation={0} padding={4} tone="sunken">
          <Text variant="footnote" color="textMuted">
            {t('stats.map_off')}
          </Text>
        </Card>
      )}
      <Card elevation={0} padding={4} testID="stats-map-legend">
        <View style={{ gap: theme.space[2] }}>
          <Text variant="bodyStrong" accessibilityRole="header">
            {t('stats.map_title')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space[4], rowGap: theme.space[1] }}>
            {STACK.filter((k) => counts[k] > 0).map((k) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 18, height: 5, borderRadius: 3, backgroundColor: colours[k] }} />
                <Text variant="footnote" tabular>
                  {t(`stats.legend_${k}` as const, { n: counts[k] })}
                </Text>
              </View>
            ))}
            {v.trips.kitchens.length > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.services.food.fill, borderWidth: 2, borderColor: theme.colors.surface }} />
                <Text variant="footnote" tabular>
                  {t('stats.map_kitchens', { n: v.trips.kitchens.length })}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="lock" size={14} color="textMuted" />
            <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
              {t('stats.map_note')}
            </Text>
          </View>
        </View>
      </Card>
    </View>
  );
}
