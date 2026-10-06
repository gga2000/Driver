import { useState } from 'react';
import { View } from 'react-native';
import { SegmentedControl } from '@driver/ui';
import { Page } from '@/components/Page';
import { CustomerZonesPanel } from '@/features/area/CustomerZonesPanel';
import { InsightsView } from '@/features/insights/InsightsView';
import { useInsights } from '@/features/insights/queries';
import { useCurrentStore } from '@/features/store/queries';
import { useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';

type Range = '7' | '30' | '90';

/** الإحصائيات (owner and staff): how honest the prep times are, rejections, peak hours, what sells, what customers say, and where they are (maps r6). */
export default function InsightsScreen() {
  const t = useT();
  const { wide } = useLayout();
  const { store } = useCurrentStore();
  const [range, setRange] = useState<Range>('30');
  const days = Number(range);
  const insights = useInsights(store?.orgId ?? null, days);
  const picker = (
    <View style={{ minWidth: wide ? 300 : undefined, alignSelf: wide ? undefined : 'stretch' }}>
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
  );
  return (
    <Page
      title={t('merchant.nav.insights')}
      subtitle={insights.data ? t('merchant.insights.subtitle', { days, orders: insights.data.orders }) : store?.name}
      testID="insights"
      maxWidth={1160}
      aside={wide ? picker : undefined}
    >
      {wide ? null : picker}
      <InsightsView data={insights.data} wide={wide} />
      <CustomerZonesPanel merchantOrgId={store?.orgId ?? null} days={days} wide={wide} />
    </Page>
  );
}
