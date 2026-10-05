import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, EmptyState, Icon, RetryState, retryKindFor, Skeleton, Text, useLoadTimeout, useNetwork, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useJobReceipt } from '@/features/account/queries';
import { DisputeSheet, ReceiptCash, ReceiptHead, ReceiptLines } from '@/features/account/ReceiptParts';
import { apiErrorCode } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/**
 * "ليش انحسبتلي هيچ؟" — one job's pay (UI/UX audit S-7): the ticket number and Baghdad time, every
 * line with its reason (the same sentence the customer saw on the quote), the platform's take with
 * its rate, the cash he took and where it went, and "عندي اعتراض" — a message to support with the job
 * attached. Opened from any job in الأرباح or كشف الحساب (`?key=&at=` from the job line).
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

  return (
    <Screen
      testID="receipt"
      edges={['bottom']}
      footer={
        r ? (
          r.queryOpen ? (
            <View testID="receipt-query-open" accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.infoTint }}>
              <Icon name="chat" size={20} color="infoText" />
              <View style={{ flex: 1 }}>
                <Text variant="label" weight={600} color="infoText">
                  {t('partner.receipt_dispute_open')}
                </Text>
                <Text variant="caption" color="text">
                  {t('partner.receipt_dispute_open_body')}
                </Text>
              </View>
            </View>
          ) : (
            <Button testID="receipt-dispute" label={t('partner.receipt_dispute')} icon="chat" variant="secondary" size="lg" fullWidth onPress={() => setDispute(true)} />
          )
        ) : undefined
      }
    >
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
          <DisputeSheet r={r} visible={dispute} onClose={() => setDispute(false)} />
        </>
      )}
    </Screen>
  );
}
