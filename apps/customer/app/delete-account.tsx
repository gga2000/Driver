import { useMutation } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { IconName } from '@driver/ui';
import { Button, Card, EmptyState, Icon, Text, TextField, useNetwork, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { HeaderBack } from '@/features/food/HeaderBack';
import { apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/**
 * The public web page the stores ask for (docs/api/account-close.md): `/delete-account` on the
 * customer website. Anyone with a Driver account — customer, courier, driver, restaurant — signs in
 * with his number (the guard sends a signed-out visitor to the phone screen and back) and sends the
 * request: a support case (`identity.requestDeletion`). The same form as the partner and merchant apps.
 */
export default function DeleteAccountScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const api = useApi();
  const request = useMutation(api.identity.requestDeletion.mutationOptions());
  const [note, setNote] = useState('');
  const offline = !net.online;

  const send = () => request.mutate(note.trim() ? { note: note.trim() } : {});

  if (request.data) {
    return (
      <Screen testID="delete-account-sent">
        <Stack.Screen options={{ title: t('delete_request.title'), headerShown: true, headerLeft: () => <HeaderBack /> }} />
        <EmptyState icon="check" title={t('delete_request.sent_title')} body={t(request.data.alreadyOpen ? 'delete_request.already' : 'delete_request.sent_body')} />
      </Screen>
    );
  }

  return (
    <Screen
      testID="delete-account"
      edges={['bottom']}
      footer={<Button testID="delete-account-send" label={t('delete_request.send')} variant="destructive" size="lg" fullWidth disabled={offline} loading={request.isPending} onPress={send} />}
    >
      <Stack.Screen options={{ title: t('delete_request.title'), headerShown: true, headerLeft: () => <HeaderBack /> }} />
      <Text variant="body">{t('delete_request.lead')}</Text>
      <Part icon="trash" title={t('delete_request.goes_title')} body={t('delete_request.goes_body')} />
      <Part icon="receipt" title={t('delete_request.stays_title')} body={t('delete_request.stays_body')} />
      <Part icon="cash" title={t('delete_request.before_title')} body={t('delete_request.before_body')} />
      <TextField testID="delete-account-note" label={t('delete_request.note')} value={note} onChangeText={setNote} multiline maxLength={500} />
      {request.isError ? (
        <Text testID="delete-account-error" variant="label" color="dangerText">
          {apiErrorMessage(request.error, t('error.network'), locale)}
        </Text>
      ) : null}
      {offline ? (
        <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center' }}>
          <Icon name="wifi-off" size={18} color="textMuted" />
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {t('delete_request.offline')}
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
