import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Icon, Text, TextField, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useMe, useUpdateProfile } from '@/features/account/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { isValidIraqiPhone } from '@/lib/phone';

/** Safety (customer spec §10): the emergency contact, kept in the identity vault. */
export default function Safety() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const me = useMe();
  const update = useUpdateProfile();
  const current = me.data?.emergencyContact ?? null;
  const [name, setName] = useState(current?.name ?? '');
  const [phone, setPhone] = useState('');
  const valid = name.trim().length > 0 && isValidIraqiPhone(phone);

  const run = async (emergencyContact: { name: string; phone: string } | null) => {
    try {
      await update.mutateAsync({ emergencyContact });
      toast.show({ message: t(emergencyContact ? 'profile.emergency_saved' : 'profile.emergency_removed'), tone: 'success' });
      router.back();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  return (
    <Screen
      edges={['bottom']}
      testID="safety"
      footer={<Button testID="emergency-save" label={t('action.save')} size="lg" fullWidth disabled={!valid} loading={update.isPending} onPress={() => void run({ name: name.trim(), phone })} />}
    >
      <Card padding={4} tone="sunken">
        <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
          <Icon name="shield" size={22} color="accentText" />
          <Text variant="footnote" style={{ flex: 1 }}>
            {t('profile.emergency_body')}
          </Text>
        </View>
      </Card>
      {current ? (
        <Card elevation={0} padding={4}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] }}>
            <View style={{ gap: 2, flexShrink: 1 }}>
              <Text variant="label">{current.name}</Text>
              <Text variant="footnote" color="textMuted" tabular>{`⁦${current.phoneMasked}⁩`}</Text>
            </View>
            <Button size="sm" variant="ghost" label={t('action.delete')} onPress={() => void run(null)} />
          </View>
        </Card>
      ) : null}
      <TextField testID="emergency-name" label={t('profile.emergency_name')} value={name} onChangeText={setName} placeholder={t('profile.emergency_name_placeholder')} leadingIcon="user" maxLength={60} />
      <TextField
        testID="emergency-phone"
        label={t('profile.emergency_phone')}
        value={phone}
        onChangeText={setPhone}
        placeholder="07XX XXX XXXX"
        keyboardType="phone-pad"
        leadingIcon="phone"
        hint={current ? t('profile.emergency_replace_hint') : undefined}
        maxLength={16}
      />
    </Screen>
  );
}
