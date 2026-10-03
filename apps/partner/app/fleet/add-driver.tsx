import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Text, TextField, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useAddDriver } from '@/features/fleet/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { formatPhoneInput, normalizeIraqiPhone } from '@/lib/phone';

/** سايق جديد — invite a driver by phone; he accepts in his Partner app, ops review gives him the driving role. */
export default function AddDriver() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const add = useAddDriver();
  const [phone, setPhone] = useState('');
  const [touched, setTouched] = useState(false);
  const e164 = normalizeIraqiPhone(phone);

  const save = async () => {
    setTouched(true);
    if (!e164) return;
    try {
      await add.mutateAsync({ phone: e164 });
      toast.show({ tone: 'success', message: t('partner.fleet_driver_added') });
      // He shows under "بانتظار موافقة السايق" until he accepts in his app.
      router.replace('/fleet');
    } catch (err) {
      toast.show({ tone: 'danger', message: apiErrorMessage(err, t('error.network'), locale) });
    }
  };

  const steps = [t('partner.fleet_add_driver_step1'), t('partner.fleet_add_driver_step2'), t('partner.fleet_add_driver_step3')];

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
      <Card elevation={0} tone="sunken">
        <View style={{ gap: theme.space[3] }}>
          {steps.map((s, i) => (
            <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="caption" weight={700} tabular>
                  {i + 1}
                </Text>
              </View>
              <Text variant="label" style={{ flex: 1 }}>
                {s}
              </Text>
            </View>
          ))}
        </View>
      </Card>
    </Screen>
  );
}
