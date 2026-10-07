import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { FleetVehicle, VehicleFeature } from '@driver/contracts';
import { Button, Card, EmptyState, RetryState, retryKindFor, Skeleton, Text, useLoadTimeout, useNetwork, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { PlateBadge, SectionHeader, VehicleGlyph } from '@/features/fleet/FleetParts';
import { CLASS_KEY } from '@/features/fleet/logic';
import { colourKey, featuresChanged, featureState, hasFeatures, offeredFeatures, toggleFeature } from '@/features/vehicle/logic';
import { useMyVehicle, useSetVehicleFeatures } from '@/features/vehicle/queries';
import { ColourDot, FeatureToggle } from '@/features/vehicle/VehicleParts';
import { VEHICLE_ICON } from '@/features/work/logic';
import { useStatus } from '@/features/work/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/**
 * «مميزات سيارتك» (ride ideas n1, n2): he ticks what the car he drives offers — AC and heating first
 * (on very hot or cold days those cars get rides first), then the quiet ones. A new tick waits for
 * the ops car check («بانتظار التأكيد»); riders only ever see what ops confirmed.
 */
export default function VehicleFeatures() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const toast = useToast();
  const canDrive = useStatus().data?.canDrive ?? false;
  const q = useMyVehicle(canDrive);
  const save = useSetVehicleFeatures();
  const v = q.data;
  const [picked, setPicked] = useState<VehicleFeature[] | null>(null);
  // The saved ticks are the starting point; a refetch never overwrites what he is changing.
  useEffect(() => {
    if (v && picked === null) setPicked(v.features);
  }, [v, picked]);
  const [slow, restartSlow] = useLoadTimeout(q.data === undefined && !q.isError);

  const submit = async (vehicle: FleetVehicle, features: VehicleFeature[]) => {
    try {
      const saved = await save.mutateAsync({ features });
      setPicked(saved.features);
      toast.show({ tone: 'success', message: t('partner.features_saved') });
    } catch (err) {
      toast.show({ tone: 'danger', message: apiErrorMessage(err, t('error.network'), locale) });
      setPicked(vehicle.features);
    }
  };

  const ticks = picked ?? v?.features ?? [];
  const dirty = v ? featuresChanged(v.features, ticks) : false;

  return (
    <Screen
      testID="vehicle-features"
      edges={['bottom']}
      footer={
        v && hasFeatures(v.vehicleClass) ? (
          <Button testID="features-save" label={t('partner.features_save')} fullWidth size="lg" disabled={!dirty} loading={save.isPending} onPress={() => void submit(v, ticks)} />
        ) : undefined
      }
    >
      <Stack.Screen options={{ title: t('partner.features_title') }} />
      {q.data === undefined ? (
        q.isError || slow ? (
          <RetryState
            testID="features-retry"
            kind={retryKindFor({ net, error: q.error, slow })}
            locale={locale}
            title={net.state === 'offline' ? t('partner.features_offline') : t('partner.features_failed')}
            onRetry={() => {
              restartSlow();
              void q.refetch();
            }}
          />
        ) : (
          <View testID="features-loading" style={{ gap: theme.space[3] }}>
            <Skeleton height={88} />
            <Skeleton lines={4} />
          </View>
        )
      ) : v === null || v === undefined ? (
        <View testID="features-no-vehicle">
          <EmptyState icon="car" title={t('partner.features_no_vehicle_title')} body={t('partner.features_no_vehicle_body')} style={{ paddingTop: theme.space[10] }} />
        </View>
      ) : !hasFeatures(v.vehicleClass) ? (
        <View testID="features-none-for-class">
          <EmptyState icon={VEHICLE_ICON[v.vehicleClass]} title={t('partner.features_none_for_class')} body={t('partner.features_none_for_class_body')} style={{ paddingTop: theme.space[10] }} />
        </View>
      ) : (
        <FeatureList vehicle={v} ticks={ticks} onToggle={(f) => setPicked(toggleFeature(ticks, f))} />
      )}
    </Screen>
  );
}

function FeatureList({ vehicle, ticks, onToggle }: { vehicle: FleetVehicle; ticks: readonly VehicleFeature[]; onToggle: (f: VehicleFeature) => void }) {
  const theme = useTheme();
  const t = useT();
  const { loud, quiet } = offeredFeatures(vehicle.vehicleClass);
  const row = (f: VehicleFeature) => <FeatureToggle key={f} feature={f} on={ticks.includes(f)} saved={featureState(vehicle, f)} onPress={() => onToggle(f)} />;
  return (
    <>
      <Card elevation={1} padding={4} testID="features-car">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <VehicleGlyph vehicleClass={vehicle.vehicleClass} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {vehicle.model ?? t(CLASS_KEY[vehicle.vehicleClass])}
            </Text>
            {vehicle.colour ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }}>
                <ColourDot colour={vehicle.colour} />
                <Text variant="caption" color="textMuted">
                  {t(colourKey(vehicle.colour))}
                </Text>
              </View>
            ) : null}
          </View>
          <PlateBadge plate={vehicle.plate} />
        </View>
      </Card>
      <Text variant="body" color="textMuted">
        {t('partner.features_body')}
      </Text>
      {loud.length > 0 ? (
        <View style={{ gap: theme.space[2] }}>
          <SectionHeader title={t('partner.features_loud_title')} />
          <Text variant="footnote" color="textMuted" style={{ paddingHorizontal: theme.space[1] }}>
            {t('partner.features_loud_body')}
          </Text>
          {loud.map(row)}
        </View>
      ) : null}
      <View style={{ gap: theme.space[2] }}>
        {loud.length > 0 ? <SectionHeader title={t('partner.features_quiet_title')} /> : null}
        {quiet.map(row)}
      </View>
    </>
  );
}
