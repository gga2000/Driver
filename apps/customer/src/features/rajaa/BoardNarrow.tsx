import { Pressable, View } from 'react-native';
import type { CorridorView, DepartureCard } from '@driver/contracts';
import { formatMinutes, type MessageKey } from '@driver/i18n';
import { Button, Card, Icon, SegmentedControl, Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { countKey } from '@/lib/plural';
import { DAY_PART_IDS, hourBars, partSpan, type BoardDay, type BoardDayId, type DayPartId } from './board-filters';
import { cityName } from './labels';
import { clockLabel } from './logic';

/**
 * The board's narrowing row (Baghdad/Kut ideas s1, s2, s5, s7, x3, Ali 2026-10-07): the two lines as
 * cards, the days with how many cars each, the parts of the day, the day's small chart, and the
 * one-tap «نبّهني» when a day or part has no car. Copy from @driver/i18n; data from the board.
 */

const DAY_KEY: Record<BoardDayId, MessageKey> = { today: 'rajaa.day_today', tomorrow: 'rajaa.day_tomorrow', after: 'rajaa.day_after' };
const PART_KEY: Record<DayPartId, MessageKey> = { morning: 'rajaa.part_morning', noon: 'rajaa.part_noon', afternoon: 'rajaa.part_afternoon', night: 'rajaa.part_night' };

export function dayName(t: ReturnType<typeof useT>, id: BoardDayId): string {
  return t(DAY_KEY[id]);
}
export function partName(t: ReturnType<typeof useT>, id: DayPartId): string {
  return t(PART_KEY[id]);
}

/** What one line's card says (s1): its city, the trip, the seat, today's cars and the first one. */
export type CorridorSummary = { corridor: CorridorView; today: number; first: DepartureCard | null };

/**
 * «بغداد» and «الكوت» as two cards (s1) instead of small chips: the time on the road, the seat price,
 * how many cars today and the earliest. The picked line is outlined in the accent.
 */
export function CorridorCards({ items, value, onChange }: { items: readonly CorridorSummary[]; value: string; onChange: (id: string) => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  if (items.length < 2) return null;
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[3] }} accessibilityRole="radiogroup">
      {items.map(({ corridor: c, today, first }) => {
        const on = c.id === value;
        const trip = t('rajaa.corridor_trip', { duration: formatMinutes(c.travelMin, { locale }) });
        const cars = today > 0 ? t(countKey('rajaa.garage_count', today), { n: today }) : t('rajaa.corridor_none_today');
        return (
          <Pressable
            key={c.id}
            testID={`corridor-${c.id}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t('rajaa.corridor_a11y', { city: cityName(t, c.cityId), trip, price: iqd(c.seatPriceIqd, { locale }), cars })}
            onPress={() => {
              theme.haptic('selection');
              onChange(c.id);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minHeight: 44,
              padding: theme.space[3],
              gap: 2,
              borderRadius: theme.radius.lg,
              borderWidth: on ? 2 : 1,
              borderColor: on ? theme.colors.accent : theme.colors.border,
              backgroundColor: on ? theme.colors.accentTint : pressed ? theme.colors.surfaceSunken : theme.colors.surface,
            })}
          >
            <Text variant="title" weight={700}>
              {cityName(t, c.cityId)}
            </Text>
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {trip}
            </Text>
            <Text variant="label" weight={700} tabular>
              {iqd(c.seatPriceIqd, { locale })}
            </Text>
            <Text variant="caption" color={today > 0 ? 'text' : 'textMuted'} numberOfLines={1}>
              {cars}
            </Text>
            {first ? (
              <Text variant="caption" color="textMuted" numberOfLines={1} tabular>
                {t('rajaa.corridor_first', { time: clockLabel(first.departAt) })}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** «اليوم / 4 سيارات», «باچر / سيارتين», «عقب باچر / ماكو بعد» (s2): three equal segments, nothing scrolls off. */
export function DayStrip({ days, counts, value, onChange }: { days: readonly BoardDay[]; counts: Record<BoardDayId, number>; value: BoardDayId; onChange: (id: BoardDayId) => void }) {
  const t = useT();
  return (
    <SegmentedControl
      testIDPrefix="board-day"
      accessibilityLabel={t('rajaa.days_a11y')}
      value={value}
      onChange={onChange}
      options={days.map((d) => {
        const n = counts[d.id];
        const cars = n > 0 ? t(countKey('rajaa.garage_count', n), { n }) : t('rajaa.day_no_cars');
        return { value: d.id, label: dayName(t, d.id), detail: cars, accessibilityLabel: t('rajaa.day_cars', { day: dayName(t, d.id), cars }) };
      })}
    />
  );
}

/** «كل اليوم · الصبح · الظهر · العصر · الليل» (s5); parts already over are left out. */
export function PartChips({ parts, value, onChange }: { parts: readonly DayPartId[]; value: DayPartId | null; onChange: (id: DayPartId | null) => void }) {
  const t = useT();
  const options = [{ value: 'all' as const, label: t('rajaa.part_all') }, ...DAY_PART_IDS.filter((p) => parts.includes(p)).map((p) => ({ value: p, label: partName(t, p) }))];
  return <SegmentedControl testIDPrefix="board-part" accessibilityLabel={t('rajaa.parts_a11y')} value={value ?? 'all'} onChange={(v) => onChange(v === 'all' ? null : v)} options={options} />;
}

const CHART_MARKS = [
  { key: 'rajaa.chart_6am', bar: 2 },
  { key: 'rajaa.chart_noon', bar: 8 },
  { key: 'rajaa.chart_6pm', bar: 14 },
  { key: 'rajaa.chart_midnight', bar: 20 },
] as const;

/**
 * The day at a glance (x3): a bar per hour from 4 in the morning to 4 the next, the picked part's
 * hours in the accent, marks at 6 الصبح, 12 الظهر, 6 المسا and 12 بالليل. Read as one sentence.
 */
export function DayChart({ deps, day, part, dayLabel }: { deps: readonly Pick<DepartureCard, 'departAt'>[]; day: BoardDay; part: DayPartId | null; dayLabel: string }) {
  const theme = useTheme();
  const t = useT();
  const bars = hourBars(deps, day);
  const max = Math.max(1, ...bars);
  const busiest = bars.indexOf(Math.max(...bars));
  const span = part ? partSpan(day, part) : null;
  const hourStart = (i: number) => day.start.getTime() + (4 + i) * 3600_000;
  const inPart = (i: number) => !span || (hourStart(i) >= span.start.getTime() && hourStart(i) < span.end.getTime());
  const label = bars.every((b) => b === 0) ? t('rajaa.chart_none_a11y', { day: dayLabel }) : t('rajaa.chart_a11y', { day: dayLabel, time: clockLabel(new Date(hourStart(busiest))) });
  const H = 36;
  return (
    <View testID="board-chart" accessible accessibilityLabel={label} style={{ gap: theme.space[1] }}>
      <Text variant="caption" color="textMuted" weight={600}>
        {t('rajaa.chart_title')}
      </Text>
      {/* Hours run with the clock, left to right, like the time on every clock in town. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: H, direction: 'ltr' }}>
        {bars.map((b, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: b === 0 ? 3 : Math.max(6, Math.round((b / max) * H)),
              borderTopLeftRadius: 3,
              borderTopRightRadius: 3,
              backgroundColor: b === 0 ? theme.colors.border : inPart(i) ? theme.colors.accent : theme.colors.borderStrong,
              opacity: b === 0 || inPart(i) ? 1 : 0.35,
            }}
          />
        ))}
      </View>
      {/* Each mark sits under its own hour's bar (the bars start at 4 in the morning). */}
      <View style={{ height: 18, direction: 'ltr' }}>
        {CHART_MARKS.map(({ key, bar }) => (
          <View key={key} style={{ position: 'absolute', left: `${((bar + 0.5) / 24) * 100}%`, width: 72, marginLeft: -36, alignItems: 'center' }}>
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {t(key)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * A day or part with no car (s7): one tap posts the wish with what we already know (who travels,
 * one seat, from the garage); «أختار الوقت بنفسي» opens the full form.
 */
export function WishCard({
  when,
  seats,
  busy,
  onWish,
  onMore,
}: {
  /** «باچر الصبح», «اليوم العصر». */
  when: string;
  seats: string;
  busy: boolean;
  /** Null when the time is gone (nothing to wish for): only the full form is offered. */
  onWish: (() => void) | null;
  onMore: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  return (
    <Card testID="board-wish" tone="tint" elevation={0} padding={4}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'flex-start' }}>
          <Icon name="bell" size={22} color="accentText" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" weight={700}>
              {t('rajaa.wish_title', { when })}
            </Text>
            <Text variant="footnote" color="textMuted">
              {t('rajaa.wish_body', { seats, pickup: t('rajaa.wish_pickup_garage') })}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {onWish ? <Button testID="board-wish-cta" icon="bell" label={t('rajaa.wish_cta')} loading={busy} onPress={onWish} style={{ flex: 1 }} /> : null}
          <Button testID="board-wish-more" variant={onWish ? 'ghost' : 'secondary'} label={t('rajaa.wish_more')} onPress={onMore} style={onWish ? undefined : { flex: 1 }} />
        </View>
      </View>
    </Card>
  );
}
