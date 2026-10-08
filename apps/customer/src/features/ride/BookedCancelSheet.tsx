import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Icon, ModalSheet, Skeleton, Text, useNetwork, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage, useApi, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * FLOW-26: «تلغي مشوار باچر 6:30؟» before a ride booked for later goes — one sheet for طلباتي and
 * «مشوارك محجوز». It says what the server says cancelling costs right now (free, or the fee and why),
 * and the yes waits until that answer is in, so nobody pays a fee they did not see.
 */
export function BookedCancelSheet({ orderId, when, visible, onClose, onCancelled, testID }: { orderId: string; when: string; visible: boolean; onClose: () => void; onCancelled?: () => void; testID: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const toast = useToast();
  const api = useApi();
  const client = useApiClient();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const preview = useQuery({ ...api.orders.cancellationPreview.queryOptions({ orderId }), enabled: visible, staleTime: 5_000 });
  const p = preview.data;

  const cancel = async () => {
    setBusy(true);
    try {
      await client.orders.cancel.mutate({ orderId, reason: 'booked_ride_cancelled' });
      onClose();
      toast.show({ message: t('orders.booked_cancelled', { when }), tone: 'neutral', icon: 'check' });
      void qc.invalidateQueries({ queryKey: api.orders.history.queryKey() });
      void qc.invalidateQueries({ queryKey: api.orders.mine.queryKey() });
      onCancelled?.();
    } catch (e) {
      toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalSheet
      visible={visible}
      onClose={() => (busy ? undefined : onClose())}
      locked={busy}
      title={t('orders.booked_cancel_title', { when })}
      testID={testID}
      footer={
        <View style={{ gap: theme.space[2] }}>
          {p && !p.allowed ? null : (
            <Button testID={`${testID}-yes`} variant="destructive" label={t('orders.booked_cancel_yes')} loading={busy} disabled={!net.online || !p} fullWidth onPress={() => void cancel()} />
          )}
          <Button label={t('orders.booked_cancel_no')} variant="ghost" fullWidth disabled={busy} onPress={onClose} />
        </View>
      }
    >
      {preview.isPending ? (
        <Skeleton height={22} width="70%" />
      ) : preview.isError ? (
        <Pressable accessibilityRole="button" onPress={() => void preview.refetch()} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 44 }} testID={`${testID}-failed`}>
          <Icon name={net.state !== 'online' ? 'wifi-off' : 'refresh'} size={18} color="textMuted" />
          <Text variant="body" color="textMuted" style={{ flex: 1 }}>
            {t('ride.cancel_fee_failed')} · {t('action.retry')}
          </Text>
        </Pressable>
      ) : p ? (
        <View style={{ gap: theme.space[1] }} testID={`${testID}-${!p.allowed ? 'blocked' : p.free ? 'free' : 'fee'}`}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name={!p.allowed ? 'x' : p.free ? 'check' : 'receipt'} size={18} color={!p.allowed ? 'textMuted' : p.free ? 'successText' : 'warningText'} strokeWidth={2.2} />
            <Text variant="bodyStrong" color={!p.allowed ? 'text' : p.free ? 'successText' : 'warningText'} style={{ flex: 1 }}>
              {!p.allowed ? t('track.cancel_not_allowed') : p.free ? t('track.cancel_free') : t('ride.cancel_fee', { amount: amountParam(p.amountIqd) })}
            </Text>
          </View>
          {!p.free && p.reason_ar ? (
            <Text variant="footnote" color="textMuted">
              {p.reason_ar}
            </Text>
          ) : null}
        </View>
      ) : null}
    </ModalSheet>
  );
}
