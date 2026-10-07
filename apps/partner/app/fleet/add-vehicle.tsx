import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { VehicleClass, VehicleColour } from '@driver/contracts';
import { Button, Stepper, Text, TextField, useTheme, useToast } from '@driver/ui';
import { ChoiceCard } from '@/components/ChoiceCard';
import { Screen } from '@/components/Screen';
import { CLASS_KEY, DEFAULT_SEATS, FLEET_CLASSES, isPlateValid, MAX_SEATS, normalizePlate } from '@/features/fleet/logic';
import { useAddVehicle } from '@/features/fleet/queries';
import { colourRequired, isModelValid, MODEL_MAX, modelRequired, normalizeModel } from '@/features/vehicle/logic';
import { ColourSwatches } from '@/features/vehicle/VehicleParts';
import { VEHICLE_ICON } from '@/features/work/logic';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/**
 * سيارة جديدة — class (bike / tuktuk / saloon / SUV / van), plate, model and colour (riders look for
 * the car by them: ride step 3, d1) and passenger seats.
 */
export default function AddVehicle() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const add = useAddVehicle();
  const [vehicleClass, setClass] = useState<VehicleClass>('car');
  const [plate, setPlate] = useState('');
  const [seats, setSeats] = useState(DEFAULT_SEATS.car);
  const [model, setModel] = useState('');
  const [colour, setColour] = useState<VehicleColour | null>(null);
  const [touched, setTouched] = useState(false);
  const plateOk = isPlateValid(plate);
  const modelOk = isModelValid(model, vehicleClass);
  const colourOk = colour !== null || !colourRequired(vehicleClass);

  const pick = (c: VehicleClass) => {
    setClass(c);
    setSeats(DEFAULT_SEATS[c]);
  };

  const save = async () => {
    setTouched(true);
    if (!plateOk || !modelOk || !colourOk) return;
    const named = normalizeModel(model);
    try {
      const v = await add.mutateAsync({ plate: normalizePlate(plate), vehicleClass, seats, ...(named ? { model: named } : {}), ...(colour ? { colour } : {}) });
      toast.show({ tone: 'success', message: t('partner.fleet_vehicle_added', { plate: v.plate }) });
      router.back();
    } catch (err) {
      toast.show({ tone: 'danger', message: apiErrorMessage(err, t('error.network'), locale) });
    }
  };

  return (
    <Screen
      edges={['bottom']}
      testID="fleet-add-vehicle-form"
      footer={<Button testID="fleet-save-vehicle" label={t('partner.fleet_save_vehicle')} fullWidth size="lg" loading={add.isPending} onPress={() => void save()} />}
    >
      <Stack.Screen options={{ title: t('partner.fleet_add_vehicle_title') }} />

      <View style={{ gap: theme.space[2] }}>
        <Text variant="label">{t('partner.fleet_class_label')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {FLEET_CLASSES.map((c) => (
            <ChoiceCard key={c} testID={`fleet-class-${c}`} layout="tile" icon={VEHICLE_ICON[c]} title={t(CLASS_KEY[c])} selected={vehicleClass === c} onPress={() => pick(c)} style={{ flexBasis: '31%', flexGrow: 1 }} />
          ))}
        </View>
      </View>

      <TextField
        testID="fleet-plate-input"
        label={t('partner.fleet_plate_label')}
        hint={t('partner.fleet_plate_hint')}
        placeholder="واسط 12345"
        value={plate}
        onChangeText={setPlate}
        onBlur={() => setTouched(true)}
        error={touched && !plateOk ? t('partner.fleet_plate_short') : undefined}
        autoCorrect={false}
        returnKeyType="done"
      />

      {vehicleClass !== 'bike' ? (
        <TextField
          testID="fleet-model-input"
          label={t('partner.vehicle_model_label')}
          hint={t(modelRequired(vehicleClass) ? 'partner.vehicle_model_hint' : 'partner.vehicle_model_hint_optional')}
          placeholder={t('partner.vehicle_model_placeholder')}
          value={model}
          onChangeText={setModel}
          maxLength={MODEL_MAX}
          error={touched && !modelOk ? t('partner.vehicle_model_short') : undefined}
          autoCorrect={false}
          returnKeyType="done"
        />
      ) : null}

      {colourRequired(vehicleClass) ? (
        <View style={{ gap: theme.space[2] }}>
          <View style={{ gap: 2 }}>
            <Text variant="label">{t('partner.vehicle_colour_label')}</Text>
            <Text variant="footnote" color={touched && !colourOk ? 'dangerText' : 'textMuted'}>
              {touched && !colourOk ? t('partner.vehicle_colour_missing') : t('partner.vehicle_colour_hint')}
            </Text>
          </View>
          <ColourSwatches testID="fleet-colour" value={colour} onChange={setColour} />
        </View>
      ) : null}

      {MAX_SEATS[vehicleClass] > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] }}>
          <View style={{ flex: 1 }}>
            <Text variant="label">{t('partner.fleet_seats_label')}</Text>
            <Text variant="footnote" color="textMuted">
              {t('partner.fleet_seats_hint')}
            </Text>
          </View>
          <Stepper value={seats} onChange={setSeats} min={1} max={MAX_SEATS[vehicleClass]} accessibilityLabel={t('partner.fleet_seats_label')} />
        </View>
      ) : null}
    </Screen>
  );
}
