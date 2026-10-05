import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { orderTicketNumber, type DisputeKind } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, Card, ChipGroup, EmptyState, formatClock, Icon, Skeleton, Text, TextField, useNow, useTheme, useToast, type IconName } from '@driver/ui';
import type { ThemeColorKey } from '@driver/design-tokens';
import { Screen } from '@/components/Screen';
import { HeaderBack } from '@/features/food/HeaderBack';
import { WhatsAppCard } from '@/features/help/HelpParts';
import { helpCase, issueKinds } from '@/features/help/issue';
import { dayKey } from '@/features/orders/history';
import { dayLabel, OrderArt, orderTitle } from '@/features/orders/OrderRow';
import { useOrderHistory } from '@/features/orders/queries';
import { itemsSummary } from '@/features/orders/reorder';
import { useOpenDispute } from '@/features/track/queries';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * "عندي مشكلة" on one order (audit C-13): what happened (the dispute kinds), an optional note, and
 * "دز الشكوى" → `orders.openDispute`, which opens the support ticket. An order still running points
 * to its own screen; a closed or cancelled one to WhatsApp with the order number typed in.
 */
export default function OrderIssue() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { orderId = '' } = useLocalSearchParams<{ orderId: string }>();
  const history = useOrderHistory();
  const row = history.data?.find((r) => r.order.id === orderId) ?? null;
  const open = useOpenDispute(orderId);
  const [kind, setKind] = useState<DisputeKind | null>(null);
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const tick = useNow(true, 60_000);
  const now = useMemo(() => new Date(tick), [tick]);
  const ticket = orderTicketNumber(orderId);
  const waMessage = t('help.whatsapp_order_message', { id: ticket });

  const submit = () =>
    kind &&
    open.mutate(
      { orderId, kind, ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: () => setSent(true),
        onError: (e) => {
          // The window closed while the screen was open: say so the same way the screen does.
          if (apiErrorCode(e) === 'dispute_window_closed') void history.refetch();
          toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' });
        },
      },
    );

  const which = row ? helpCase(row.order) : null;
  return (
    <Screen
      testID="help-issue"
      edges={[]}
      contentStyle={{ gap: theme.space[5] }}
      footer={
        which === 'dispute' && !sent ? (
          <Button testID="issue-submit" size="lg" fullWidth label={t('dispute.submit')} disabled={!kind} loading={open.isPending} onPress={submit} />
        ) : undefined
      }
    >
      <Stack.Screen options={{ title: t('help.issue_title'), headerShown: true, headerLeft: () => <HeaderBack /> }} />
      {history.isPending ? (
        <View style={{ gap: theme.space[3] }}>
          <Skeleton height={72} />
          <Skeleton height={120} />
        </View>
      ) : !row ? (
        <EmptyState icon="receipt" title={t('help.order_not_found')} action={{ label: t('help.back_home'), onPress: () => router.back() }} />
      ) : (
        <>
          <Card padding={4} elevation={0}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <OrderArt row={row} size={52} />
              <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {orderTitle(t, row, locale)}
                </Text>
                {row.items.length > 0 ? (
                  <Text variant="footnote" color="textMuted" numberOfLines={2}>
                    {itemsSummary(row.items, 4)}
                  </Text>
                ) : null}
                <Text variant="caption" color="textMuted" tabular>
                  {[`${dayLabel(t, dayKey(row.order.placedAt, now))} ${formatClock(row.order.placedAt)}`, t('orders.row_meta', { time: `#${ticket}`, amount: amountParam(row.order.totalIqd) })].join(' · ')}
                </Text>
              </View>
            </View>
          </Card>

          {sent ? (
            <Card padding={5} elevation={0} tone="tint" testID="issue-sent">
              <View style={{ alignItems: 'center', gap: theme.space[3] }}>
                <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: theme.colors.successTint, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="check" size={28} color="successText" strokeWidth={2.6} />
                </View>
                <Text variant="title" align="center">
                  {t('help.issue_done_title')}
                </Text>
                <Text variant="body" color="textMuted" align="center">
                  {t('help.issue_done_body')}
                </Text>
                <Button variant="secondary" label={t('help.back_home')} onPress={() => router.back()} />
              </View>
            </Card>
          ) : which === 'dispute' ? (
            <View style={{ gap: theme.space[4] }}>
              <Text variant="title" accessibilityRole="header">
                {t('dispute.title')}
              </Text>
              <ChipGroup
                accessibilityLabel={t('dispute.title')}
                items={issueKinds(row.order.type).map((k) => ({ id: k.kind, label: t(k.key as MessageKey) }))}
                value={kind ? [kind] : []}
                onChange={(next) => setKind((next[0] as DisputeKind | undefined) ?? null)}
                mode="single"
              />
              <TextField testID="issue-note" multiline value={note} onChangeText={setNote} maxLength={1000} placeholder={t('help.issue_note_placeholder')} numberOfLines={3} textAlignVertical="top" />
              <Text variant="footnote" color="textMuted">
                {t('dispute.window_note')}
              </Text>
            </View>
          ) : (
            <View style={{ gap: theme.space[4] }}>
              <Notice which={which} />
              {which === 'running' ? (
                <Button testID="issue-open-order" icon="receipt" variant="secondary" fullWidth label={t('help.open_order')} onPress={() => router.push({ pathname: '/order/[id]', params: { id: orderId } })} />
              ) : (
                <WhatsAppCard message={waMessage} testID="issue-whatsapp" />
              )}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const NOTICE: Record<'running' | 'disputed' | 'closed' | 'cancelled', { key: MessageKey; icon: IconName; bg: ThemeColorKey; fg: ThemeColorKey }> = {
  running: { key: 'help.issue_running', icon: 'clock', bg: 'accentTint', fg: 'accentText' },
  disputed: { key: 'help.issue_disputed', icon: 'shield', bg: 'infoTint', fg: 'infoText' },
  closed: { key: 'help.issue_closed', icon: 'receipt', bg: 'surfaceSunken', fg: 'text' },
  cancelled: { key: 'help.issue_cancelled', icon: 'x', bg: 'surfaceSunken', fg: 'text' },
};

function Notice({ which }: { which: 'running' | 'disputed' | 'closed' | 'cancelled' | 'dispute' | null }) {
  const theme = useTheme();
  const t = useT();
  if (!which || which === 'dispute') return null;
  const n = NOTICE[which];
  return (
    <View testID={`issue-${which}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.colors[n.bg] }}>
      <View style={{ marginTop: 2 }}>
        <Icon name={n.icon} size={20} color={n.fg} strokeWidth={2.2} />
      </View>
      <Text variant="body" color={n.fg} style={{ flex: 1 }}>
        {t(n.key)}
      </Text>
    </View>
  );
}
