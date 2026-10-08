import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { SegmentedControl, useTheme } from '@driver/ui';
import { both, Loadable } from '@/components/Loadable';
import { Page } from '@/components/Page';
import { DayStrip } from '@/features/day/DayStrip';
import { useDaySummary } from '@/features/day/queries';
import { InsightsPanel } from '@/features/insights/InsightsPanel';
import { DisputesView } from '@/features/money/DisputesView';
import { StatementView } from '@/features/money/StatementView';
import { TodayView } from '@/features/money/TodayView';
import { waitingCount, weekAnchor } from '@/features/money/logic';
import { useCashAccount, useDisputes, useMoneyToday, useStatement } from '@/features/money/queries';
import { useCurrentStore, useStoreStatus } from '@/features/store/queries';
import { localParts } from '@/lib/calendar';
import { useDates } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';

type Tab = 'today' | 'statement' | 'disputes' | 'insights';
const TABS: readonly Tab[] = ['today', 'statement', 'disputes', 'insights'];

function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/**
 * «يومك» (counter step 5, f1 f2 g1): the day so far on top, then for the owner his money as it works
 * today (اليوم · كشف الأسبوع · الشكاوى) and the numbers (الأرقام); staff see the day and the numbers,
 * never money. `?tab=` deep-links a tab (`/insights` opens الأرقام).
 */
export default function DayScreen() {
  const theme = useTheme();
  const t = useT();
  const dates = useDates();
  const { wide } = useLayout();
  const { store, canSeeMoney } = useCurrentStore();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(TABS.includes(params.tab as Tab) ? (params.tab as Tab) : 'today');
  const [back, setBack] = useState(0);
  const now = useNow();
  const orgId = store?.orgId ?? null;
  const weekOf = useMemo(() => weekAnchor(now, back), [now, back]);

  const today = useMoneyToday(orgId, canSeeMoney && tab === 'today');
  const cash = useCashAccount(orgId, canSeeMoney && tab === 'today');
  const statement = useStatement(orgId, weekOf, canSeeMoney && tab === 'statement');
  const disputes = useDisputes(orgId, canSeeMoney);
  const status = useStoreStatus(orgId);
  const summary = useDaySummary(orgId, status.data ? String(status.data.open) : '');

  const waiting = disputes.data ? waitingCount(disputes.data, now) : 0;
  const select = (v: Tab) => {
    setTab(v);
    router.setParams({ tab: v });
  };
  return (
    <Page title={t('merchant.nav.day')} subtitle={store ? `${store.name} · ${dates.dow(localParts(now).dow)} ${dates.dayMonth(now)}` : undefined} testID="money" maxWidth={1160}>
      <Loadable query={both(status, summary)} compact stale={false} skeleton={<DayStrip summary={undefined} waiting={0} wide={wide} />} failed={t('merchant.dayscreen.day_failed')} testID="day-strip">
        {([, day]) => <DayStrip summary={day} waiting={waiting} wide={wide} {...(canSeeMoney ? { onWaiting: () => select('disputes') } : {})} />}
      </Loadable>
      {store && !canSeeMoney ? (
        <InsightsPanel merchantOrgId={orgId} owner={false} wide={wide} />
      ) : (
        <View style={{ alignSelf: wide ? 'flex-start' : 'stretch', minWidth: wide ? 640 : undefined }}>
          <SegmentedControl<Tab>
            options={[
              { value: 'today', label: t('merchant.money.tab_today') },
              { value: 'statement', label: t('merchant.dayscreen.tab_week') },
              { value: 'disputes', label: waiting > 0 ? t('merchant.money.tab_disputes_count', { count: waiting }) : t('merchant.money.tab_disputes') },
              { value: 'insights', label: t('merchant.dayscreen.tab_numbers') },
            ]}
            value={tab}
            onChange={select}
          />
        </View>
      )}
      {!orgId || !canSeeMoney ? null : tab === 'insights' ? (
        <InsightsPanel merchantOrgId={orgId} owner wide={wide} />
      ) : tab === 'today' ? (
        <Loadable query={both(today, cash)} skeleton={<TodayView merchantOrgId={orgId} today={undefined} cash={undefined} now={now} wide={wide} onStatement={() => undefined} />} failed={t('merchant.money.load_failed')} testID="money-today">
          {([day, account]) => <TodayView merchantOrgId={orgId} today={day} cash={account} now={now} wide={wide} onStatement={() => select('statement')} />}
        </Loadable>
      ) : tab === 'statement' ? (
        <Loadable query={statement} skeleton={<StatementView statement={undefined} storeName="" back={back} onBack={() => undefined} onForward={() => undefined} now={now} wide={wide} />} failed={t('merchant.money.load_failed')} testID="money-statement">
          {(week) => <StatementView statement={week} storeName={store?.name ?? ''} back={back} onBack={() => setBack((b) => b + 1)} onForward={() => setBack((b) => Math.max(0, b - 1))} now={now} wide={wide} />}
        </Loadable>
      ) : (
        <Loadable query={disputes} skeleton={<DisputesView merchantOrgId={orgId} disputes={undefined} now={now} wide={wide} />} failed={t('merchant.money.load_failed')} testID="money-disputes">
          {(list) => <DisputesView merchantOrgId={orgId} disputes={list} now={now} wide={wide} />}
        </Loadable>
      )}
      <View style={{ height: theme.space[4] }} />
    </Page>
  );
}
