import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { baghdadMonth, MonthKey, type StatsPeriod } from '@driver/contracts';
import { EmptyState, Icon, IconButton, RetryState, retryKindFor, SegmentedControl, SketchScene, Skeleton, Text, useNetwork, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { monthLabel, monthSteps } from '@/features/account/month';
import { useLocale, useT } from '@/lib/i18n';
import { DetailTab } from './DetailTab';
import { LedgerTab } from './LedgerTab';
import { useStats } from './queries';

type Tab = 'ledger' | 'map' | 'detail';
const TABS: readonly Tab[] = ['ledger', 'map', 'detail'];

/**
 * «دفترك ويا درايفر» (stats & savings, 2026-10-11): the person's own record — what came off his
 * bills, what he ordered and rode each month, and the detail behind it — for this month, this year
 * or since the start. Three tabs: دفترك, خريطتك (his own trips on the map) and بالتفصيل. Every figure
 * is the server's; the page is private and says so. Replaces «شهرك» at the same address (/month).
 */
export function StatsScreen({ initialMonth }: { initialMonth?: string | undefined }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const current = baghdadMonth(new Date());
  const asked = MonthKey.safeParse(initialMonth);
  const [tab, setTab] = useState<Tab>('ledger');
  // Opened for a month (the month-start card, «شهرك» links): that month; otherwise the year so far.
  const [period, setPeriod] = useState<StatsPeriod>(asked.success ? 'month' : 'year');
  const [month, setMonth] = useState<MonthKey>(asked.success && asked.data <= current ? asked.data : current);
  const q = useStats(period, month);
  const v = q.data && q.data.period === period && (period !== 'month' || q.data.month === month) ? q.data : null;
  const steps = v && period === 'month' ? monthSteps(month, v.earliestMonth, current) : { prev: null, next: null };
  const label = monthLabel(month);

  return (
    <Screen edges={['bottom']} testID="stats">
      <TabRow tab={tab} onChange={setTab} />
      <SegmentedControl<StatsPeriod>
        testIDPrefix="stats-period"
        accessibilityLabel={t('stats.period_label')}
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'month', label: t('stats.period_month') },
          { value: 'year', label: t('stats.period_year', { year: current.slice(0, 4) }) },
          { value: 'all', label: t('stats.period_all') },
        ]}
      />
      {period === 'month' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[2] }}>
          <IconButton testID="stats-prev" icon="chevron-back" accessibilityLabel={t('month.prev')} disabled={!steps.prev} onPress={() => steps.prev && setMonth(steps.prev)} />
          <Text variant="title" accessibilityRole="header" align="center" style={{ flex: 1 }} testID="stats-month">
            {t('month.label', { month: t(label.nameKey), year: label.year })}
          </Text>
          <IconButton testID="stats-next" icon="chevron-forward" accessibilityLabel={t('month.next')} disabled={!steps.next} onPress={() => steps.next && setMonth(steps.next)} />
        </View>
      ) : null}

      {q.isError && !v ? (
        <RetryState
          kind={retryKindFor({ net, error: q.error })}
          locale={locale}
          art={net.state !== 'online' ? <SketchScene name="offline" /> : undefined}
          {...(retryKindFor({ net, error: q.error }) === 'server' ? { title: t('month.load_error') } : {})}
          onRetry={() => void q.refetch()}
        />
      ) : !v ? (
        <View style={{ gap: theme.space[3] }} testID="stats-loading">
          <Skeleton height={180} />
          <Skeleton height={200} />
          <Skeleton height={160} />
        </View>
      ) : tab === 'map' ? (
        <EmptyState icon="map-pin" art={<SketchScene name="safe_arrival" />} title={t('stats.map_soon_title')} body={t('stats.map_soon_body')} />
      ) : !v.hasActivity ? (
        <EmptyState
          icon="receipt"
          art={<SketchScene name="empty_orders" />}
          title={period === 'month' && month !== current ? t('month.empty_title') : t('month.empty_now_title')}
          body={t('month.empty_body')}
          action={{ label: t('month.order_cta'), onPress: () => router.push('/restaurants') }}
        />
      ) : tab === 'ledger' ? (
        <LedgerTab v={v} />
      ) : (
        <DetailTab v={v} />
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2], paddingVertical: theme.space[2] }}>
        <Icon name="shield" size={16} color="textMuted" />
        <Text variant="caption" color="textMuted" testID="stats-private">
          {t('month.private')}
        </Text>
      </View>
    </Screen>
  );
}

/** دفترك · خريطتك · بالتفصيل: underlined tabs, the chosen one in ink over a saffron line. */
function TabRow({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={t('stats.tabs_label')} style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: theme.colors.border }}>
      {TABS.map((k) => {
        const on = k === tab;
        return (
          <Pressable
            key={k}
            testID={`stats-tab-${k}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(k)}
            style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderColor: on ? theme.colors.accent : 'transparent', marginBottom: -1 }}
          >
            <Text variant="bodyStrong" compact color={on ? 'text' : 'textMuted'}>
              {t(`stats.tab_${k}` as const)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
