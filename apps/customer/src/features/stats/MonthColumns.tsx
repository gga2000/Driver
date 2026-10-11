import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import type { StatsMonth } from '@driver/contracts';
import { Card, Text, useTheme } from '@driver/ui';
import { monthLabel } from '@/features/account/month';
import { useT } from '@/lib/i18n';
import { columnTotal, labelledColumn, periodTotals, shortMonthKey, STACK, type StackKey } from './format';

const BARS_HEIGHT = 112;
const SEGMENT_GAP = 2;

/**
 * Stacked month columns: meals, tuktuk, taxi and الرجعة per month, oldest at the start (the right in
 * Arabic). The colours are the services' own and pass colour-blind checks, but they sit under 3:1 on
 * cream, so the legend names every one with its count. Tap a month for its own counts; tap again for
 * the whole period. The columns rise once when the numbers arrive and then stay still.
 */
export function MonthColumns({ months }: { months: readonly StatsMonth[] }) {
  const theme = useTheme();
  const t = useT();
  const colours = useStackColours();
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...months.map(columnTotal));
  const grow = useSharedValue(theme.reduceMotion ? 1 : 0);
  const key = months.map((m) => `${m.month}:${columnTotal(m)}`).join(',');

  useEffect(() => {
    setPicked(null);
    if (theme.reduceMotion) {
      grow.value = 1;
      return;
    }
    grow.value = 0;
    grow.value = withDelay(120, withTiming(1, { duration: theme.motion.duration.deliberate, easing: Easing.bezier(...theme.motion.bezier.decelerate) }));
  }, [key, grow, theme.reduceMotion, theme.motion]);

  const rise = useAnimatedStyle(() => ({ transform: [{ scaleY: grow.value }] }));
  const shown = picked !== null ? months[picked] : null;
  const counts = shown ?? periodTotals(months);

  return (
    <Card elevation={0} padding={4} testID="stats-columns">
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space[2] }}>
          <Text variant="bodyStrong" accessibilityRole="header">
            {shown ? t(monthLabel(shown.month).nameKey) : t('stats.chart_title')}
          </Text>
          <Text variant="caption" color="textMuted">
            {t('stats.chart_hint')}
          </Text>
        </View>

        <View style={{ height: BARS_HEIGHT + 20, flexDirection: 'row', alignItems: 'flex-end', gap: months.length > 14 ? 2 : 6, borderBottomWidth: 1, borderColor: theme.colors.border }}>
          {months.map((m, i) => {
            const total = columnTotal(m);
            const on = picked === i;
            const dim = picked !== null && !on;
            const label = t('stats.chart_a11y', { month: t(monthLabel(m.month).nameKey), food: m.food, taxi: m.taxi, tuktuk: m.tuktuk, rajaa: m.rajaa });
            return (
              <Pressable
                key={m.month}
                testID={`stats-col-${m.month}`}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: on }}
                onPress={() => setPicked(on ? null : i)}
                hitSlop={{ top: 8, bottom: 8 }}
                style={{ flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center' }}
              >
                {on ? (
                  <Text variant="caption" weight={700} tabular face="display" style={{ marginBottom: 2 }}>
                    {total}
                  </Text>
                ) : null}
                <Animated.View style={[{ width: '100%', maxWidth: 22, height: (total / max) * BARS_HEIGHT, justifyContent: 'flex-end', opacity: dim ? 0.45 : 1, transformOrigin: 'bottom' }, rise]}>
                  {[...STACK].reverse().map((k, j, all) => {
                    if (!m[k]) return null;
                    const isTop = all.slice(0, j).every((above) => !m[above]);
                    const h = (m[k] / total) * ((total / max) * BARS_HEIGHT);
                    return (
                      <View
                        key={k}
                        style={{
                          height: Math.max(2, h - SEGMENT_GAP),
                          marginTop: isTop ? 0 : SEGMENT_GAP,
                          backgroundColor: colours[k],
                          borderTopLeftRadius: isTop ? 5 : 2,
                          borderTopRightRadius: isTop ? 5 : 2,
                          borderBottomLeftRadius: 2,
                          borderBottomRightRadius: 2,
                        }}
                      />
                    );
                  })}
                </Animated.View>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: months.length > 14 ? 2 : 6, marginTop: -theme.space[2] }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {months.map((m, i) => (
            <View key={m.month} style={{ flex: 1, alignItems: 'center', overflow: 'visible' }}>
              {labelledColumn(i, months.length) || picked === i ? (
                <Text variant="caption" color={picked === i ? 'text' : 'textMuted'} weight={picked === i ? 700 : 400} style={{ width: 64, flexShrink: 0, textAlign: 'center' }}>
                  {t(shortMonthKey(m.month))}
                </Text>
              ) : null}
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space[4], rowGap: theme.space[1] }} testID="stats-legend">
          {STACK.map((k) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: counts[k] ? 1 : 0.5 }}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: colours[k] }} />
              <Text variant="footnote" tabular>
                {t(`stats.legend_${k}` as const, { n: counts[k] })}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Card>
  );
}

/** The service colours of the stack, from the theme (food saffron, tuktuk plum, taxi gold, الرجعة date brown). */
export function useStackColours(): Record<StackKey, string> {
  const { services } = useTheme();
  return { food: services.food.glow, tuktuk: services.tuktuk.fill, taxi: services.taxi.glow, rajaa: services.trips.card.dot };
}
