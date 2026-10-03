import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { SegmentedControl, useTheme } from '@driver/ui';
import { OwnerOnly } from '@/components/OwnerOnly';
import { Page } from '@/components/Page';
import { DisputesView } from '@/features/money/DisputesView';
import { StatementView } from '@/features/money/StatementView';
import { TodayView } from '@/features/money/TodayView';
import { waitingCount, weekAnchor } from '@/features/money/logic';
import { useCashAccount, useDisputes, useMoneyToday, useStatement } from '@/features/money/queries';
import { useCurrentStore } from '@/features/store/queries';
import { localParts } from '@/lib/calendar';
import { useDates } from '@/lib/dates';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';

type Tab = 'today' | 'statement' | 'disputes';
const TABS: readonly Tab[] = ['today', 'statement', 'disputes'];

function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** الفلوس (owners only): اليوم · كشف الأسبوع · الشكاوى. `?tab=` deep-links a tab. */
export default function MoneyScreen() {
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

  if (store && !canSeeMoney) return <OwnerOnly title={t('merchant.nav.money')} testID="money" />;

  const waiting = disputes.data ? waitingCount(disputes.data, now) : 0;
  const select = (v: Tab) => {
    setTab(v);
    router.setParams({ tab: v });
  };
  return (
    <Page title={t('merchant.nav.money')} subtitle={store ? `${store.name} · ${dates.dow(localParts(now).dow)} ${dates.dayMonth(now)}` : undefined} testID="money" maxWidth={1160}>
      <View style={{ alignSelf: wide ? 'flex-start' : 'stretch', minWidth: wide ? 520 : undefined }}>
        <SegmentedControl<Tab>
          options={[
            { value: 'today', label: t('merchant.money.tab_today') },
            { value: 'statement', label: t('merchant.money.tab_statement') },
            { value: 'disputes', label: waiting > 0 ? t('merchant.money.tab_disputes_count', { count: waiting }) : t('merchant.money.tab_disputes') },
          ]}
          value={tab}
          onChange={select}
        />
      </View>
      {!orgId ? null : tab === 'today' ? (
        <TodayView merchantOrgId={orgId} today={today.data} cash={cash.data} now={now} wide={wide} onStatement={() => select('statement')} />
      ) : tab === 'statement' ? (
        <StatementView statement={statement.data} storeName={store?.name ?? ''} back={back} onBack={() => setBack((b) => b + 1)} onForward={() => setBack((b) => Math.max(0, b - 1))} now={now} wide={wide} />
      ) : (
        <DisputesView merchantOrgId={orgId} disputes={disputes.data} now={now} wide={wide} />
      )}
      <View style={{ height: theme.space[4] }} />
    </Page>
  );
}
