import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { STATS_DAY_BANDS, type StatsView } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Card, StarPattern, Text, useMotionPresets, useTheme } from '@driver/ui';
import { dishPhoto } from '@/features/home/dish-photos';
import { FoodPhoto } from '@/features/food-landing/FoodPhoto';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { baghdadDate, busiest, daysWithUs, gridDayKey, labelledColumn, onTimePercent, savedPer10k, shortMonthKey } from './format';
import { useStackColours } from './MonthColumns';

/**
 * «بالتفصيل»: the detail behind دفترك, one section per part of his life with us — his food (kitchens
 * tried of the town's, his kitchens and dishes), when he orders, the promise kept, his rides, his
 * الرجعة trips, how long he has been with us, his money and his points. A section with nothing in it
 * is left out. Every chart writes its numbers; none leans on colour alone.
 */
export function DetailTab({ v }: { v: StatsView }) {
  const theme = useTheme();
  const presets = useMotionPresets();
  const parts: Array<{ key: string; node: ReactNode }> = [];
  if (v.food.orders > 0) parts.push({ key: 'food', node: <FoodSection v={v} /> }, { key: 'when', node: <WhenSection v={v} /> }, { key: 'promise', node: <PromiseSection v={v} /> });
  if (v.rides.taxi + v.rides.tuktuk > 0) parts.push({ key: 'rides', node: <RidesSection v={v} /> });
  if (v.rajaa.baghdad + v.rajaa.kut > 0) parts.push({ key: 'rajaa', node: <RajaaSection v={v} /> });
  parts.push({ key: 'money', node: <MoneySection v={v} /> });
  if (v.points.earned + v.points.used + v.points.balance > 0) parts.push({ key: 'points', node: <PointsSection v={v} /> });
  if (v.firstOrderAt) parts.push({ key: 'since', node: <SinceSection first={v.firstOrderAt} /> });
  return (
    <View style={{ gap: theme.space[5] }}>
      {parts.map((p, i) => (
        <Animated.View key={p.key} entering={presets.panelIn(Math.min(i, 3) * 60)} testID={`stats-detail-${p.key}`}>
          {p.node}
        </Animated.View>
      ))}
    </View>
  );
}

/** A section title with its service's dot. */
function Section({ title, dot, children }: { title: string; dot: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} />
        <Text variant="section" face="display" accessibilityRole="header">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** Up to three figures side by side: the number big, its words under it. */
function Kpis({ items }: { items: Array<{ value: string; unit?: string; label: string; color?: string } | null> }) {
  const theme = useTheme();
  const shown = items.filter((x) => x !== null);
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
      {shown.map((k) => (
        <Card key={k.label} elevation={0} padding={3} style={{ flex: 1 }}>
          <View accessible accessibilityLabel={`${k.value} ${k.unit ?? ''} ${k.label}`}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Text variant="amount" face="display" tabular color={k.color ?? 'text'}>
                {k.value}
              </Text>
              {k.unit ? (
                <Text variant="caption" color="textMuted">
                  {k.unit}
                </Text>
              ) : null}
            </View>
            <Text variant="caption" color="textMuted">
              {k.label}
            </Text>
          </View>
        </Card>
      ))}
    </View>
  );
}

/** A label on the start side and its value on the end side. */
function Row({ label, value, strong }: { label: string; value: string; strong?: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.space[3], minHeight: 32 }}>
      <Text variant="body" color="textMuted" style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <Text variant="bodyStrong" tabular {...(strong ? { color: strong } : {})}>
        {value}
      </Text>
    </View>
  );
}

function FoodSection({ v }: { v: StatsView }) {
  const theme = useTheme();
  const t = useT();
  const colours = useStackColours();
  const pct = onTimePercent(v.food.promise);
  const town = Math.max(v.food.kitchensInTown, v.food.kitchens);
  const top = v.food.topKitchens;
  const most = Math.max(1, ...top.map((k) => k.orders));
  return (
    <Section title={t('stats.sec_food')} dot={colours.food}>
      <Kpis
        items={[
          { value: String(v.food.orders), label: t('stats.k_orders', { n: v.food.orders }) },
          v.food.doorMinutes ? { value: String(v.food.doorMinutes.average), unit: t('stats.unit_min'), label: t('stats.k_door_avg') } : null,
          pct !== null ? { value: `${pct}%`, label: t('stats.k_on_time') } : null,
        ]}
      />
      {town > 0 ? (
        <Card elevation={0} padding={4} testID="stats-tried">
          <View style={{ gap: theme.space[2] }}>
            <Text variant="bodyStrong">{t('stats.tried', { n: v.food.kitchens, total: town })}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {Array.from({ length: Math.min(town, 120) }, (_, i) => (
                <View key={i} style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: i < v.food.kitchens ? colours.food : theme.colors.surfaceSunken }} />
              ))}
            </View>
            {town > v.food.kitchens ? (
              <Text variant="footnote" color="textMuted">
                {t('stats.tried_left', { n: town - v.food.kitchens })}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}
      {top.length > 0 ? (
        <Card elevation={0} padding={4} testID="stats-kitchens">
          <View style={{ gap: theme.space[2] }}>
            <Text variant="bodyStrong">{t('stats.top_kitchens')}</Text>
            {top.map((k) => (
              <View key={k.name} style={{ gap: 2 }} accessible accessibilityLabel={`${k.name} ${t('month.times', { n: k.orders })}`}>
                <Text variant="footnote" numberOfLines={1}>
                  {k.name}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                  <View style={{ flex: 1, height: 10, borderRadius: 5, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }}>
                    <View style={{ width: `${(k.orders / most) * 100}%`, height: '100%', borderRadius: 5, backgroundColor: colours.food }} />
                  </View>
                  <Text variant="footnote" weight={700} tabular style={{ minWidth: 24, textAlign: 'center' }}>
                    {k.orders}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      {v.food.topDishes.length > 0 ? (
        <View style={{ gap: theme.space[2] }}>
          <Text variant="bodyStrong">{t('stats.top_dishes')}</Text>
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            {v.food.topDishes.map((d) => {
              const photo = dishPhoto(d.name);
              return (
                <Card key={d.catalogItemId} elevation={0} padding={0} style={{ flex: 1, overflow: 'hidden' }}>
                  {photo ? (
                    <View style={{ width: '100%', aspectRatio: 1, overflow: 'hidden' }}>
                      <FoodPhoto photo={photo} style={{ width: '100%', height: '100%' }} />
                    </View>
                  ) : (
                    <View style={{ width: '100%', aspectRatio: 1, backgroundColor: theme.services.food.card.bg }} />
                  )}
                  <View style={{ padding: theme.space[2], gap: 0 }}>
                    <Text variant="footnote" weight={600} numberOfLines={2}>
                      {d.name}
                    </Text>
                    <Text variant="caption" color="textMuted">
                      {t('month.times', { n: d.orders })}
                    </Text>
                  </View>
                </Card>
              );
            })}
          </View>
        </View>
      ) : null}
    </Section>
  );
}

const BAND_SHORT: Record<(typeof STATS_DAY_BANDS)[number], MessageKey> = {
  morning: 'stats.band_morning',
  noon: 'stats.band_noon',
  afternoon: 'stats.band_afternoon',
  sunset: 'stats.band_sunset',
  night: 'stats.band_night',
};
const BAND_LONG: Record<(typeof STATS_DAY_BANDS)[number], MessageKey> = {
  morning: 'stats.when_morning',
  noon: 'stats.when_noon',
  afternoon: 'stats.when_afternoon',
  sunset: 'stats.when_sunset',
  night: 'stats.when_night',
};

/** Weekdays (Saturday first) × five times of day, one saffron that deepens with the count; each cell writes its count. */
function WhenSection({ v }: { v: StatsView }) {
  const theme = useTheme();
  const t = useT();
  const colours = useStackColours();
  const food = theme.services.food;
  const ramp = [theme.colors.surfaceSunken, food.card.bg, theme.services.back.fill, food.fill, food.glow, food.card.dot];
  const max = Math.max(1, ...v.food.when.flat());
  const shade = (n: number) => (n === 0 ? 0 : Math.min(5, 1 + Math.floor(((n - 1) / max) * 5)));
  const top = busiest(v.food.when);
  return (
    <Section title={t('stats.sec_when')} dot={colours.food}>
      <Card elevation={0} padding={4} testID="stats-when">
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={{ width: 64 }} />
            {STATS_DAY_BANDS.map((b) => (
              <Text key={b} variant="caption" color="textMuted" align="center" style={{ flex: 1 }}>
                {t(BAND_SHORT[b])}
              </Text>
            ))}
          </View>
          {v.food.when.map((row, day) => (
            <View key={day} style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
              <Text variant="caption" color="textMuted" style={{ width: 64 }} numberOfLines={1}>
                {t(gridDayKey(day))}
              </Text>
              {row.map((n, band) => {
                const s = shade(n);
                return (
                  <View
                    key={band}
                    accessible
                    accessibilityLabel={`${t(gridDayKey(day))} ${t(BAND_LONG[STATS_DAY_BANDS[band]!])}: ${n}`}
                    style={{ flex: 1, height: 28, borderRadius: 6, backgroundColor: ramp[s], alignItems: 'center', justifyContent: 'center' }}
                  >
                    {n > 0 ? (
                      <Text variant="caption" weight={600} tabular color={s >= 5 ? theme.colors.surface : food.on}>
                        {n}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))}
          {top ? (
            <Text variant="footnote" style={{ marginTop: theme.space[2] }} testID="stats-when-top">
              {t('stats.when_top', { day: t(gridDayKey(top.day)), band: t(BAND_LONG[STATS_DAY_BANDS[top.band]!]), times: t('month.times', { n: top.n }) })}
            </Text>
          ) : null}
        </View>
      </Card>
    </Section>
  );
}

function PromiseSection({ v }: { v: StatsView }) {
  const theme = useTheme();
  const t = useT();
  const p = v.food.promise;
  const late = p.promised - p.onTime;
  if (p.promised === 0 && !v.food.doorMinutes) return null;
  return (
    <Section title={t('stats.sec_promise')} dot={theme.colors.text}>
      {p.promised > 0 ? (
        <Card elevation={0} padding={4} testID="stats-promise">
          <View style={{ gap: theme.space[2] }}>
            <Text variant="bodyStrong" tabular>
              {t('stats.promise_line', { on: p.onTime, all: p.promised })}
            </Text>
            <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {p.onTime > 0 ? <View style={{ flex: p.onTime, backgroundColor: theme.colors.success }} /> : null}
              {late > 0 ? <View style={{ flex: late, backgroundColor: theme.colors.textMuted }} /> : null}
            </View>
            {late > 0 ? (
              <Text variant="footnote" color="textMuted">
                {t('stats.promise_late', { n: late })}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}
      {v.food.doorMinutes ? (
        <Kpis
          items={[
            { value: String(v.food.doorMinutes.fastest), unit: t('stats.unit_min'), label: t('stats.k_fastest') },
            { value: String(v.food.doorMinutes.average), unit: t('stats.unit_min'), label: t('stats.k_avg') },
            { value: String(late), label: t('stats.k_late') },
          ]}
        />
      ) : null}
    </Section>
  );
}

function RidesSection({ v }: { v: StatsView }) {
  const theme = useTheme();
  const t = useT();
  const colours = useStackColours();
  return (
    <Section title={t('stats.sec_rides')} dot={colours.tuktuk}>
      <Kpis
        items={[
          { value: String(v.rides.tuktuk), label: t('stats.k_tuktuk'), color: theme.services.tuktuk.card.dot },
          { value: String(v.rides.taxi), label: t('stats.k_taxi'), color: theme.services.taxi.card.dot },
          v.rides.pickupWaitMinutes !== null ? { value: String(v.rides.pickupWaitMinutes), unit: t('stats.unit_min'), label: t('stats.k_wait') } : null,
        ]}
      />
      {v.rides.topPlace || v.rides.drivers > 0 ? (
        <Card elevation={0} padding={4}>
          <View style={{ gap: theme.space[1] }}>
            {v.rides.topPlace ? <Row label={t('stats.row_top_place')} value={t('stats.top_place_value', { name: v.rides.topPlace.name, times: t('month.times', { n: v.rides.topPlace.visits }) })} /> : null}
            {v.rides.drivers > 0 ? <Row label={t('stats.row_drivers')} value={String(v.rides.drivers)} /> : null}
          </View>
        </Card>
      ) : null}
    </Section>
  );
}

function RajaaSection({ v }: { v: StatsView }) {
  const theme = useTheme();
  const t = useT();
  const trips = theme.services.trips;
  const r = v.rajaa;
  const lines = [
    r.returnTrips > 0 ? t('stats.rajaa_return', { times: t('month.times', { n: r.returnTrips }) }) : null,
    r.frontSeats > 0 ? t('stats.rajaa_front', { times: t('month.times', { n: r.frontSeats }) }) : null,
    r.lapChildren > 0 ? t('stats.rajaa_lap', { n: r.lapChildren }) : null,
  ].filter((x) => x !== null);
  return (
    <Section title={t('stats.sec_rajaa')} dot={trips.card.dot}>
      <View style={{ backgroundColor: trips.fill, borderRadius: theme.radius.xl, overflow: 'hidden' }} testID="stats-rajaa">
        <StarPattern color={trips.pattern} opacity={0.18} />
        <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
          <View style={{ flexDirection: 'row', gap: theme.space[6] }}>
            {[
              { n: r.baghdad, label: t('stats.k_baghdad') },
              { n: r.kut, label: t('stats.k_kut') },
            ].map((c) => (
              <View key={c.label} accessible accessibilityLabel={`${c.label} ${c.n}`}>
                <Text variant="amount" face="display" tabular color={trips.on}>
                  {c.n}
                </Text>
                <Text variant="footnote" color={trips.sub}>
                  {c.label}
                </Text>
              </View>
            ))}
          </View>
          {lines.map((l) => (
            <Text key={l} variant="footnote" color={trips.on}>
              {l}
            </Text>
          ))}
        </View>
      </View>
    </Section>
  );
}

function MoneySection({ v }: { v: StatsView }) {
  const theme = useTheme();
  const t = useT();
  const per = savedPer10k(v.saved.totalIqd, v.money.spentIqd);
  const months = v.months.length > 1 ? v.months : [];
  const best = Math.max(0, ...months.map((m) => m.savedIqd));
  const H = 88;
  return (
    <Section title={t('stats.sec_money')} dot={theme.colors.accent}>
      <Card elevation={0} padding={4} testID="stats-money">
        <View style={{ gap: theme.space[1] }}>
          {per !== null && per > 0 ? (
            <>
              <Text variant="footnote" color="textMuted">
                {t('stats.per10k_lead')}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2], flexWrap: 'wrap' }}>
                <Text variant="numeralSm" face="display" tabular>
                  {amountParam(per)}
                </Text>
                <Text variant="bodyStrong">{t('stats.per10k')}</Text>
              </View>
            </>
          ) : null}
          <Row label={t('stats.row_spent')} value={t('stats.amount', { amount: amountParam(v.money.spentIqd) })} />
          <Row label={t('stats.row_saved')} value={t('stats.amount', { amount: amountParam(v.saved.totalIqd) })} strong="accentText" />
          {v.saved.madeGoodIqd > 0 ? <Row label={t('stats.row_made_good')} value={t('stats.amount', { amount: amountParam(v.saved.madeGoodIqd) })} /> : null}
        </View>
      </Card>
      {best > 0 ? (
        <Card elevation={0} padding={4} testID="stats-saved-months">
          <View style={{ gap: theme.space[2] }}>
            <Text variant="bodyStrong">{t('stats.saved_chart')}</Text>
            <View style={{ height: H + 22, flexDirection: 'row', alignItems: 'flex-end', gap: months.length > 14 ? 2 : 6, borderBottomWidth: 1, borderColor: theme.colors.border }}>
              {months.map((m, i) => {
                const top = m.savedIqd === best;
                const last = i === months.length - 1;
                return (
                  <View
                    key={m.month}
                    accessible
                    accessibilityLabel={`${t(shortMonthKey(m.month))}: ${t('stats.amount', { amount: amountParam(m.savedIqd) })}`}
                    style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}
                  >
                    {(top || last) && m.savedIqd > 0 ? (
                      <Text variant="caption" weight={700} tabular style={{ width: 64, flexShrink: 0, textAlign: 'center' }}>
                        {amountParam(m.savedIqd)}
                      </Text>
                    ) : null}
                    <View style={{ width: '100%', maxWidth: 22, height: Math.max(m.savedIqd > 0 ? 3 : 0, (m.savedIqd / best) * H), borderTopLeftRadius: 5, borderTopRightRadius: 5, backgroundColor: top ? theme.services.food.card.dot : theme.services.food.fill }} />
                  </View>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: months.length > 14 ? 2 : 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {months.map((m, i) => (
                <View key={m.month} style={{ flex: 1, alignItems: 'center' }}>
                  {labelledColumn(i, months.length) ? (
                    <Text variant="caption" color="textMuted" style={{ width: 64, flexShrink: 0, textAlign: 'center' }}>
                      {t(shortMonthKey(m.month))}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        </Card>
      ) : null}
    </Section>
  );
}

function PointsSection({ v }: { v: StatsView }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Section title={t('stats.sec_points')} dot={theme.services.back.fill}>
      <Kpis
        items={[
          { value: amountParam(v.points.earned), label: t('stats.k_earned') },
          { value: amountParam(v.points.used), label: v.points.used > 0 ? t('stats.k_used_iqd', { amount: amountParam(v.points.used * 10) }) : t('stats.k_used') },
          { value: amountParam(v.points.balance), label: t('stats.k_balance') },
        ]}
      />
    </Section>
  );
}

function SinceSection({ first }: { first: Date }) {
  const theme = useTheme();
  const t = useT();
  const d = baghdadDate(first);
  const days = daysWithUs(first, new Date());
  return (
    <Section title={t('stats.sec_since')} dot={theme.colors.accent}>
      <Card elevation={0} padding={4}>
        <View style={{ gap: theme.space[1] }}>
          <Row label={t('stats.row_first')} value={t('stats.first_value', { day: d.day, month: t(`time.month_${d.month}` as MessageKey), year: d.year })} />
          <Row label={t('stats.row_days')} value={t('stats.days_value', { n: days })} />
        </View>
      </Card>
    </Section>
  );
}
