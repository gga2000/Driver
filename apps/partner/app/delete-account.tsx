import { useMutation } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { IconName } from '@driver/ui';
import { Button, Card, EmptyState, Icon, Text, TextField, useNetwork, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/**
 * «احذف حسابي» (docs/api/account-close.md): what goes and what stays, then one button that opens a
 * support case (`identity.requestDeletion`). Support settles his cash and money with him and an admin
 * closes the account from the Console; until then it keeps working. Asking twice keeps one case.
 */
export default function DeleteAccountScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const net = useNetwork();
  const api = useApi();
  const request = useMutation(api.identity.requestDeletion.mutationOptions());
  const [note, setNote] = useState('');
  const offline = !net.online;

  const send = async () => {
    try {
      await request.mutateAsync(note.trim() ? { note: note.trim() } : {});
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  if (request.data) {
    return (
      <Screen testID="delete-account-sent">
        <Stack.Screen options={{ title: t('partner.delete_title') }} />
        <EmptyState icon="check" title={t('partner.delete_sent_title')} body={t(request.data.alreadyOpen ? 'partner.delete_already' : 'partner.delete_sent_body')} />
      </Screen>
    );
  }

  return (
    <Screen
      testID="delete-account"
      edges={['bottom']}
      footer={<Button testID="delete-account-send" label={t('partner.delete_send')} variant="destructive" size="lg" fullWidth disabled={offline} loading={request.isPending} onPress={() => void send()} />}
    >
      <Stack.Screen options={{ title: t('partner.delete_title') }} />
      <Text variant="body">{t('partner.delete_lead')}</Text>
      <Part icon="trash" title={t('partner.delete_goes_title')} body={t('partner.delete_goes_body')} />
      <Part icon="receipt" title={t('partner.delete_stays_title')} body={t('partner.delete_stays_body')} />
      <Part icon="cash" title={t('partner.delete_before_title')} body={t('partner.delete_before_body')} />
      <TextField testID="delete-account-note" label={t('partner.delete_note')} value={note} onChangeText={setNote} multiline maxLength={500} />
      {offline ? (
        <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center' }}>
          <Icon name="wifi-off" size={18} color="textMuted" />
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {t('partner.delete_offline')}
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

function Part({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  const theme = useTheme();
  return (
    <Card elevation={0} padding={4}>
      <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
        <Icon name={icon} size={22} color="textMuted" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={600}>
            {title}
          </Text>
          <Text variant="footnote" color="textMuted">
            {body}
          </Text>
        </View>
      </View>
    </Card>
  );
}
