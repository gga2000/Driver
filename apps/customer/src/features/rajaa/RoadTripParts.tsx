import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { formatMinutes } from '@driver/i18n';
import { Icon, initialOf, Text, useLiteMode, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { clockLabel } from './logic';
import { ROAD_MAP, RoadMap } from './RoadMap';
import type { RoadTrip, TripStop } from './road-trip';
import { namesList } from './RoadParts';

/**
 * The words and small parts of «طريق بغداد» (map idea N13) shared by the pass's strip (C), the whole
 * road (A) and the window seat (B): what was passed, what is left, what comes next, the town rail.
 */

type TFn = ReturnType<typeof useT>;

/** The words for a trip on the road; each is null when it says nothing (no car yet). Not a hook: screens call it after their early returns. */
export function roadWords(trip: RoadTrip | null, t: TFn, locale: ReturnType<typeof useLocale>) {
  const dur = (min: number) => formatMinutes(min, { locale });
  if (!trip) return null;
  const onRoad = trip.carM !== null;
  const passedTown = trip.lastPassed && trip.lastPassed.kind !== 'start' ? trip.lastPassed : null;
  const left = dur(trip.minutesLeft);
  // «عديتوا بسماية. باقي 38 دقيقة» — or just what is left while still near the garage.
  const subtitle = onRoad ? (passedTown ? t('rajaa_road.passed_left', { town: passedTown.name, duration: left }) : t('rajaa_road.left', { duration: left })) : null;
  // The towns already behind (but the last one, which stays on the timeline) fold into one line.
  const start = trip.stops[0]!;
  const folded = onRoad ? trip.stops.filter((s) => s.passed && s.kind === 'town' && s !== trip.lastPassed) : [];
  const summary = onRoad && passedTown ? (folded.length ? t('rajaa_road.summary', { garage: start.name, time: clockLabel(start.at), towns: namesList(t, folded.map((s) => s.name)) }) : t('rajaa_road.summary_left', { garage: start.name, time: clockLabel(start.at) })) : null;
  const next = trip.next && trip.nextInMin !== null ? { name: trip.next.name, inMin: trip.nextInMin } : null;
  const pace = trip.pace === 'moving' ? t('rajaa_road.pace_moving') : trip.pace === 'slow' ? t('rajaa_road.pace_slow') : null;
  // «جسر ديالى بعد 11 دقيقة. الطريق ماشي.» (only what the car's own pace says about the road).
  const nextLine = onRoad && next && trip.next?.kind !== 'end' ? [t('rajaa_road.next_in', { town: next.name, duration: dur(next.inMin) }), pace].filter(Boolean).join(' ') : pace;
  const tag = onRoad ? { top: passedTown ? t('rajaa_road.tag_passed', { town: passedTown.name }) : t('rajaa_road.tag_from', { town: start.name }), bottom: t('rajaa_road.left', { duration: left }) } : null;
  const horizon = next ? { eyebrow: t('rajaa_road.next_eyebrow'), title: t('rajaa_road.next_card', { town: next.name, duration: dur(next.inMin) }) } : null;
  return { subtitle, summary, nextLine, tag, horizon, onRoad };
}

/** The timeline's rows on the pass: the last town behind and everything ahead (the rest is in the summary). */
export function timelineStops(trip: RoadTrip): TripStop[] {
  if (trip.carM === null || !trip.lastPassed) return trip.stops;
  const from = trip.stops.indexOf(trip.lastPassed);
  return trip.stops.filter((s, i) => i >= from && (!s.passed || s === trip.lastPassed));
}

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
