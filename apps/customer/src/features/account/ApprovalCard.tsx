import { router } from 'expo-router';
import { View } from 'react-native';
import type { PayerApprovalView } from '@driver/contracts';
import { Avatar, Button, Card, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { countKey } from '@/lib/plural';
import { useResolveApproval } from './queries';

/**
 * One payer-approval request (domain §12, joy w5, audit W-03): the payer decides with the order in
 * front of them — «طلب من منار: مطعم خالد · 32,000 دينار», the dishes, where it goes and the limit —
 * then «وافق هالمرة» (this order only) or «ارفض», with «غيّر الحد» for a lasting change. No gendered
 * verbs (voice §3). The requester sees it waiting.
 */
export function ApprovalCard({ approval }: { approval: PayerApprovalView }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { approve, decline } = useResolveApproval();
  const name = approval.requestedByName ?? t('household.someone');
  const busy = approve.isPending || decline.isPending;
  const ctx = approval.context;

  const run = async (which: 'approve' | 'decline') => {
    try {
      await (which === 'approve' ? approve : decline).mutateAsync({ requestId: approval.id });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  const facts = [
    ctx && ctx.itemCount > 0 ? t(countKey('household.approval_items', ctx.itemCount), { n: ctx.itemCount }) : null,
    ctx?.placeLabel ? t('household.approval_place', { place: ctx.placeLabel }) : null,
    approval.limitIqd !== null ? t('household.approval_limit', { amount: amountParam(approval.limitIqd) }) : null,
  ].filter(Boolean);

  return (
    <Card testID={`approval-${approval.id}`} padding={4} tone={approval.canResolve ? 'tint' : 'surface'}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
          <Avatar name={name} size={40} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">
              {ctx?.merchantName
                ? t('household.approval_request_from', { name, merchant: ctx.merchantName, amount: amountParam(approval.amountIqd) })
                : t('household.approval_request', { name, amount: amountParam(approval.amountIqd) })}
            </Text>
            {ctx?.itemsSummary ? (
              <Text variant="footnote" numberOfLines={2} testID={`approval-items-${approval.id}`}>
                {ctx.itemsSummary}
              </Text>
            ) : null}
            {facts.length > 0 ? (
              <Text variant="footnote" color="textMuted">
                {facts.join(' · ')}
              </Text>
            ) : null}
          </View>
        </View>
        {approval.canResolve ? (
          <View style={{ gap: theme.space[1] }}>
            <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
              <Button testID={`approve-${approval.id}`} style={{ flex: 1 }} label={t('household.approve_once')} icon="check" loading={approve.isPending} disabled={busy} onPress={() => void run('approve')} />
              <Button testID={`decline-${approval.id}`} style={{ flex: 1 }} variant="secondary" label={t('household.decline')} loading={decline.isPending} disabled={busy} onPress={() => void run('decline')} />
            </View>
            <Button
              testID={`approval-limit-${approval.id}`}
              variant="ghost"
              size="sm"
              label={t('household.change_limit', { name })}
              onPress={() => router.push({ pathname: '/household/member', params: { personId: approval.requestedBy } })}
            />
          </View>
        ) : (
          <StatusPill size="sm" tone={approval.state === 'approved' ? 'success' : approval.state === 'declined' ? 'danger' : 'warning'} label={t(approval.state === 'approved' ? 'household.state_approved' : approval.state === 'declined' ? 'household.state_declined' : 'household.state_pending')} />
        )}
      </View>
    </Card>
  );
}
