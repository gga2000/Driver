import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, Text, TextField, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useMe, useUpdateProfile } from '@/features/account/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { profile } from '@/lib/profile';

/** "شنو نسميك؟" — the name goes to the identity vault only (domain §13). */
export default function EditName() {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const me = useMe();
  const update = useUpdateProfile();
  const [name, setName] = useState('');

  const current = me.data?.name ?? null;
  useEffect(() => {
    if (current) setName((n) => n || current);
  }, [current]);

  const save = async () => {
    try {
      const next = await update.mutateAsync({ name: name.trim() });
      await profile.setName(next.name ?? name.trim());
      router.back();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  return (
    <Screen edges={['bottom']} footer={<Button testID="name-save" label={t('action.save')} size="lg" fullWidth disabled={!name.trim()} loading={update.isPending} onPress={() => void save()} />}>
      <TextField testID="name-input" value={name} onChangeText={setName} placeholder={t('onboarding.name_placeholder')} autoFocus leadingIcon="user" maxLength={60} autoComplete="name" />
      <Text variant="footnote" color="textMuted">
        {t('profile.name_privacy')}
      </Text>
    </Screen>
  );
}
