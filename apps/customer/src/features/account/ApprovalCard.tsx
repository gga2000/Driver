import { View } from 'react-native';
import type { PayerApprovalView } from '@driver/contracts';
import { Avatar, Button, Card, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useResolveApproval } from './queries';

/**
 * One payer-approval request (domain §12): "{name} يريد يطلب بـ X، أكثر من حده. توافق؟" with
 * one-tap وافق / ارفض for the payer; the requester sees it waiting.
 */
export function ApprovalCard({ approval }: { approval: PayerApprovalView }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { approve, decline } = useResolveApproval();
  const name = approval.requestedByName ?? t('household.someone');
  const busy = approve.isPending || decline.isPending;

  const run = async (which: 'approve' | 'decline') => {
    try {
      await (which === 'approve' ? approve : decline).mutateAsync({ requestId: approval.id });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  return (
    <Card testID={`approval-${approval.id}`} padding={4} tone={approval.canResolve ? 'tint' : 'surface'}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Avatar name={name} size={40} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">{t('household.approval_request', { name, amount: amountParam(approval.amountIqd) })}</Text>
            {approval.limitIqd !== null ? (
              <Text variant="footnote" color="textMuted">
                {t('household.approval_limit', { amount: amountParam(approval.limitIqd) })}
              </Text>
            ) : null}
          </View>
        </View>
        {approval.canResolve ? (
          <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
            <Button testID={`approve-${approval.id}`} style={{ flex: 1 }} label={t('household.approve')} icon="check" loading={approve.isPending} disabled={busy} onPress={() => void run('approve')} />
            <Button testID={`decline-${approval.id}`} style={{ flex: 1 }} variant="secondary" label={t('household.decline')} loading={decline.isPending} disabled={busy} onPress={() => void run('decline')} />
          </View>
        ) : (
          <StatusPill size="sm" tone={approval.state === 'approved' ? 'success' : approval.state === 'declined' ? 'danger' : 'warning'} label={t(approval.state === 'approved' ? 'household.state_approved' : approval.state === 'declined' ? 'household.state_declined' : 'household.state_pending')} />
        )}
      </View>
    </Card>
  );
}
