import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, ChipGroup, Text, TextField, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useHousehold, useInviteMember } from '@/features/account/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { isValidIraqiPhone, toWesternDigits } from '@/lib/phone';

/** Payer: add a family member by phone, as an orderer (with an optional limit) or a member. */
export default function InviteMember() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const household = useHousehold();
  const invite = useInviteMember();
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'orderer' | 'member'>('orderer');
  const [limit, setLimit] = useState('');
  const limitIqd = limit.trim() ? Number(toWesternDigits(limit).replace(/[^\d]/g, '')) : null;
  const valid = isValidIraqiPhone(phone) && (limitIqd === null || Number.isFinite(limitIqd));

  const submit = async () => {
    if (!household.data) return;
    try {
      await invite.mutateAsync({ householdId: household.data.id, phone, role, spendingLimitIqd: role === 'orderer' ? limitIqd : null });
      toast.show({ message: t('household.invited'), tone: 'success' });
      router.back();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  return (
    <Screen edges={['bottom']} footer={<Button testID="invite-submit" label={t('household.invite')} size="lg" fullWidth disabled={!valid} loading={invite.isPending} onPress={() => void submit()} />}>
      <TextField testID="invite-phone" label={t('household.invite_phone')} value={phone} onChangeText={setPhone} placeholder="07XX XXX XXXX" keyboardType="phone-pad" leadingIcon="phone" maxLength={16} autoFocus />
      <View style={{ gap: theme.space[3] }}>
        <Text variant="title">{t('household.invite_role')}</Text>
        <ChipGroup
          mode="single"
          required
          value={[role]}
          onChange={(next) => setRole((next[0] as 'orderer' | 'member' | undefined) ?? role)}
          items={[
            { id: 'orderer', label: t('household.role_orderer'), icon: 'bag' },
            { id: 'member', label: t('household.role_member'), icon: 'user' },
          ]}
        />
        <Text variant="footnote" color="textMuted">
          {role === 'orderer' ? t('household.role_orderer_hint') : t('household.role_member_hint')}
        </Text>
      </View>
      {role === 'orderer' ? (
        <TextField testID="invite-limit" label={t('household.limit_label')} value={limit} onChangeText={setLimit} placeholder="25,000" keyboardType="number-pad" hint={t('household.limit_hint')} />
      ) : null}
    </Screen>
  );
}
