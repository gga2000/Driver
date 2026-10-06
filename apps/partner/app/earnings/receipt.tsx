import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, RetryState, retryKindFor, Skeleton, useLoadTimeout, useNetwork, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useJobReceipt } from '@/features/account/queries';
import { DisputeSheet, QueryStatus, ReceiptCash, ReceiptHead, ReceiptLines } from '@/features/account/ReceiptParts';
import { apiErrorCode } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/**
 * "ليش انحسبتلي هيچ؟" — one job's pay (UI/UX audit S-7): the ticket number and Baghdad time, every
 * line with its reason (the same sentence the customer saw on the quote), the platform's take with
 * its rate, the cash he took and where it went, and "عندي اعتراض" — a message to support with the job
 * attached. Once sent, the receipt says where it stands («دا نراجعه» / «انحلت») with support's reply.
 * Opened from any job in الأرباح or كشف الحساب, or from the reply push (`?key=&at=`).
 */
export default function ReceiptScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const params = useLocalSearchParams<{ key?: string; at?: string }>();
  const at = useMemo(() => {
    const d = params.at ? new Date(params.at) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }, [params.at]);
  const q = useJobReceipt(params.key ?? '', at);
  const r = q.data;
  const [slow, restartSlow] = useLoadTimeout(!r && !q.isError);
  const [dispute, setDispute] = useState(false);
  const missing = !params.key || !at || apiErrorCode(q.error) === 'not_found';

  // The objection sits right under the receipt, not pinned to the bottom: a short receipt left a
  // tall empty gap above a pinned button (review p4b).
  const disputeAction = r ? (
    r.queryOpen ? (
      <QueryStatus r={r} />
    ) : (
      <Button testID="receipt-dispute" label={t('partner.receipt_dispute')} icon="chat" variant="secondary" size="lg" fullWidth onPress={() => setDispute(true)} />
    )
  ) : null;

  return (
    <Screen testID="receipt" edges={['bottom']}>
      <Stack.Screen options={{ title: t('partner.receipt_title') }} />
      {missing ? (
        <View testID="receipt-missing">
          <EmptyState icon="receipt" title={t('partner.receipt_not_found')} action={{ label: t('action.back'), onPress: () => (router.canGoBack() ? router.back() : router.replace('/earnings')) }} />
        </View>
      ) : !r ? (
        q.isError || slow ? (
          <RetryState
            kind={retryKindFor({ net, error: q.error, slow })}
            locale={locale}
            title={t('partner.receipt_failed')}
            onRetry={() => {
              restartSlow();
              void q.refetch();
            }}
          />
        ) : (
          <View testID="receipt-loading" style={{ gap: theme.space[4] }}>
            <Card elevation={1} padding={5}>
              <Skeleton lines={3} />
            </Card>
            <Card elevation={0} padding={4}>
              <Skeleton lines={5} />
            </Card>
          </View>
        )
      ) : (
        <>
          <ReceiptHead r={r} />
          <ReceiptLines r={r} />
          <ReceiptCash r={r} />
          {disputeAction}
          <DisputeSheet r={r} visible={dispute} onClose={() => setDispute(false)} />
        </>
      )}
    </Screen>
  );
}
