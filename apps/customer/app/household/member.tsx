import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Avatar, Button, Text, TextField, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useHousehold, useSetLimit } from '@/features/account/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { toWesternDigits } from '@/lib/phone';

/** Payer: a member's spending limit; orders above it ask the payer first. Empty = no limit. */
export default function MemberLimit() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { personId } = useLocalSearchParams<{ personId: string }>();
  const household = useHousehold();
  const setLimit = useSetLimit();
  const member = household.data?.members.find((m) => m.personId === personId) ?? null;
  const [limit, setLimitText] = useState('');

  useEffect(() => {
    if (member?.spendingLimitIqd != null) setLimitText((v) => v || String(member.spendingLimitIqd));
  }, [member?.spendingLimitIqd]);

  const value = limit.trim() ? Number(toWesternDigits(limit).replace(/[^\d]/g, '')) : null;

  const save = async () => {
    if (!household.data || !member) return;
    try {
      await setLimit.mutateAsync({ householdId: household.data.id, personId: member.personId, spendingLimitIqd: value });
      router.back();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  return (
    <Screen edges={['bottom']} footer={<Button label={t('action.save')} size="lg" fullWidth disabled={!member} loading={setLimit.isPending} onPress={() => void save()} />}>
      {member ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Avatar name={member.name ?? '?'} icon={member.name ? undefined : 'user'} size={48} />
          <Text variant="title">{member.name ?? `⁦${member.phoneMasked}⁩`}</Text>
        </View>
      ) : null}
      <TextField label={t('household.limit_label')} value={limit} onChangeText={setLimitText} placeholder={t('household.no_limit')} keyboardType="number-pad" hint={t('household.limit_hint')} />
    </Screen>
  );
}
