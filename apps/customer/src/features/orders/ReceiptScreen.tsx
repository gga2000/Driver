import { router, Stack } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { orderTicketNumber, type OrderTracking } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, EmptyState, formatClock, Rule, Skeleton, Text, useNow, useTheme } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { SlipLine } from '@/features/food/SlipLine';
import { useTracking } from '@/features/track/queries';
import { ActionRow, priceItems } from '@/features/track/SheetParts';
import { PaidCard } from '@/features/track/ThanksCard';
import { TrackTopBar } from '@/features/track/TrackParts';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { useMyPersonId, useOrderHistory } from './queries';
import { canOrderAgain, receiptStamp, type ReceiptStamp } from './orders-v2';
import { DishThumb, dayHeading } from './OrdersV2Parts';
import { useReorderFlow } from './ReorderSheet';


/**
 * A past kitchen order as its receipt (after-order design o7 + o10, switch `orders_v2`): the same
 * paper slip as checkout's «الوصل» — every dish and who it was for, every fee with «ليش؟», savings in
 * saffron, the total, what he paid and what went to his wallet — kept for every order, ready to
 * screenshot for the family. «اطلبه مرة ثانية» and «عندي مشكلة» sit under it. Every amount is the
 * order's own, as the server recorded it.
 */
export function ReceiptScreen({ id }: { id: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const insets = useSafeAreaInsets();
  const track = useTracking(id);
  const history = useOrderHistory();
  const me = useMyPersonId();
  const reorder = useReorderFlow();
  const tick = useNow(true, 60_000);
  const now = useMemo(() => new Date(tick), [tick]);
  const v = track.data;
  const row = history.data?.find((r) => r.order.id === id) ?? null;

  const shell = (children: ReactNode) => (
    <View testID="order-receipt" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[8] + insets.bottom, gap: theme.space[4], width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' }}>
        <TrackTopBar top={insets.top} orderNo={t('order.number', { id: orderTicketNumber(id) })} />
        {children}
      </ScrollView>
      {reorder.sheet}
    </View>
  );

  if (track.isError && !v) {
    const code = apiErrorCode(track.error);
    const missing = code === 'forbidden' || code === 'not_found' || code === 'order_not_found';
    return shell(
      <EmptyState
        icon="receipt"
        title={missing ? t('track.not_found') : apiErrorMessage(track.error, t('error.network'), locale)}
        action={missing ? { label: t('nav.orders'), onPress: () => router.replace('/orders') } : { label: t('action.retry'), onPress: () => void track.refetch() }}
      />,
    );
  }
  if (!v) {
    return shell(
      <View accessibilityLabel={t('status.loading')} style={{ gap: theme.space[3] }}>
        <Skeleton height={72} radius={theme.radius.xl} />
        <Skeleton height={260} radius={theme.radius.xl} />
        <Skeleton height={52} />
      </View>,
    );
  }

  const o = v.order;
  const stamp = receiptStamp(o);
  const again = row && canOrderAgain(row, me);
  return shell(
    <>
      <Slip view={v} now={now} stamp={stamp} thumb={row ? <DishThumb row={row} size={52} /> : null} />
      {again ? (
        <Button testID="receipt-reorder" size="lg" fullWidth icon="refresh" label={t('orders.reorder')} loading={reorder.busyOrderId === o.id} onPress={() => void reorder.start(row)} />
      ) : null}
      <View style={{ borderTopWidth: 1, borderColor: theme.colors.border }}>
        <ActionRow icon="flag" label={t('order.report_problem')} hint={t('orders2.problem_hint')} onPress={() => router.push({ pathname: '/help/[orderId]', params: { orderId: o.id } })} testID="receipt-problem" />
      </View>
    </>,
  );
}

/** The paper slip itself: the kitchen and when, the dishes, the fees, the total, and what was paid. */
function Slip({ view, now, stamp, thumb }: { view: OrderTracking; now: Date; stamp: ReceiptStamp; thumb: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const o = view.order;
  const fees = priceItems(view, t).filter((i) => i.key !== 'items');
  // Who each dish was for, only when the order was shared (as checkout's slip and the old details).
  const shared = view.items.some((i) => i.participantId !== null);
  const guestNo = new Map(o.participants.map((p, i) => [p.id, i + 1]));
  const whoOf = (pid: string | null) => (pid === null ? t('track.for_me') : (o.participants.find((p) => p.id === pid)?.label ?? t('track.for_guest', { n: guestNo.get(pid) ?? 1 })));
  const when = `${dayHeading(t, o.placedAt, now)} · ${formatClock(o.placedAt)}`;
  const arrived = o.deliveredAt ? t('orders2.arrived_at', { time: formatClock(o.deliveredAt) }) : null;
  return (
    <View testID="receipt-slip" style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[4], gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        {thumb}
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text variant="title" face="display" accessibilityRole="header" numberOfLines={2}>
            {view.merchant?.name ?? t(`order.type.${o.type}` as MessageKey)}
          </Text>
          <Text variant="footnote" color="textMuted" tabular>
            {arrived ? `${when} · ${arrived}` : when}
          </Text>
        </View>
      </View>
      {stamp ? (
        <View testID="receipt-stamp" style={{ alignSelf: 'flex-start', paddingHorizontal: theme.space[3], paddingVertical: theme.space[1], borderRadius: theme.radius.md, borderWidth: 1.5, borderColor: stamp === 'disputed' ? theme.colors.warningText : theme.colors.borderStrong }}>
          <Text variant="label" weight={700} color={stamp === 'disputed' ? 'warningText' : 'textMuted'}>
            {t(`orders.short.${stamp}` as MessageKey)}
          </Text>
        </View>
      ) : null}

      <Rule kind="dashed" color="borderStrong" thickness={1.5} />

      <View style={{ gap: theme.space[1] }} testID="receipt-dishes">
        {view.items.map((it) => (
          <SlipLine key={it.lineId} label={`${it.qty > 1 ? `${it.name} ×${it.qty}` : it.name}${shared ? ` · ${whoOf(it.participantId)}` : ''}`} amountIqd={it.totalIqd} testID={`receipt-dish-${it.lineId}`} />
        ))}
      </View>
      {fees.length > 0 ? (
        <View style={{ gap: theme.space[1] }} testID="receipt-fees">
          {fees.map((f) => (
            <SlipLine key={f.key} label={f.label} amountIqd={f.amount} reason={f.reason} testID={`receipt-fee-${f.key}`} />
          ))}
        </View>
      ) : null}

      <Rule kind="dashed" color="borderStrong" thickness={1.5} />

      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }} accessible accessibilityLabel={`${t('quote.total')} ${iqd(o.totalIqd, { locale })}`} testID="receipt-total">
        <Text variant="title" style={{ flex: 1 }}>
          {t('quote.total')}
        </Text>
        <Text variant="amount" face="display" tabular>
          {iqd(o.totalIqd, { locale })}
        </Text>
      </View>
      {/* What he paid and what went to his wallet, only once the server recorded the hand-over. */}
      {o.deliveredAt ? <PaidCard view={view} /> : null}
    </View>
  );
}
