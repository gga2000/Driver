import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Icon, Skeleton, Text, TextField, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { PickOption, SectionHeader, VehicleGlyph } from '@/features/fleet/FleetParts';
import { CLASS_KEY } from '@/features/fleet/logic';
import { useAddDriver, useFleetOverview } from '@/features/fleet/queries';
import { colourKey } from '@/features/vehicle/logic';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { formatPhoneInput, normalizeIraqiPhone } from '@/lib/phone';

const LATER = '__later__';

/**
 * سايق جديد (partner redesign f5) — one screen: his number, and the car he will drive. The invite goes
 * to his Partner app; the car waits on it and becomes his the moment he says yes (if nobody drives
 * it by then). Only free cars are offered; a car already picked for another invite says so.
 */
export default function AddDriver() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const add = useAddDriver();
  const o = useFleetOverview().data;
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const e164 = normalizeIraqiPhone(phone);

  const free = (o?.vehicles ?? []).filter((v) => v.active && v.activeDriverId === null);
  const plannedFor = new Set((o?.drivers ?? []).map((d) => d.plannedVehicleId).filter(Boolean));
  // The only free car is the likely answer; with several, the owner picks.
  const open = free.filter((v) => !plannedFor.has(v.vehicleId));
  const choice = picked ?? (open.length === 1 ? open[0]!.vehicleId : LATER);
  const car = free.find((v) => v.vehicleId === choice);

  const save = async () => {
    setTouched(true);
    if (!e164) return;
    try {
      await add.mutateAsync({ phone: e164, ...(car ? { vehicleId: car.vehicleId } : {}) });
      toast.show({ tone: 'success', message: car ? t('partner.f5_sent_car', { plate: `⁨${car.plate}⁩` }) : t('partner.fleet_driver_added') });
      // He shows under "بانتظار موافقة السايق" (with the car) until he accepts in his app.
      router.replace('/fleet');
    } catch (err) {
      toast.show({ tone: 'danger', message: apiErrorMessage(err, t('error.network'), locale) });
    }
  };

  const steps = [t('partner.fleet_add_driver_step1'), t('partner.fleet_add_driver_step2'), car ? t('partner.f5_step3_car', { plate: `⁨${car.plate}⁩` }) : t('partner.fleet_add_driver_step3')];

  return (
    <Screen
      edges={['bottom']}
      testID="fleet-add-driver-form"
      footer={<Button testID="fleet-add-driver-save" label={t('partner.fleet_add_driver_cta')} fullWidth size="lg" disabled={!e164} loading={add.isPending} onPress={() => void save()} />}
    >
      <Stack.Screen options={{ title: t('partner.fleet_add_driver_title') }} />
      <Text variant="body" color="textMuted">
        {t('partner.fleet_add_driver_body')}
      </Text>
      <TextField
        testID="fleet-driver-phone"
        label={t('partner.fleet_phone_label')}
        leadingIcon="phone"
        placeholder={t('onboarding.phone_placeholder')}
        keyboardType="phone-pad"
        value={phone}
        onChangeText={(v) => setPhone(formatPhoneInput(v))}
        onBlur={() => setTouched(true)}
        error={touched && phone.length > 0 && !e164 ? t('error.phone_invalid') : undefined}
      />

      <View style={{ gap: theme.space[2] }} testID="fleet-add-driver-car">
        <View style={{ gap: 2 }}>
          <SectionHeader title={t('partner.f5_car_title')} />
          <Text variant="footnote" color="textMuted" style={{ paddingHorizontal: theme.space[1] }}>
            {t('partner.f5_car_sub')}
          </Text>
        </View>
        {!o ? (
          <Skeleton lines={2} />
        ) : free.length === 0 ? (
          <Card elevation={0} tone="sunken" testID="fleet-add-driver-no-car">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <Icon name="car" size={20} color="textMuted" />
              <Text variant="label" color="textMuted" style={{ flex: 1 }}>
                {t('partner.f5_car_none_free')}
              </Text>
            </View>
          </Card>
        ) : (
          <Card elevation={1} padding={0}>
            {free.map((v) => {
              const detail = [v.model ?? t(CLASS_KEY[v.vehicleClass]), v.colour ? t(colourKey(v.colour)) : null].filter(Boolean).join(' · ');
              const taken = plannedFor.has(v.vehicleId);
              return (
                <PickOption
                  key={v.vehicleId}
                  testID={`fleet-add-car-${v.vehicleId}`}
                  selected={choice === v.vehicleId}
                  onPress={() => setPicked(v.vehicleId)}
                  divider
                  leading={<VehicleGlyph vehicleClass={v.vehicleClass} size={40} />}
                  title={v.plate}
                  subtitle={taken ? t('partner.f5_car_taken_by_invite') : detail}
                  warn={taken}
                />
              );
            })}
            <PickOption
              testID="fleet-add-car-later"
              selected={choice === LATER}
              onPress={() => setPicked(LATER)}
              divider={false}
              leading={
                <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="clock" size={18} color="textMuted" />
                </View>
              }
              title={t('partner.f5_car_later')}
            />
          </Card>
        )}
      </View>

      <Card elevation={0} tone="sunken">
        <View style={{ gap: theme.space[3] }}>
          {steps.map((s, i) => (
            <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="caption" weight={700} tabular>
                  {i + 1}
                </Text>
              </View>
              <Text variant="label" style={{ flex: 1 }} tabular>
                {s}
              </Text>
            </View>
          ))}
        </View>
      </Card>
    </Screen>
  );
}
