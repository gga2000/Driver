import { router, Stack } from 'expo-router';
import { RefreshControl, View } from 'react-native';
import { Button, Card, EmptyState, Icon, RetryState, retryKindFor, Skeleton, Text, useLoadTimeout, useNetwork, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import {
  DriverRow,
  EarningsHero,
  PendingDriverRow,
  SectionHeader,
  StatTile,
} from '@/features/fleet/FleetParts';
import { DOC_KEY, docAlertKey, localDateKey, splitFleetDrivers } from '@/features/fleet/logic';
import { useFleetOverview } from '@/features/fleet/queries';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * الأسطول — the fleet owner's dashboard: today's and this week's earnings with the week chart, how
 * many of his drivers are online now, documents about to lapse, and every driver with his vehicle,
 * today's money, cash against his cap and his tier. A driver opens his earnings.
 */
export default function FleetOverview() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const q = useFleetOverview();
  const o = q.data;
  const net = useNetwork();
  const [slow, restartSlow] = useLoadTimeout(o === undefined && !q.isError);

  const header = <Stack.Screen options={{ title: t('partner.hub_fleet') }} />;

  if ((q.isError || slow) && !o) {
    const noFleet = q.isError && apiErrorCode(q.error) === 'fleet_not_found';
    const kind = retryKindFor({ net, error: q.error, slow });
    return (
      <Screen edges={['bottom']} testID="fleet-error">
        {header}
        {noFleet ? (
          <EmptyState icon="car" title={t('partner.fleet_no_fleet_title')} body={t('partner.fleet_no_fleet_body')} style={{ paddingTop: theme.space[10] }} />
        ) : (
          <RetryState
            testID="fleet-retry"
            kind={kind}
            locale={locale}
            title={kind === 'server' ? apiErrorMessage(q.error, t('partner.f5_fleet_failed'), locale) : undefined}
            onRetry={() => {
              restartSlow();
              void q.refetch();
            }}
            style={{ paddingTop: theme.space[10] }}
          />
        )}
      </Screen>
    );
  }

  if (!o) {
    return (
      <Screen edges={['bottom']} testID="fleet-loading">
        {header}
        <Skeleton height={232} radius={28} />
        <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
          <Skeleton height={96} radius={20} style={{ flex: 1 }} />
          <Skeleton height={96} radius={20} style={{ flex: 1 }} />
          <Skeleton height={96} radius={20} style={{ flex: 1 }} />
        </View>
        <Skeleton lines={4} />
      </Screen>
    );
  }

  const byId = new Map(o.vehicles.map((v) => [v.vehicleId, v]));
  const nameOf = new Map(o.drivers.map((d) => [d.driverId, d.name ?? '']));
  // Invites still waiting for the driver's yes are listed apart: no name, money or state yet.
  const { active: drivers, pending } = splitFleetDrivers(o.drivers);
  const empty = o.vehicles.length === 0 && o.drivers.length === 0;

  return (
    <Screen edges={['bottom']} testID="fleet-overview" refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}>
      {header}
      <EarningsHero todayIqd={o.totals.todayEarningsIqd} weekIqd={o.totals.weekEarningsIqd} days={o.days} today={localDateKey(new Date())} />

      <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
        <StatTile
          testID="fleet-stat-online"
          icon="user"
          value={t('partner.fleet_online_of', { online: o.totals.online, total: drivers.length })}
          label={t('partner.fleet_stat_online')}
          tone={o.totals.online > 0 ? 'successText' : 'text'}
        />
        <StatTile
          icon="car"
          value={String(o.totals.vehicles)}
          label={t('partner.fleet_stat_vehicles')}
        />
        <StatTile
          icon="wallet"
          value={amountParam(o.totals.owedIqd)}
          label={t('partner.fleet_stat_owed')}
          tone={o.totals.owedIqd > 0 ? 'warningText' : 'text'}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
        <Button testID="fleet-open-vehicles" label={t('partner.fleet_vehicles_manage')} icon="car" variant="secondary" size="md" style={{ flex: 1 }} onPress={() => router.push('/fleet/vehicles')} />
        <Button testID="fleet-open-add-driver" label={t('partner.fleet_add_driver')} icon="plus" variant="secondary" size="md" style={{ flex: 1 }} onPress={() => router.push('/fleet/add-driver')} />
      </View>

      {o.expiringDocuments.length > 0 ? (
        <View style={{ gap: theme.space[2] }} testID="fleet-docs">
          <SectionHeader title={t('partner.fleet_docs_title')} />
          <Card elevation={0} padding={0} tone="tint" style={{ backgroundColor: theme.colors.warningTint, borderColor: theme.colors.warningTint }}>
            {o.expiringDocuments.map((d, i) => {
              const expired = docAlertKey(d.status, d.daysToExpiry) === 'partner.fleet_doc_expired';
              return (
                <View
                  key={`${d.driverId}-${d.kind}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.colors.surface }}
                >
                  <Icon name={expired ? 'x' : 'clock'} size={18} color={expired ? 'dangerText' : 'warningText'} strokeWidth={2.4} />
                  <View style={{ flex: 1 }}>
                    <Text variant="label" weight={600}>
                      {nameOf.get(d.driverId) || '—'}
                    </Text>
                    <Text variant="footnote" color={expired ? 'dangerText' : 'warningText'} tabular>
                      {t(docAlertKey(d.status, d.daysToExpiry), { doc: t(DOC_KEY[d.kind]), days: d.daysToExpiry ?? 0 })}
                    </Text>
                  </View>
                </View>
              );
            })}
          </Card>
        </View>
      ) : null}

      {empty ? (
        <EmptyState icon="car" title={t('partner.fleet_empty_title')} body={t('partner.fleet_empty_body')} action={{ label: t('partner.fleet_add_vehicle'), onPress: () => router.push('/fleet/add-vehicle') }} />
      ) : (
        <View style={{ gap: theme.space[2] }}>
          <SectionHeader
            title={`${t('partner.fleet_drivers_title')} · ${drivers.length}`}
            action={
              o.totals.onJob > 0 ? (
                <Text variant="caption" color="infoText" tabular>
                  {`${o.totals.onJob} ${t('partner.fleet_stat_onjob')}`}
                </Text>
              ) : undefined
            }
          />
          {drivers.length === 0 ? (
            <Card elevation={0}>
              <Text variant="body" color="textMuted" align="center">
                {t('partner.fleet_no_drivers')}
              </Text>
            </Card>
          ) : (
            <Card elevation={1} padding={0} testID="fleet-drivers">
              {drivers.map((d, i) => {
                const v = d.vehicleId ? byId.get(d.vehicleId) : undefined;
                return (
                  <DriverRow
                    key={d.driverId}
                    driver={d}
                    vehicle={v ? { plate: v.plate, vehicleClass: v.vehicleClass } : null}
                    divider={i < drivers.length - 1}
                    onPress={() => router.push({ pathname: '/fleet/driver/[id]', params: { id: d.driverId } })}
                  />
                );
              })}
            </Card>
          )}
          {pending.length > 0 ? (
            <View
              style={{ gap: theme.space[2], paddingTop: theme.space[2] }}
              testID="fleet-pending"
            >
              <SectionHeader title={`${t('partner.fleet_pending_title')} · ${pending.length}`} />
              <Card elevation={0} padding={0} tone="sunken">
                {pending.map((d, i) => (
                  <PendingDriverRow key={d.driverId} driver={d} divider={i < pending.length - 1} plannedPlate={d.plannedVehicleId ? byId.get(d.plannedVehicleId)?.plate : undefined} />
                ))}
              </Card>
              <Text
                variant="footnote"
                color="textMuted"
                style={{ paddingHorizontal: theme.space[1] }}
              >
                {t('partner.fleet_pending_hint')}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
