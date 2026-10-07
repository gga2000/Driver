import { Pressable, View } from 'react-native';
import { formatMinutes } from '@driver/i18n';
import { Card, Icon, Text, Timeline, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { clockLabel } from './logic';
import type { RoadLine } from './road';

/**
 * On the road (Baghdad/Kut ideas r1, r2, r3, Ali 2026-10-07): the arrival time big, how long is left,
 * the road as a line with each stop's time and the car on it, and who is following the trip by name.
 */

type TFn = ReturnType<typeof useT>;

/** «أمك وزينب» / «أمك، زينب وعلي». */
export function namesList(t: TFn, names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return t('rajaa.names_last', { list: names.slice(0, -1).join(t('rajaa.names_sep')), last: names[names.length - 1]! });
}

export type Watching = { kind: 'now' | 'soon'; names: string[] } | { kind: 'none' };

export function RoadCard({ line, city, onRoad, watching, onShare }: { line: RoadLine; city: string; onRoad: boolean; watching: Watching; onShare: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const next = line.stops.find((s) => !s.passed) ?? line.stops[line.stops.length - 1]!;
  const travelMin = Math.round((line.stops[line.stops.length - 1]!.at.getTime() - line.stops[0]!.at.getTime()) / 60_000);
  const watchText =
    watching.kind === 'none'
      ? t('rajaa.watching_none')
      : watching.kind === 'soon'
        ? t('rajaa.watching_soon', { names: namesList(t, watching.names) })
        : t(watching.names.length > 1 ? 'rajaa.watching_many' : 'rajaa.watching_one', { names: namesList(t, watching.names) });
  return (
    <Card testID="rajaa-road" padding={4} elevation={0}>
      <View style={{ gap: theme.space[4] }}>
        {/* r2: the arrival, big. */}
        <View style={{ gap: 2 }} accessible accessibilityRole="header">
          <Text testID="rajaa-road-arrive" variant="heading" tabular>
            {t('rajaa.road_arrive', { city, time: clockLabel(line.arriveAt) })}
          </Text>
          <Text variant="footnote" color="textMuted">
            {onRoad ? t('rajaa.road_left', { duration: formatMinutes(line.minutesLeft, { locale }) }) : t('rajaa.road_planned', { duration: formatMinutes(travelMin, { locale }) })}
          </Text>
        </View>

        {/* r1: the road as a line; the car's progress on a thin bar above it once it moves. */}
        {line.carFrac !== null ? (
          <View accessible accessibilityLabel={t('rajaa.road_car_a11y', { percent: `${Math.round(line.carFrac * 100)}%` })} style={{ height: 24, justifyContent: 'center' }}>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surfaceSunken }} />
            <View style={{ position: 'absolute', start: 0, width: `${line.carFrac * 100}%`, height: 6, borderRadius: 3, backgroundColor: theme.colors.success }} />
            <View style={{ position: 'absolute', start: `${line.carFrac * 100}%`, marginStart: -12, width: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: theme.colors.success, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="car" size={14} color="successText" />
            </View>
          </View>
        ) : null}
        <Timeline
          current={next.id}
          steps={line.stops.map((s) => ({
            key: s.id,
            label: s.name,
            time: clockLabel(s.at),
            // Checkpoint names already say «سيطرة»; the rider's own stop says it is his.
            ...(s.kind === 'my_stop' ? { note: t('rajaa.road_my_stop') } : {}),
          }))}
        />

        {/* r3: who is following, by name; nobody → one tap shares it. */}
        <Pressable
          testID="rajaa-watching"
          disabled={watching.kind !== 'none'}
          accessibilityRole={watching.kind === 'none' ? 'button' : 'text'}
          onPress={onShare}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 44, opacity: pressed ? 0.7 : 1 })}
        >
          <Icon name={watching.kind === 'none' ? 'share' : 'heart'} size={16} color={watching.kind === 'none' ? 'accentText' : 'successText'} />
          <Text variant="footnote" weight={600} color={watching.kind === 'none' ? 'accentText' : 'text'} style={{ flex: 1 }}>
            {watchText}
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}
