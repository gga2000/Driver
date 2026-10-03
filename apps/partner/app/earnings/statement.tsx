import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { EarningsJobLine, EarningsPeriod } from '@driver/contracts';
import { Card, EmptyState, SegmentedControl, Skeleton, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { BreakdownCard, CashCapCard, JobList, PeriodNav } from '@/features/account/EarningsParts';
import { HandoverSheet } from '@/features/account/HandoverSheet';
import { dayMonth, startOfLocalDay, weekdayName } from '@/features/account/logic';
import { useEarningsPeriod } from '@/features/account/useEarningsPeriod';
import { jobsKey } from '@/features/work/logic';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

const PERIODS: readonly EarningsPeriod[] = ['day', 'week', 'month'];

/**
 * كشف الحساب — every job of the period with every pay component (money & ops §4: "Driver earnings live
 * in Partner with every component named"), grouped by day for a week or a month, the totals, and the
 * cash he moved. Opens on the period the tab was showing (`?period=week&anchor=…`).
 */
export default function Statement() {
  const theme = useTheme();
  const t = useT();
  const params = useLocalSearchParams<{ period?: string; anchor?: string }>();
  const initialPeriod = PERIODS.includes(params.period as EarningsPeriod) ? (params.period as EarningsPeriod) : 'week';
  const anchor = params.anchor ? new Date(params.anchor) : null;
  const e = useEarningsPeriod({ period: initialPeriod, anchor: anchor && !Number.isNaN(anchor.getTime()) ? anchor : null });
  const [handover, setHandover] = useState(false);
  const v = e.view;

  const options = PERIODS.map((p) => ({ value: p, label: t(`partner.earn_period_${p}`) }));
  const groups = v ? byDay(v.jobs) : [];

  return (
    <Screen testID="statement" edges={['bottom']}>
      <Stack.Screen options={{ title: t('partner.statement_title') }} />
      <View style={{ gap: theme.space[3] }}>
        <SegmentedControl options={options} value={e.period} onChange={e.setPeriod} accessibilityLabel={t('partner.statement_title')} />
        <PeriodNav label={e.label} onPrev={e.goPrev} onNext={e.goNext} canNext={e.canNext} />
      </View>

      {!v ? (
        <Card elevation={1} padding={5}>
          <Skeleton lines={6} />
        </Card>
      ) : (
        <View style={{ gap: theme.space[6], opacity: e.loading ? 0.6 : 1 }}>
          <BreakdownCard totals={v.totals} />

          <View style={{ gap: theme.space[3] }}>
            <Text variant="title" style={{ paddingHorizontal: theme.space[1] }}>
              {t('partner.statement_jobs_title', { n: v.totals.jobs })}
            </Text>
            {v.jobs.length === 0 ? (
              <Card elevation={0} padding={3}>
                <EmptyState icon="receipt" title={t('partner.earn_empty_title')} body={t('partner.earn_empty_body')} style={{ paddingVertical: theme.space[5] }} />
              </Card>
            ) : e.period === 'day' ? (
              <JobList testID="statement-jobs" jobs={v.jobs} withDay={false} />
            ) : (
              groups.map((g) => (
                <View key={g.key} style={{ gap: theme.space[2] }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: theme.space[1] }}>
                    <Text variant="label" weight={600}>{`${weekdayName(g.day, t)} ${dayMonth(g.day, t)}`}</Text>
                    <Text variant="label" color="textMuted" tabular>
                      {`${t('partner.statement_day_sum', { amount: amountParam(g.netIqd) })} · ${t(jobsKey(g.jobs), { n: g.jobs })}`}
                    </Text>
                  </View>
                  <JobList testID={`statement-day-${g.key}`} jobs={g.items} withDay={false} />
                </View>
              ))
            )}
          </View>

          <CashCapCard view={v} rangeLabel={e.label} onHandover={() => setHandover(true)} />
        </View>
      )}
      <HandoverSheet visible={handover} onClose={() => setHandover(false)} heldIqd={v?.cash.heldIqd ?? 0} />
    </Screen>
  );
}

function byDay(jobs: readonly EarningsJobLine[]) {
  const map = new Map<number, { key: string; day: Date; items: EarningsJobLine[]; netIqd: number; jobs: number }>();
  for (const j of jobs) {
    const day = startOfLocalDay(j.at);
    const g = map.get(day.getTime()) ?? { key: String(day.getTime()), day, items: [], netIqd: 0, jobs: 0 };
    g.items.push(j);
    g.netIqd += j.netIqd;
    if (j.tripId !== null || j.orderId !== null) g.jobs += 1;
    map.set(day.getTime(), g);
  }
  return [...map.values()].sort((a, b) => b.day.getTime() - a.day.getTime());
}
