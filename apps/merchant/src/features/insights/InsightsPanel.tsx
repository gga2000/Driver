import { useState } from 'react';
import { View } from 'react-native';
import { SegmentedControl, Text, useTheme } from '@driver/ui';
import { Loadable } from '@/components/Loadable';
import { CustomerZonesPanel } from '@/features/area/CustomerZonesPanel';
import { useT } from '@/lib/i18n';
import { InsightsView } from './InsightsView';
import { useInsights } from './queries';

type Range = '7' | '30' | '90';

/**
 * The numbers (owner and staff): how honest the prep times are, rejections, peak hours, what sells, what
 * customers say, and — for the owner only, like money (Ali 2026-10-07) — where they are (maps r6).
 * Lives inside «يومك» since counter step 5 (g1).
 */
export function InsightsPanel({ merchantOrgId, owner, wide }: { merchantOrgId: string | null; owner: boolean; wide: boolean }) {
  const theme = useTheme();
  const t = useT();
  const [range, setRange] = useState<Range>('30');
  const days = Number(range);
  const insights = useInsights(merchantOrgId, days);
  return (
    <View testID="insights" style={{ gap: theme.space[4] }}>
      <View style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'stretch', justifyContent: 'space-between', gap: theme.space[2] }}>
        {insights.data ? <InsightsCaption orders={insights.data.orders} days={days} /> : <View />}
        <View style={{ minWidth: wide ? 300 : undefined }}>
          <SegmentedControl<Range>
            options={[
              { value: '7', label: t('merchant.insights.range_7') },
              { value: '30', label: t('merchant.insights.range_30') },
              { value: '90', label: t('merchant.insights.range_90') },
            ]}
            value={range}
            onChange={setRange}
          />
        </View>
      </View>
      <Loadable query={insights} skeleton={<InsightsView data={undefined} wide={wide} />} failed={t('merchant.insights.load_failed')} testID="insights-view">
        {(data) => <InsightsView data={data} wide={wide} />}
      </Loadable>
      {owner ? <CustomerZonesPanel merchantOrgId={merchantOrgId} days={days} wide={wide} /> : null}
    </View>
  );
}

function InsightsCaption({ orders, days }: { orders: number; days: number }) {
  const t = useT();
  return (
    <Text variant="label" color="textMuted">
      {t('merchant.insights.subtitle', { days, orders })}
    </Text>
  );
}
