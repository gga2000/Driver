import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, Icon, Text, TextField, useNetwork, useTheme, type IconName } from '@driver/ui';
import { Page } from '@/components/Page';
import { apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useCounterToast } from '@/lib/toast';

/**
 * «احذف حسابي» (docs/api/account-close.md): what goes and what stays, then one button that opens a
 * support case (`identity.requestDeletion`). An owner's store money is settled first; the store itself
 * stays. An admin closes the account from the Console; until then it keeps working.
 */
export function DeleteAccountScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const net = useNetwork();
  const api = useApi();
  const request = useMutation(api.identity.requestDeletion.mutationOptions());
  const [note, setNote] = useState('');
  const offline = !net.online;

  const send = async () => {
    try {
      await request.mutateAsync(note.trim() ? { note: note.trim() } : {});
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };

  return (
    <Page title={t('merchant.delete.title')} back testID="delete-account">
      {request.data ? (
        <EmptyState icon="check" title={t('merchant.delete.sent_title')} body={t(request.data.alreadyOpen ? 'merchant.delete.already' : 'merchant.delete.sent_body')} />
      ) : (
        <View style={{ gap: theme.space[4] }}>
          <Text variant="body">{t('merchant.delete.lead')}</Text>
          <Part icon="trash" title={t('merchant.delete.goes_title')} body={t('merchant.delete.goes_body')} />
          <Part icon="receipt" title={t('merchant.delete.stays_title')} body={t('merchant.delete.stays_body')} />
          <Part icon="cash" title={t('merchant.delete.before_title')} body={t('merchant.delete.before_body')} />
          <TextField testID="delete-account-note" label={t('merchant.delete.note')} value={note} onChangeText={setNote} multiline maxLength={500} />
          {offline ? (
            <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center' }}>
              <Icon name="wifi-off" size={18} color="textMuted" />
              <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
                {t('merchant.delete.offline')}
              </Text>
            </View>
          ) : null}
          <Button testID="delete-account-send" label={t('merchant.delete.send')} variant="destructive" size="lg" fullWidth disabled={offline} loading={request.isPending} onPress={() => void send()} />
        </View>
      )}
    </Page>
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
