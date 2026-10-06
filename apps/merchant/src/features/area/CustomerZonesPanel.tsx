import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Button, Skeleton, Text, useNetwork, useTheme } from '@driver/ui';
import { Meter, Panel, PanelRow } from '@/components/Panel';
import { useLocale, useT } from '@/lib/i18n';
import { CUSTOMER_HEAT, customerFills, customerRows, sharePercent, UNPRICED_FILL, zoneName, type CustomerRow } from './logic';
import { useCustomerZones, useDeliveryArea } from './queries';
import { ZoneMap } from './ZoneMap';

/** Heat legend swatch, px. */
const SWATCH = 14;

/**
 * «منين زبائنك» (maps program r6) on the insights screen: the town's zones shaded by how many of this
 * store's orders were delivered there over the chosen range, and the same zones ranked. Areas only
 * (spec D7): the server names a zone from 5 delivered orders up and folds the rest into «مناطق ثانية»;
 * no pin, address or customer ever reaches the app. The outlines come from the delivery-area read.
 */
export function CustomerZonesPanel({ merchantOrgId, days, wide }: { merchantOrgId: string | null; days: number; wide: boolean }) {
  const t = useT();
  const theme = useTheme();
  const net = useNetwork();
  const customers = useCustomerZones(merchantOrgId, days);
  const area = useDeliveryArea(merchantOrgId);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const caption = t('merchant.customers.caption', { days });

  const shell = (children: ReactNode) => (
    <Panel title={t('merchant.customers.title')} caption={caption} icon="people" testID="insights-customers">
      {children}
    </Panel>
  );

  if (!customers.data) {
    if (customers.isError) {
      return shell(
        <View style={{ gap: theme.space[3], alignItems: 'flex-start' }} testID="insights-customers-error">
          <Text variant="body" color="textMuted">
            {net.online ? t('merchant.customers.load_failed') : t('merchant.customers.offline')}
          </Text>
          <Button label={t('merchant.menu.retry')} icon="refresh" variant="secondary" onPress={() => void customers.refetch()} />
        </View>,
      );
    }
    return shell(<Skeleton height={220} radius={theme.radius.lg} />);
  }

  const data = customers.data;
  const privacy = (
    <Text variant="footnote" color="textMuted" testID="insights-customers-privacy">
      {t('merchant.customers.privacy', { min: data.minOrders })}
    </Text>
  );
  if (data.zones.length === 0) {
    return shell(
      <View style={{ gap: theme.space[2] }} testID="insights-customers-empty">
        <Text variant="body" color="textMuted">
          {t('merchant.customers.empty', { min: data.minOrders })}
        </Text>
        {privacy}
      </View>,
    );
  }

  const rows = customerRows(data);
  const fills = customerFills(rows);
  const geometry = area.data?.zones ?? [];
  const kitchen = area.data?.kitchen?.pin ?? geometry.find((z) => z.kitchen)?.centre ?? null;
  const map =
    geometry.length > 0 ? (
      <View style={{ flex: wide ? 1 : undefined, gap: theme.space[2] }}>
        <ZoneMap
          zones={geometry}
          kitchen={kitchen}
          shade={(z) => ({ fill: fills.get(z.key) ?? UNPRICED_FILL, dashed: false })}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          label={t('merchant.customers.map_label')}
          testID="insights-customers-map"
        />
        <HeatLegend />
      </View>
    ) : null;
  const list = (
    // Rows run edge to edge on a phone (like a flush panel); beside the map on a tablet they keep the inset.
    <View style={{ flex: wide ? 1 : undefined, marginHorizontal: wide ? 0 : -theme.space[5] }}>
      {rows.map((r, i) => (
        <CustomerZoneRow key={r.key} row={r} rank={i + 1} first={i === 0} selected={r.key === selectedKey} onPress={() => setSelectedKey(r.key)} />
      ))}
      {data.otherOrders > 0 ? (
        <PanelRow testID="insights-customers-other">
          <Text variant="body" color="textMuted" style={{ flex: 1 }}>
            {t('merchant.customers.other')}
          </Text>
          <Text variant="footnote" color="textMuted" tabular>
            {t('merchant.customers.orders', { count: data.otherOrders })}
          </Text>
        </PanelRow>
      ) : null}
    </View>
  );
  return shell(
    <>
      {wide ? (
        <View style={{ flexDirection: 'row', gap: theme.space[5], alignItems: 'flex-start' }}>
          {map}
          {list}
        </View>
      ) : (
        <>
          {map}
          {list}
        </>
      )}
      {privacy}
    </>,
  );
}

function CustomerZoneRow({ row, rank, first, selected, onPress }: { row: CustomerRow; rank: number; first: boolean; selected: boolean; onPress: () => void }) {
  const t = useT();
  const locale = useLocale();
  const theme = useTheme();
  return (
    <PanelRow first={first} onPress={onPress} testID={`insights-customers-row-${row.key}`} accessibilityLabel={zoneName(row, locale)}>
      <Text variant="label" color="textMuted" tabular style={{ width: 20 }}>
        {rank}
      </Text>
      <View style={{ flex: 1, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
          <Text variant={selected ? 'bodyStrong' : 'body'} numberOfLines={1} style={{ flex: 1 }}>
            {zoneName(row, locale)}
          </Text>
          <Text variant="footnote" color="textMuted" tabular>
            {t('merchant.customers.orders', { count: row.orders })}
          </Text>
        </View>
        <Meter value={row.share} color={CUSTOMER_HEAT[row.level]!} />
        <Text variant="caption" color="textMuted" tabular>
          {t('merchant.customers.share', { percent: sharePercent(row.share) })}
        </Text>
      </View>
    </PanelRow>
  );
}

function HeatLegend() {
  const t = useT();
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <Text variant="caption" color="textMuted">
        {t('merchant.insights.peak_less')}
      </Text>
      {CUSTOMER_HEAT.slice(1).map((c) => (
        <View key={c} style={{ width: SWATCH, height: SWATCH, borderRadius: 4, backgroundColor: c }} />
      ))}
      <Text variant="caption" color="textMuted">
        {t('merchant.insights.peak_more')}
      </Text>
    </View>
  );
}
