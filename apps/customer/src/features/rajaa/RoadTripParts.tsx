import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, initialOf, Text, useLiteMode, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { clockLabel } from './logic';
import { ROAD_MAP, RoadMap } from './RoadMap';
import type { RoadTrip } from './road-trip';
export { roadWords, timelineStops } from './road-words';

/**
 * The words and small parts of «طريق بغداد» (map idea N13) shared by the pass's strip (C), the whole
 * road (A) and the window seat (B): what was passed, what is left, what comes next, the town rail.
 */

/** At most this many towns carry their name on the rail; the others are small dots. */
const RAIL_LABELS = 5;

/**
 * The town rail (A): the road from the garage to the end, right to left, the part driven in saffron
 * with the car on the last town behind; towns long behind are small dots, the next one in accent.
 */
export function TownRail({ trip, startLabel }: { trip: RoadTrip; startLabel?: string }) {
  const theme = useTheme();
  const t = useT();
  const nodes = trip.stops.filter((s) => s.kind === 'start' || s.kind === 'town' || s.kind === 'end' || s.kind === 'my_stop');
  const carAt = trip.carM === null ? -1 : nodes.lastIndexOf(nodes.filter((s) => s.passed).pop() ?? nodes[0]!);
  const nextAt = trip.carM === null ? -1 : nodes.findIndex((s) => s === trip.next);
  // Named: the start, the car's town, the next, the end; then towns ahead in order while there is room.
  const named = new Set<number>([0, nodes.length - 1, ...(carAt >= 0 ? [carAt] : []), ...(nextAt >= 0 ? [nextAt] : [])]);
  for (let i = Math.max(carAt, 0) + 1; i < nodes.length && named.size < RAIL_LABELS; i++) named.add(i);
  return (
    <View testID="road-rail" accessibilityRole="list" style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      {nodes.map((s, i) => {
        const label = named.has(i);
        const isCar = i === carAt;
        const done = carAt >= 0 && i <= carAt;
        const line = (side: 'start' | 'end', on: boolean) => (
          <View style={{ position: 'absolute', top: 14, height: 3, width: '50%', [side]: 0, backgroundColor: on ? theme.colors.accent : theme.colors.border }} />
        );
        return (
          <View key={s.id} style={{ flex: label ? 1 : 0.35, alignItems: 'center', minWidth: label ? 0 : 14 }} accessible={label} accessibilityLabel={label ? t('rajaa_road.rail_a11y', { town: s.kind === 'start' && startLabel ? startLabel : s.name, time: clockLabel(s.at) }) : undefined}>
            {i > 0 ? line('start', carAt >= 0 && i <= carAt) : null}
            {i < nodes.length - 1 ? line('end', carAt >= 0 && i < carAt) : null}
            <View style={{ height: 30, justifyContent: 'center' }}>
              {isCar ? (
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: theme.colors.surface }}>
                  <Icon name="rajaa" size={16} color="onAccent" strokeWidth={2.2} />
                </View>
              ) : done ? (
                <View style={{ width: label ? 12 : 9, height: label ? 12 : 9, borderRadius: 6, backgroundColor: theme.colors.accent }} />
              ) : (
                <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: i === nextAt ? theme.colors.accent : theme.colors.borderStrong, backgroundColor: theme.colors.surface }} />
              )}
            </View>
            {label ? (
              <>
                <Text variant="caption" weight={i === nextAt ? 700 : 600} color={i === nextAt ? 'accentText' : 'text'} numberOfLines={1} align="center" compact style={{ marginTop: 2 }}>
                  {s.kind === 'start' && startLabel ? startLabel : s.name}
                </Text>
                <Text variant="caption" color="textMuted" tabular align="center" compact>
                  {clockLabel(s.at)}
                </Text>
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/**
 * The pass's strip (C): about 20 km of the real road around the car, still, with «الطريق كله» on it.
 * A tap opens the whole road. When the map can't draw (no map on this build, or it failed) it is not
 * there at all and the card below says it all.
 */
export function RoadStrip({ trip, driverName, startLabel, onOpen }: { trip: RoadTrip; driverName: string | null; startLabel: string; onOpen: () => void }) {
  const theme = useTheme();
  const t = useT();
  const lite = useLiteMode();
  const [failed, setFailed] = useState(false);
  if (!ROAD_MAP || failed) return null;
  return (
    <Pressable testID="road-strip" accessibilityRole="button" accessibilityLabel={t('rajaa_road.strip_a11y')} onPress={onOpen} style={{ height: 150, backgroundColor: theme.colors.surfaceSunken }}>
      <View pointerEvents="none" style={{ flex: 1 }}>
        <RoadMap road={trip.road} carM={trip.carM} mode="strip" startName={startLabel} initial={driverName ? initialOf(driverName) : ''} topInset={0} bottomInset={0} lite={lite} onFail={() => setFailed(true)} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', top: theme.space[3], end: theme.space[3], flexDirection: 'row', alignItems: 'center', gap: 4, paddingStart: theme.space[3], paddingEnd: theme.space[2], minHeight: 36, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, boxShadow: '0 1px 6px rgba(40,24,8,0.2)' }}>
        <Text variant="footnote" weight={700}>
          {t('rajaa_road.whole_chip')}
        </Text>
        <Icon name="chevron-forward" size={16} color="text" />
      </View>
    </Pressable>
  );
}
