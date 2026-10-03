import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Card, Icon, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { DriverAvatar, VehicleGlyph } from '@/features/fleet/FleetParts';
import { CLASS_KEY, maskedPhone, STATE_KEY } from '@/features/fleet/logic';
import { useAssignDriver, useFleetOverview } from '@/features/fleet/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

const NONE = '__none__';

/** "منو يسوق واسط 12345؟" — pick one of the fleet's drivers for a vehicle (or none). */
export default function AssignDriver() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string }>();
  const o = useFleetOverview().data;
  const assign = useAssignDriver();
  const vehicle = o?.vehicles.find((v) => v.vehicleId === vehicleId);
  const [picked, setPicked] = useState<string | null>(null);
  const current = vehicle?.activeDriverId ?? NONE;
  const choice = picked ?? current;
  const plateOf = new Map((o?.vehicles ?? []).map((v) => [v.activeDriverId, v]));

  const save = async () => {
    if (!vehicle) return;
    const driverId = choice === NONE ? null : choice;
    try {
      await assign.mutateAsync({ vehicleId: vehicle.vehicleId, driverId });
      const name = o?.drivers.find((d) => d.driverId === driverId)?.name ?? '';
      toast.show({ tone: 'success', message: driverId ? t('partner.fleet_assigned_toast', { name, plate: vehicle.plate }) : t('partner.fleet_unassigned_toast', { plate: vehicle.plate }) });
      router.back();
    } catch (err) {
      toast.show({ tone: 'danger', message: apiErrorMessage(err, t('error.network'), locale) });
    }
  };

  return (
    <Screen
      edges={['bottom']}
      testID="fleet-assign"
      footer={<Button testID="fleet-assign-save" label={t('action.save')} fullWidth size="lg" disabled={!vehicle || choice === current} loading={assign.isPending} onPress={() => void save()} />}
    >
      <Stack.Screen options={{ title: t('partner.fleet_assign') }} />
      {!o || !vehicle ? (
        <Skeleton lines={4} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <VehicleGlyph vehicleClass={vehicle.vehicleClass} size={52} />
            <View style={{ gap: 4 }}>
              <Text variant="title" tabular>
                {t('partner.fleet_assign_title', { plate: `\u2068${vehicle.plate}\u2069` })}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <Text variant="label" color="textMuted">
                  {t(CLASS_KEY[vehicle.vehicleClass])}
                </Text>
              </View>
            </View>
          </View>
          <Card elevation={1} padding={0}>
            {o.drivers.map((d) => {
              const elsewhere = plateOf.get(d.driverId);
              const moving = elsewhere && elsewhere.vehicleId !== vehicle.vehicleId;
              return (
                <Option
                  key={d.driverId}
                  testID={`fleet-pick-${d.driverId}`}
                  selected={choice === d.driverId}
                  onPress={() => setPicked(d.driverId)}
                  divider
                  leading={<DriverAvatar name={d.name} state={d.state} size={40} />}
                  title={d.name ?? maskedPhone(d.phoneMasked)}
                  subtitle={moving && choice === d.driverId ? t('partner.fleet_assign_moves', { plate: elsewhere.plate }) : t(STATE_KEY[d.state])}
                  warn={!!moving && choice === d.driverId}
                />
              );
            })}
            <Option
              testID="fleet-pick-none"
              selected={choice === NONE}
              onPress={() => setPicked(NONE)}
              divider={false}
              leading={
                <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="x" size={18} color="textMuted" />
                </View>
              }
              title={t('partner.fleet_assign_none')}
            />
          </Card>
        </>
      )}
    </Screen>
  );
}

function Option({
  title,
  subtitle,
  leading,
  selected,
  onPress,
  divider,
  warn,
  testID,
}: {
  title: string;
  subtitle?: string;
  leading: ReactNode;
  selected: boolean;
  onPress: () => void;
  divider: boolean;
  warn?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingHorizontal: theme.space[4],
        paddingVertical: theme.space[3],
        backgroundColor: selected ? theme.colors.accentTint : 'transparent',
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: theme.colors.border,
      }}
    >
      {leading}
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" color={warn ? 'warningText' : 'textMuted'} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          borderWidth: selected ? 7 : 2,
          borderColor: selected ? theme.colors.accent : theme.colors.borderStrong,
          backgroundColor: theme.colors.surface,
        }}
      />
    </Pressable>
  );
}
