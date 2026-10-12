import { formatMinutes } from '@driver/i18n';
import type { useLocale, useT } from '@/lib/i18n';
import { clockLabel } from './logic';
import type { RoadTrip, TripStop } from './road-trip';

/**
 * The words of «طريق بغداد» (map idea N13), pure so they are tested: what was passed, what is left,
 * what comes next and how the road is going, for the pass (C), the whole road (A) and the window (B).
 */

type TFn = ReturnType<typeof useT>;

/** «أمك وزينب» / «أمك، زينب وعلي». */
export function namesList(t: TFn, names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return t('rajaa.names_last', { list: names.slice(0, -1).join(t('rajaa.names_sep')), last: names[names.length - 1]! });
}

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

