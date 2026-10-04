import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { Button, Card, EmptyState, IconButton, SegmentedControl, Skeleton, Text, useTheme } from '@driver/ui';
import type { EarningsPeriod } from '@driver/contracts';
import { Screen } from '@/components/Screen';
import { BreakdownCard, CashCapCard, EarningsHero, JobList } from '@/features/account/EarningsParts';
import { HandoverSheet } from '@/features/account/HandoverSheet';
import { useEarningsPeriod } from '@/features/account/useEarningsPeriod';
import { useStatus } from '@/features/work/queries';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

const LATEST = 4;

/**
 * الأرباح — the money tab. Day / week / month (and earlier ones with the arrows): the net counting up
 * on a dark hero with the chart, where it came from (pay, tips, bonuses, guarantee top-ups, our take
 * shown openly), cash in hand against the cap with the "سلّم الفلوس" hand-over code, and the latest
 * jobs, each opening to every pay component. The full list lives on the statement.
 */
export default function EarningsTab() {
  const theme = useTheme();
  const t = useT();
  const e = useEarningsPeriod();
  const status = useStatus().data;
  const [handover, setHandover] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const v = e.view;
  const canDrive = status?.canDrive ?? true;
  const withDay = e.period !== 'day';

  const options: { value: EarningsPeriod; label: string }[] = [
    { value: 'day', label: t('partner.earn_period_day') },
    { value: 'week', label: t('partner.earn_period_week') },
    { value: 'month', label: t('partner.earn_period_month') },
  ];
  const openStatement = () =>
    router.push({ pathname: '/earnings/statement', params: { period: e.period, ...(e.anchor ? { anchor: e.anchor.toISOString() } : {}) } });

  return (
    <Screen
      testID="earnings-tab"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void e.refetch().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="heading" accessibilityRole="header">
          {t('partner.nav_earnings')}
        </Text>
        <IconButton testID="open-statement" icon="receipt" accessibilityLabel={t('partner.statement_title')} variant="tonal" onPress={openStatement} />
      </View>

      <View style={{ gap: theme.space[4] }}>
        <SegmentedControl options={options} value={e.period} onChange={e.setPeriod} accessibilityLabel={t('partner.nav_earnings')} />
        <EarningsHero
          view={v}
          period={e.period}
          rangeLabel={e.label}
          prevLabel={e.prevLabel}
          prevNetIqd={e.prevNetIqd}
          onPrev={e.goPrev}
          onNext={e.goNext}
          canNext={e.canNext}
          buckets={e.buckets}
          loading={e.loading}
        />
      </View>

      {!v ? (
        <Card elevation={1} padding={5}>
          <Skeleton lines={4} />
        </Card>
      ) : (
        <>
          {v.totals.netIqd !== 0 || v.totals.jobs > 0 ? <BreakdownCard totals={v.totals} /> : null}
          {canDrive ? <CashCapCard view={v} rangeLabel={e.label} onHandover={() => setHandover(true)} /> : null}
          {v.payoutDueIqd > 0 ? (
            <Card elevation={0} padding={4} tone="sunken">
              <Text variant="footnote" color="textMuted">
                {t('partner.earn_payout_due', { amount: amountParam(v.payoutDueIqd) })}
              </Text>
            </Card>
          ) : null}
          <View style={{ gap: theme.space[3] }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: theme.space[1] }}>
              <Text variant="title">{t('partner.earn_jobs_latest')}</Text>
              {v.jobs.length > LATEST ? (
                <Text variant="label" color="accentText" weight={600} onPress={openStatement} accessibilityRole="link">
                  {t('partner.statement_jobs_title', { n: v.jobs.length })}
                </Text>
              ) : null}
            </View>
            {v.jobs.length > 0 ? (
              <JobList testID="latest-jobs" jobs={v.jobs.slice(0, LATEST)} withDay={withDay} />
            ) : (
              <Card elevation={0} padding={3}>
                <EmptyState icon="receipt" title={t('partner.earn_empty_title')} body={t('partner.earn_empty_body')} style={{ paddingVertical: theme.space[5] }} />
              </Card>
            )}
            <Button testID="statement-cta" label={t('partner.earn_show_all')} icon="receipt" variant="secondary" fullWidth onPress={openStatement} />
          </View>
        </>
      )}
      <HandoverSheet visible={handover} onClose={() => setHandover(false)} heldIqd={v?.cash.heldIqd ?? status?.cash.heldIqd ?? 0} owedIqd={v?.cap.owedIqd ?? status?.cash.owedIqd ?? 0} />
    </Screen>
  );
}
