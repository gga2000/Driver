import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { Button, Icon, Text, useNetwork, useTheme, useToast } from '@driver/ui';
import { pickPhoto, uploadPhoto, type PickedPhoto } from '@/features/account/photo';
import { useRefreshWork } from '@/features/work/queries';
import { apiErrorCode, useApiClient } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { storage } from '@/lib/storage';
import { groupDigits, overCeiling, parseReceipt, receiptKey } from './logic';

interface Recorded {
  receiptIqd: number;
  cashDueIqd: number;
}

/**
 * «الوصل» (دوّرلي): at the shops, what he paid, typed from the receipt with its photo. The server makes
 * it the goods' price and the customer's new total at the door; until he leaves the shops he can
 * change it. Over the customer's ceiling the button itself says he called first (never a block).
 */
export function ReceiptPanel({ tripId, stopId, listMaxIqd }: { tripId: string; stopId: string; listMaxIqd: number | null }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const net = useNetwork();
  const client = useApiClient();
  const refresh = useRefreshWork();
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const key = receiptKey(stopId);

  useEffect(() => {
    let live = true;
    void storage.getItem(key).then((raw) => {
      if (!live || !raw) return;
      try {
        const v = JSON.parse(raw) as Recorded;
        if (Number.isInteger(v.receiptIqd) && Number.isInteger(v.cashDueIqd)) setRecorded(v);
      } catch {
        /* unreadable: ask again */
      }
    }, () => undefined);
    return () => {
      live = false;
    };
  }, [key]);

  const amount = parseReceipt(text);
  const over = overCeiling(amount, listMaxIqd);

  const takePhoto = async () => {
    const got = await pickPhoto('camera', { document: true });
    if (got === 'denied') toast.show({ message: t('partner.errand.receipt_camera_denied'), tone: 'warning', icon: 'camera' });
    else if (got) setPhoto(got);
  };

  const send = async () => {
    if (amount === null || !photo) return;
    setBusy(true);
    try {
      const photoUploadId = await uploadPhoto(photo, (input) => client.places.photoUpload.mutate(input));
      const res = await client.partner.errandReceipt.mutate({ tripId, stopId, totalIqd: amount, photoUploadId });
      const next = { receiptIqd: res.receiptIqd, cashDueIqd: res.cashDueIqd };
      setRecorded(next);
      setEditing(false);
      setText('');
      setPhoto(null);
      void storage.setItem(key, JSON.stringify(next)).catch(() => undefined);
      void refresh();
    } catch (e) {
      const code = apiErrorCode(e);
      toast.show({ message: t(code === 'order_state_conflict' ? 'partner.errand.receipt_locked' : 'partner.errand.receipt_failed'), tone: 'warning', icon: 'receipt' });
    } finally {
      setBusy(false);
    }
  };

  if (recorded && !editing) {
    return (
      <View testID="errand-receipt-done" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.space[3] }}>
        <Icon name="receipt" size={20} color="successText" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={700} tabular>
            {t('partner.errand.receipt_recorded', { amount: amountParam(recorded.receiptIqd) })}
          </Text>
          {recorded.cashDueIqd > 0 ? (
            <Text variant="caption" color="textMuted" tabular>
              {t('partner.errand.receipt_due', { amount: amountParam(recorded.cashDueIqd) })}
            </Text>
          ) : null}
        </View>
        <Button testID="errand-receipt-edit" label={t('partner.errand.receipt_change')} size="sm" variant="secondary" onPress={() => setEditing(true)} />
      </View>
    );
  }

  return (
    <View testID="errand-receipt" style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.space[3], gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="receipt" size={18} color="accentText" />
        <Text variant="label" weight={700} style={{ flex: 1 }}>
          {t('partner.errand.receipt_title')}
        </Text>
      </View>
      <Text variant="caption" color="textMuted">
        {t('partner.errand.receipt_hint')}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], borderWidth: 1.5, borderColor: over ? theme.colors.warning : theme.colors.borderStrong, borderRadius: theme.radius.md, paddingHorizontal: theme.space[3], minHeight: 52 }}>
        <TextInput
          testID="errand-receipt-amount"
          value={amount === null ? text.replace(/\D/g, '') : groupDigits(amount)}
          onChangeText={setText}
          keyboardType="number-pad"
          inputMode="numeric"
          placeholder="0"
          placeholderTextColor={theme.colors.textMuted}
          accessibilityLabel={t('partner.errand.receipt_amount_a11y')}
          style={[{ flex: 1, fontSize: 22, fontWeight: '700', color: theme.colors.text, textAlign: 'right', writingDirection: 'ltr', fontVariant: ['tabular-nums'], paddingVertical: theme.space[2] }, { outlineStyle: 'none' } as object]}
        />
        <Text variant="label" color="textMuted">
          {t('quote.currency')}
        </Text>
      </View>
      {over ? (
        <View testID="errand-receipt-over" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
          <Icon name="phone" size={16} color="warningText" />
          <Text variant="caption" weight={600} color="warningText" style={{ flex: 1 }}>
            {t('partner.errand.receipt_over', { amount: amountParam(listMaxIqd ?? 0) })}
          </Text>
        </View>
      ) : null}
      <Button
        testID="errand-receipt-photo"
        label={t(photo ? 'partner.errand.receipt_photo_again' : 'partner.errand.receipt_photo')}
        icon={photo ? 'check' : 'camera'}
        variant={photo ? 'secondary' : 'ink'}
        fullWidth
        onPress={() => void takePhoto()}
      />
      <Button
        testID="errand-receipt-send"
        label={t(over ? 'partner.errand.receipt_called' : 'partner.errand.receipt_send')}
        variant="primary"
        fullWidth
        loading={busy}
        disabled={amount === null || !photo || !net.online}
        onPress={() => void send()}
      />
      {!net.online ? (
        <Text variant="caption" color="warningText">
          {t('partner.errand.receipt_offline')}
        </Text>
      ) : null}
    </View>
  );
}
