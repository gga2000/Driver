import { useState, type ReactNode } from 'react';
import { Linking, View } from 'react-native';
import type { DeliveryAreaZone, MerchantDeliveryArea } from '@driver/contracts';
import { EmptyState, RetryState, Skeleton, Text, useNetwork, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { Page } from '@/components/Page';
import { Panel, PanelRow, Tag } from '@/components/Panel';
import { useCurrentStore } from '@/features/store/queries';
import { SUPPORT_PHONE } from '@/lib/env';
import { useLocale, useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { amountParam, iqd } from '@/lib/money';
import { clock12 } from '@/lib/time';
import { feeShade, legendRows, pausedCount, PAUSED_FILL, selectedZone, zoneName, zoneRows } from './logic';
import { useDeliveryArea } from './queries';
import { ZoneMap } from './ZoneMap';

/** Legend swatch size, px. */
const SWATCH = 18;

/**
 * «منطقة التوصيل» (maps program r5): every zone of the town coloured by the delivery fee a customer
 * there pays for this store's food, the legend of those amounts, and the zone the owner tapped. Read
 * only: every amount is the server's quote (the one checkout charges); nothing is priced here, and
 * nothing here changes a fee. Owner and staff see the same.
 */
export function DeliveryAreaScreen() {
  const t = useT();
  const theme = useTheme();
  const net = useNetwork();
  const { store } = useCurrentStore();
  const area = useDeliveryArea(store?.orgId ?? null);
  const frame = (children: ReactNode) => (
    <Page title={t('merchant.area.title')} back testID="delivery-area" maxWidth={1160}>
      {children}
    </Page>
  );

  if (!area.data) {
    if (area.isError) {
      return frame(
        <RetryState
          kind={net.online ? 'unreachable' : 'offline'}
          title={net.online ? t('merchant.area.load_failed') : undefined}
          retryLabel={t('merchant.menu.retry')}
          onRetry={() => void area.refetch()}
          testID="delivery-area-error"
        />,
      );
    }
    return frame(
      <View style={{ gap: theme.space[4] }} testID="delivery-area-loading">
        <Skeleton height={320} radius={theme.radius.xl} />
        <Skeleton height={160} radius={theme.radius.xl} />
      </View>,
    );
  }

  const data = area.data;
  if (!data.kitchen) {
    return frame(
      <EmptyState
        icon="map-pin"
        title={t('merchant.area.no_kitchen_title')}
        body={t('merchant.area.no_kitchen_body')}
        action={{ label: t('merchant.more.support'), onPress: () => void Linking.openURL(`tel:${SUPPORT_PHONE}`) }}
      />,
    );
  }
  if (data.zones.length === 0) {
    return frame(<EmptyState icon="map-pin" title={t('merchant.area.empty_title')} body={t('merchant.area.empty_body')} />);
  }
  return frame(<AreaBody data={data} stale={!net.online} />);
}

function AreaBody({ data, stale }: { data: MerchantDeliveryArea; stale: boolean }) {
  const t = useT();
  const theme = useTheme();
  const { wide } = useLayout();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = selectedZone(data.zones, selectedKey);
  const kitchenZone = data.zones.find((z) => z.kitchen);
  const kitchenPin = data.kitchen?.pin ?? kitchenZone?.centre ?? null;

  const map = (
    <Panel testID="delivery-area-map" style={wide ? { flex: 1.35 } : undefined}>
      <ZoneMap
        zones={data.zones}
        kitchen={kitchenPin}
        shade={(z) => feeShade(z, data.bands.length)}
        selectedKey={selected?.key ?? null}
        onSelect={setSelectedKey}
        label={t('merchant.area.map_label')}
      />
      <Text variant="footnote" color="textMuted">
        {t('merchant.area.tap_hint')}
      </Text>
    </Panel>
  );
  const side = (
    <View style={{ gap: wide ? theme.space[5] : theme.space[4], flex: wide ? 1 : undefined }}>
      {selected ? <SelectedZone zone={selected} /> : null}
      <Legend data={data} />
    </View>
  );
  return (
    <>
      <Text variant="body" color="textMuted">
        {t('merchant.area.intro')}
      </Text>
      {stale ? (
        <View testID="delivery-area-offline" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
          <MIcon name="wifi-off" size={18} color="textMuted" />
          <Text variant="label" color="textMuted" style={{ flex: 1 }}>
            {t('merchant.area.offline_stale')}
          </Text>
        </View>
      ) : null}
      {wide ? (
        <View style={{ flexDirection: 'row', gap: theme.space[5], alignItems: 'flex-start' }}>
          {map}
          {side}
        </View>
      ) : (
        <>
          {map}
          {side}
        </>
      )}
      <ZoneList zones={data.zones} selectedKey={selected?.key ?? null} onSelect={setSelectedKey} />
      <Text variant="caption" color="textMuted" align="center">
        {t('merchant.area.priced_at', { time: clock12(data.pricedAt) })}
      </Text>
    </>
  );
}

function SelectedZone({ zone }: { zone: DeliveryAreaZone }) {
  const t = useT();
  const locale = useLocale();
  const theme = useTheme();
  const body =
    zone.service === 'paused' ? t('merchant.area.paused_hint') : zone.service === 'no_price' ? t('merchant.area.no_price_hint') : null;
  return (
    <Panel testID="delivery-area-selected" tone="tint">
      <View style={{ gap: theme.space[2] }} accessibilityLiveRegion="polite">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap' }}>
          <Text variant="title" style={{ flexShrink: 1 }}>
            {zoneName(zone, locale)}
          </Text>
          {zone.kitchen ? <Tag label={t('merchant.area.your_zone')} tone="accent" icon="store" /> : null}
          {zone.service === 'paused' ? <Tag label={t('merchant.area.paused')} tone="warning" /> : null}
        </View>
        {zone.feeIqd !== null ? (
          <Text variant="bodyStrong" tabular testID="delivery-area-selected-fee">
            {t('merchant.area.selected_fee', { amount: amountParam(zone.feeIqd) })}
          </Text>
        ) : null}
        {body ? (
          <Text variant="footnote" color="textMuted">
            {body}
          </Text>
        ) : null}
      </View>
    </Panel>
  );
}

function Legend({ data }: { data: MerchantDeliveryArea }) {
  const t = useT();
  const locale = useLocale();
  const theme = useTheme();
  const rows = legendRows(data);
  const paused = pausedCount(data.zones);
  const swatch = (fill: string, dashed = false) => (
    <View style={{ width: SWATCH, height: SWATCH, borderRadius: 5, backgroundColor: fill, borderWidth: dashed ? 1.5 : 0, borderStyle: dashed ? 'dashed' : 'solid', borderColor: theme.colors.textMuted }} />
  );
  return (
    <Panel title={t('merchant.area.legend_title')} icon="cash" testID="delivery-area-legend">
      {rows.map((r) => (
        <View key={r.feeIqd} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 32 }}>
          {swatch(r.color)}
          <Text variant="bodyStrong" tabular style={{ flex: 1 }}>
            {iqd(r.feeIqd, { locale })}
          </Text>
          <Text variant="footnote" color="textMuted" tabular>
            {t('merchant.area.legend_zones', { count: r.zones })}
          </Text>
        </View>
      ))}
      {paused > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 32 }}>
          {swatch(PAUSED_FILL, true)}
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {t('merchant.area.legend_paused', { count: paused })}
          </Text>
        </View>
      ) : null}
    </Panel>
  );
}

function ZoneList({ zones, selectedKey, onSelect }: { zones: readonly DeliveryAreaZone[]; selectedKey: string | null; onSelect: (key: string) => void }) {
  const t = useT();
  const locale = useLocale();
  const theme = useTheme();
  return (
    <Panel title={t('merchant.area.list_title')} flush testID="delivery-area-list">
      {zoneRows(zones).map((z, i) => {
        const selected = z.key === selectedKey;
        return (
          <PanelRow key={z.key} first={i === 0} onPress={() => onSelect(z.key)} testID={`delivery-area-row-${z.key}`} accessibilityLabel={zoneName(z, locale)}>
            <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: selected ? theme.colors.accent : 'transparent' }} />
            <Text variant={selected ? 'bodyStrong' : 'body'} numberOfLines={1} style={{ flex: 1 }}>
              {zoneName(z, locale)}
            </Text>
            {z.kitchen ? <Tag label={t('merchant.area.your_zone')} tone="accent" /> : null}
            {z.service === 'paused' ? <Tag label={t('merchant.area.paused')} tone="warning" /> : null}
            <Text variant="bodyStrong" tabular color={z.feeIqd === null ? 'textMuted' : 'text'}>
              {z.feeIqd === null ? t('merchant.area.no_price') : iqd(z.feeIqd, { locale })}
            </Text>
          </PanelRow>
        );
      })}
    </Panel>
  );
}
