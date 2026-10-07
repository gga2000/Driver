import { router, Stack } from 'expo-router';
import { View } from 'react-native';
import { Button, Card, EmptyState, Icon, Skeleton, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { DriverAvatar, PlateBadge, SectionHeader, VehicleGlyph } from '@/features/fleet/FleetParts';
import { CLASS_KEY, seatsKey } from '@/features/fleet/logic';
import { useFleetOverview } from '@/features/fleet/queries';
import { colourKey } from '@/features/vehicle/logic';
import { ColourDot } from '@/features/vehicle/VehicleParts';
import { useT } from '@/lib/i18n';

/**
 * السيارات — the fleet's vehicles: class, plate, seats and who drives each one. "عيّن سايق" opens
 * the driver picker for that vehicle; a new vehicle is one tap away.
 */
export default function FleetVehicles() {
  const theme = useTheme();
  const t = useT();
  const o = useFleetOverview().data;
  const drivers = new Map((o?.drivers ?? []).map((d) => [d.driverId, d]));
  const free = (o?.vehicles ?? []).filter((v) => !v.activeDriverId).length;

  return (
    <Screen
      edges={['bottom']}
      testID="fleet-vehicles"
      footer={<Button testID="fleet-add-vehicle" label={t('partner.fleet_add_vehicle')} icon="plus" fullWidth size="lg" onPress={() => router.push('/fleet/add-vehicle')} />}
    >
      <Stack.Screen options={{ title: t('partner.fleet_vehicles_manage') }} />
      {!o ? (
        <Skeleton lines={5} />
      ) : o.vehicles.length === 0 ? (
        <EmptyState icon="car" title={t('partner.fleet_vehicles_empty')} body={t('partner.fleet_empty_body')} style={{ paddingTop: theme.space[10] }} />
      ) : (
        <View style={{ gap: theme.space[2] }}>
          <SectionHeader
            title={`${t('partner.fleet_stat_vehicles')} · ${o.vehicles.length}`}
            action={
              free > 0 ? (
                <Text variant="caption" color="warningText" tabular>
                  {t('partner.fleet_free_count', { n: free })}
                </Text>
              ) : undefined
            }
          />
          <View style={{ gap: theme.space[3] }}>
            {o.vehicles.map((v) => {
              const driver = v.activeDriverId ? drivers.get(v.activeDriverId) : undefined;
              const seats = seatsKey(v.seats);
              return (
                <Card key={v.vehicleId} elevation={1} padding={4} testID={`fleet-vehicle-${v.vehicleId}`}>
                  <View style={{ gap: theme.space[3] }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                      <VehicleGlyph vehicleClass={v.vehicleClass} active={!!driver} />
                      <View style={{ flex: 1, gap: 4 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                          <Text variant="bodyStrong">{t(CLASS_KEY[v.vehicleClass])}</Text>
                          {seats ? (
                            <Text variant="caption" color="textMuted" tabular>
                              {`· ${t(seats, { n: v.seats })}`}
                            </Text>
                          ) : null}
                        </View>
                        {v.model || v.colour ? (
                          <View testID={`fleet-vehicle-look-${v.vehicleId}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }}>
                            {v.colour ? <ColourDot colour={v.colour} size={12} /> : null}
                            <Text variant="caption" color="textMuted" numberOfLines={1}>
                              {[v.model, v.colour ? t(colourKey(v.colour)) : null].filter(Boolean).join(' · ')}
                            </Text>
                          </View>
                        ) : null}
                        <PlateBadge plate={v.plate} size="md" />
                      </View>
                    </View>
                    <View style={{ height: 1, backgroundColor: theme.colors.border }} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                      {driver ? (
                        <>
                          <DriverAvatar name={driver.name} state={driver.state} size={32} />
                          <Text variant="label" style={{ flex: 1 }} numberOfLines={1}>
                            {t('partner.fleet_driven_by', { name: driver.name ?? '—' })}
                          </Text>
                        </>
                      ) : (
                        <>
                          <View style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="user" size={16} color="textMuted" />
                          </View>
                          <Text variant="label" color="textMuted" style={{ flex: 1 }}>
                            {t('partner.fleet_unassigned')}
                          </Text>
                        </>
                      )}
                      <Button
                        testID={`fleet-assign-${v.vehicleId}`}
                        label={driver ? t('partner.fleet_change_driver') : t('partner.fleet_assign')}
                        variant={driver ? 'ghost' : 'secondary'}
                        size="sm"
                        onPress={() => router.push({ pathname: '/fleet/assign', params: { vehicleId: v.vehicleId } })}
                      />
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>
        </View>
      )}
    </Screen>
  );
}
