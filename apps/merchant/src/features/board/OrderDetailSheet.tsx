import { View } from 'react-native';
import type { BoardOrder } from '@driver/contracts';
import { Button, StatusPill, Text, useTheme } from '@driver/ui';
import { ModalSheet } from '@/components/ModalSheet';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { clock12 } from '@/lib/time';
import { courierLine } from './logic';
import { OrderItems } from './OrderCard';

export interface OrderDetailSheetProps {
  order: BoardOrder | null;
  now: number;
  onClose: () => void;
  onAccept: (o: BoardOrder) => void;
  onReject: (o: BoardOrder) => void;
  onReady: (o: BoardOrder) => void;
  onPrint: (o: BoardOrder) => void;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[3] }}>
      <Text variant="label" color={strong ? 'text' : 'textMuted'} weight={strong ? 700 : 500}>
        {label}
      </Text>
      <Text variant="label" weight={strong ? 700 : 600} tabular>
        {value}
      </Text>
    </View>
  );
}

/** The whole ticket: every line by person, times, money, courier; print and the column's actions. */
export function OrderDetailSheet({ order, now, onClose, onAccept, onReject, onReady, onPrint }: OrderDetailSheetProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  if (!order) return null;
  const courier = courierLine(order.courier, now);
  return (
    <ModalSheet
      visible
      onClose={onClose}
      size="lg"
      testID="order-detail"
      title={t('merchant.detail.title', { number: order.number })}
      subtitle={[t('merchant.detail.placed_at', { time: clock12(order.placedAt) }), order.promisedReadyAt ? t('merchant.detail.ready_by', { time: clock12(order.promisedReadyAt) }) : null].filter(Boolean).join(' · ')}
      footer={
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          <Button testID="detail-print" label={t('merchant.print')} icon="receipt" variant="secondary" size="lg" onPress={() => onPrint(order)} style={{ flex: 1 }} />
          {order.column === 'new' && !order.partial ? (
            <>
              <Button label={t('merchant.reject')} variant="secondary" size="lg" onPress={() => onReject(order)} style={{ flex: 1 }} />
              <Button label={t('merchant.accept')} size="lg" onPress={() => onAccept(order)} style={{ flex: 2 }} />
            </>
          ) : order.column === 'preparing' ? (
            <>
              <Button label={t('merchant.detail.reject_late')} variant="ghost" size="lg" onPress={() => onReject(order)} style={{ flex: 1 }} />
              <Button label={t('merchant.card.mark_ready')} icon="check" size="lg" onPress={() => onReady(order)} style={{ flex: 2 }} />
            </>
          ) : null}
        </View>
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {courier ? <StatusPill tone={courier.tone} icon="bike" live={courier.live} label={t(courier.key, courier.params)} /> : <StatusPill tone="neutral" icon="bike" label={t('merchant.courier.none')} />}
        {order.groups.length > 1 ? <StatusPill tone="neutral" icon="user" label={t('merchant.detail.people', { count: order.groups.length })} /> : null}
      </View>

      <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[4] }}>
        <OrderItems order={order} />
      </View>

      {order.note ? (
        <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[4], gap: 2 }}>
          <Text variant="caption" color="textMuted">
            {t('merchant.card.order_note')}
          </Text>
          <Text variant="bodyStrong">{order.note}</Text>
        </View>
      ) : null}

      <View style={{ gap: theme.space[2], backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[4] }}>
        <Row label={t('merchant.detail.items_total')} value={iqd(order.itemsTotalIqd, { locale })} strong />
        <Row label={t('merchant.detail.order_total')} value={iqd(order.totalIqd, { locale })} />
        <Text variant="footnote" color={order.paymentMethod === 'cash' ? 'warningText' : 'successText'} weight={600}>
          {order.paymentMethod === 'cash' ? t('merchant.detail.payment_cash', { amount: amountParam(order.collectCashIqd) }) : t('merchant.detail.payment_prepaid')}
        </Text>
      </View>
    </ModalSheet>
  );
}
