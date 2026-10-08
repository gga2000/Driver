import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { BoardOrder } from '@driver/contracts';
import { Badge, Button, CountdownRing, Icon, ModalSheet, StatusPill, Text, useTheme, type IconName } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { threadOf } from '@/features/chat/logic';
import { useChatThreads } from '@/features/chat/queries';
import { useMaskedCall } from '@/features/chat/useMaskedCall';
import { useLocale, useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { amountParam, iqd } from '@/lib/money';
import { clock12 } from '@/lib/time';
import { LADDER } from './ladder';
import { courierLine, hasAllergy } from './logic';
import { isPractice } from './practice';
import { AllergyPill, KitchenNote, OrderItems } from './OrderCard';

export interface OrderDetailSheetProps {
  order: BoardOrder | null;
  now: number;
  /** Server clock for the accept ring (M-11). */
  clock?: () => number;
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
export function OrderDetailSheet({ order, now, clock, onClose, onAccept, onReject, onReady, onPrint }: OrderDetailSheetProps) {
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
      // M-11: reading a long ticket is exactly when the 90 s run out — the same ring as the card.
      aside={
        order.column === 'new' && order.acceptBy && !order.partial ? (
          <CountdownRing mode="accept" startedAt={order.acceptBy.getTime() - 90_000} durationMs={90_000} urgentMs={LADDER.finalAtMs} clock={clock ?? (() => now)} size={60} strokeWidth={5} testID="detail-ring" />
        ) : null
      }
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
        {hasAllergy(order) ? <AllergyPill testID="detail-allergy" /> : null}
        {courier ? <StatusPill tone={courier.tone} icon="bike" live={courier.live} label={t(courier.key, courier.params)} /> : <StatusPill tone="neutral" icon="bike" label={t('merchant.courier.none')} />}
        {order.groups.length > 1 ? <StatusPill tone="neutral" icon="user" label={t('merchant.detail.people', { count: order.groups.length })} /> : null}
      </View>

      {/* M-09: the kitchen's note first (an allergy can't be scrolled past), the courier's after the items. */}
      {order.note ? (
        <View style={{ gap: theme.space[1] }}>
          <Text variant="caption" color="textMuted">
            {t('merchant.detail.kitchen_note')}
          </Text>
          <KitchenNote note={order.note} testID="detail-kitchen-note" />
        </View>
      ) : null}

      {/* s2: a practice order has nobody behind it to chat with or call. */}
      {isPractice(order.id) ? <StatusPill tone="accent" icon="bulb" label={t('merchant.practice.tag')} /> : <Contact order={order} onLeave={onClose} />}

      <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[4] }}>
        <OrderItems order={order} />
      </View>

      {order.courierNote ? (
        <View testID="detail-courier-note" style={{ gap: theme.space[1] }}>
          <Text variant="caption" color="textMuted">
            {t('merchant.detail.courier_note')}
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.space[2], borderRadius: theme.radius.md, padding: theme.space[3], borderWidth: 1, borderColor: theme.colors.border, borderStyle: 'dashed' }}>
            <MIcon name="bike" size={18} color="textMuted" />
            <Text variant="label" color="textMuted" style={{ flex: 1 }}>
              {order.courierNote}
            </Text>
          </View>
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

/**
 * Chat with the courier (and the customer, about the order) and a masked call to the courier
 * (notifications & support §2). Unread counts poll with the threads; the chat opens full screen.
 */
function Contact({ order, onLeave }: { order: BoardOrder; onLeave: () => void }) {
  const theme = useTheme();
  const t = useT();
  const { wide } = useLayout();
  const threads = useChatThreads(order.id);
  const courier = threadOf(threads.data, 'merchant_courier');
  const customer = threadOf(threads.data, 'customer_merchant');
  const { call, busy } = useMaskedCall(order.id, 'merchant_courier', false);
  const open = (kind: 'merchant_courier' | 'customer_merchant') => {
    onLeave();
    router.push({ pathname: '/chat/[orderId]', params: { orderId: order.id, kind, number: order.number } });
  };
  const courierLive = Boolean(courier && courier.status !== 'not_open');
  if (!courierLive && !(customer && customer.status !== 'not_open')) return null;
  return (
    <View testID="detail-contact" style={{ gap: theme.space[2] }}>
      <Text variant="label" color="textMuted">
        {t('merchant.chat.contact_title')}
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        {courierLive ? (
          <>
            <ContactButton icon="chat" label={t('merchant.chat.courier')} stacked={!wide} badge={courier!.unread} onPress={() => open('merchant_courier')} testID="detail-chat-courier" />
            {courier!.canCall ? <ContactButton icon="phone" label={t('merchant.chat.call_courier')} stacked={!wide} disabled={busy} onPress={() => void call()} testID="detail-call-courier" /> : null}
          </>
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
            <Text variant="footnote" color="textMuted">
              {t('merchant.chat.no_courier')}
            </Text>
          </View>
        )}
        {customer && customer.status !== 'not_open' ? (
          <ContactButton icon="user" label={t('merchant.chat.customer')} stacked={!wide} badge={customer.unread} onPress={() => open('customer_merchant')} testID="detail-chat-customer" />
        ) : null}
      </View>
    </View>
  );
}

/** Icon beside the label on a tablet; icon over the label on a phone (three fit across). */
function ContactButton({ icon, label, badge = 0, onPress, disabled, stacked, testID }: { icon: IconName; label: string; badge?: number; onPress: () => void; disabled?: boolean; stacked?: boolean; testID: string }) {
  const theme = useTheme();
  const t = useT();
  if (stacked) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={badge > 0 ? `${label} · ${t('merchant.chat.unread', { count: badge })}` : label}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          alignItems: 'center',
          gap: 4,
          paddingVertical: theme.space[3],
          paddingHorizontal: theme.space[1],
          borderRadius: theme.radius.lg,
          backgroundColor: badge > 0 ? theme.colors.accentTint : theme.colors.surfaceSunken,
          opacity: pressed || disabled ? 0.7 : 1,
        })}
      >
        <View>
          <Icon name={icon} size={22} color="text" strokeWidth={2} />
          {badge > 0 ? <Badge count={badge} style={{ position: 'absolute', top: -8, end: -14 }} /> : null}
        </View>
        <Text variant="caption" weight={600} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={badge > 0 ? `${label} · ${t('merchant.chat.unread', { count: badge })}` : label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space[2],
        minHeight: 56,
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.lg,
        backgroundColor: badge > 0 ? theme.colors.accentTint : theme.colors.surfaceSunken,
        opacity: pressed || disabled ? 0.7 : 1,
      })}
    >
      <Icon name={icon} size={20} color="text" strokeWidth={2} />
      <Text variant="label" weight={600} numberOfLines={1}>
        {label}
      </Text>
      {badge > 0 ? <Badge count={badge} /> : null}
    </Pressable>
  );
}
