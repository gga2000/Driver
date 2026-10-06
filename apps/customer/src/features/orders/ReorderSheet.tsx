import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cityDayDiff, formatClock, type MessageKey } from '@driver/i18n';
import { Avatar, Button, Card, Icon, IconButton, Skeleton, Text, useTheme, useToast, type IconName } from '@driver/ui';
import type { ThemeColorKey } from '@driver/design-tokens';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { TABLE, addLine, groupByPerson, type CartState } from '@/features/food/cart';
import { cartStore } from '@/features/food/cart-store';
import { buildPlaceOrderInput, checkoutTotals } from '@/features/food/checkout';
import { DeliverToRow } from '@/features/food/DeliverToRow';
import { afterFailure, attemptFor, attemptSignature } from '@/features/food/place-attempt';
import { useCartQuote, useDeliverTo, useOrderQuote, usePlaceOrder } from '@/features/food/queries';
import { apiErrorCode } from '@/lib/api';
import { appNow } from '@/lib/dev-clock';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useProfile } from '@/lib/profile';
import { useReorder, type ReorderState } from './queries';
import type { ReorderMissReason, ReorderResult, ReorderSwap } from './reorder';

const REASON: Record<ReorderMissReason, MessageKey> = {
  gone: 'reorder.reason_gone',
  sold_out: 'reorder.reason_sold_out',
  schedule: 'reorder.reason_schedule',
  choice_gone: 'reorder.reason_choice_gone',
};

/**
 * "اطلبه مرة ثانية" from anywhere (orders list, home card): `start(row)` rebuilds the cart from
 * today's menu and opens the express sheet (joy o13): the dishes by person, today's total from the
 * server, the address and cash, a swap for anything gone, and «اطلبه» placing it in one more tap.
 * «عدّل بالسلة» puts it in the cart instead.
 */
export function useReorderFlow(): { start: ReturnType<typeof useReorder>['start']; busyOrderId: string | null; sheet: ReactNode } {
  const t = useT();
  const toast = useToast();
  const flow = useReorder();
  const { state, close } = flow;

  /** «عدّل بالسلة»: the rebuilt cart (with any swaps added) goes to the cart screen. */
  const toCart = (cart: CartState) => {
    if (state.phase !== 'ready' || cart.lines.length === 0) return;
    cartStore.replaceCart(cart);
    close();
    toast.show({ message: t('reorder.done', { merchant: cart.merchant?.name ?? '' }), tone: 'success', icon: 'cart' });
    router.push('/cart');
  };

  const busyOrderId = state.phase === 'loading' ? state.row.order.id : null;
  const show = state.phase === 'error' || state.phase === 'ready';
  return {
    start: flow.start,
    busyOrderId,
    sheet: show ? <ReorderSheet key={state.row.order.id} state={state} onClose={close} onCart={toCart} onRetry={() => void flow.start(state.row, { scheduledFor: state.scheduledFor })} /> : null,
  };
}

function ReorderSheet({ state, onClose, onCart, onRetry }: { state: ReorderState; onClose: () => void; onCart: (cart: CartState) => void; onRetry: () => void }) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  if (state.phase !== 'ready' && state.phase !== 'error') return null;
  const merchant = state.row.merchantName ?? '';
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('action.close')} onPress={onClose} style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.scrim }} />
        <View
          testID="reorder-sheet"
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: MAX_CONTENT_WIDTH,
            maxHeight: '90%',
            alignSelf: 'center',
            backgroundColor: theme.colors.surface,
            borderTopStartRadius: theme.radius['2xl'],
            borderTopEndRadius: theme.radius['2xl'],
            paddingTop: theme.space[3],
            paddingBottom: theme.space[5] + insets.bottom,
          }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: theme.colors.border, marginBottom: theme.space[3] }} />
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3], paddingHorizontal: theme.space[5] }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading" accessibilityRole="header">
                {state.scheduledFor ? t('reorder.book_title') : t('reorder.express_title')}
              </Text>
              <Text variant="footnote" color="textMuted">
                {t('reorder.subtitle', { merchant })}
              </Text>
            </View>
            <IconButton icon="x" variant="tonal" size={44} accessibilityLabel={t('action.close')} onPress={onClose} testID="reorder-close" />
          </View>
          {state.phase === 'error' ? (
            <View style={{ padding: theme.space[5], gap: theme.space[4] }}>
              <Text variant="body" color="textMuted">
                {t('reorder.failed')}
              </Text>
              <Button label={t('action.retry')} variant="secondary" fullWidth onPress={onRetry} />
            </View>
          ) : (
            <Express result={state.result} replacing={state.replacing} oldTotalIqd={state.row.order.totalIqd} merchantId={state.row.order.merchantOrgId} scheduledFor={state.scheduledFor} onClose={onClose} onCart={onCart} />
          )}
        </View>
      </View>
    </Modal>
  );
}

/** The express body: what comes back (with swaps), where, how, today's server total, and the two buttons. */
function Express({
  result,
  replacing,
  oldTotalIqd,
  merchantId,
  scheduledFor,
  onClose,
  onCart,
}: {
  result: ReorderResult;
  replacing: string | null;
  oldTotalIqd: number;
  merchantId: string | null;
  /** «غدا الجمعة»: booked for this slot (the kitchen being closed now does not matter). */
  scheduledFor: Date | null;
  onClose: () => void;
  onCart: (cart: CartState) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const { name: myName } = useProfile();
  const { place, dropoff } = useDeliverTo();
  const [cart, setCart] = useState<CartState>(result.cart);
  const [taken, setTaken] = useState<string[]>([]);
  const quote = useCartQuote(cart, dropoff, false);
  const orderQuote = useOrderQuote(cart, dropoff, false);
  const placeOrder = usePlaceOrder();
  const totals = quote.data && (orderQuote.data || orderQuote.isError) ? checkoutTotals(cart, quote.data, orderQuote.data, 'cash') : null;
  const nothing = cart.lines.length === 0;
  const { groups } = groupByPerson(cart);
  const swaps = result.swaps.filter((s) => !taken.includes(s.item.id));
  const quoteFailed = quote.isError;
  useEffect(() => setCart(result.cart), [result.cart]);

  const addSwap = (s: ReorderSwap) => {
    if (!cart.merchant && !result.cart.merchant) return;
    const merchant = cart.merchant ?? result.cart.merchant!;
    const res = addLine(cart, merchant, { itemId: s.item.id, name: s.item.name, basePriceIqd: s.item.priceIqd, modifiers: [], qty: s.qty, note: null, personId: s.personId }, s.person ? { person: s.person } : {});
    if (res.ok) {
      theme.haptic('light');
      setCart(res.cart);
      setTaken((x) => [...x, s.item.id]);
    }
  };

  // Two taps: «اطلبه» places the order as checkout would (cash at the door, idempotency key). Anything
  // the server refuses (a price moved, the deal changed) is explained on the checkout screen.
  const placeNow = async () => {
    if (!totals || !dropoff || !cart.merchant) return;
    const attempt = attemptFor(cartStore.getSnapshot().pending ?? null, attemptSignature(cart.merchant.id, cart.lines));
    cartStore.replaceCart(cart);
    cartStore.setPending(attempt);
    try {
      const order = await placeOrder.mutateAsync(
        buildPlaceOrderInput({
          cart,
          dropoff,
          streetHandover: false,
          recipient: { kind: 'me' },
          scheduledFor,
          paymentMethod: 'cash',
          fees: { deliveryFeeIqd: totals.deliveryFeeIqd, serviceFeeIqd: totals.serviceFeeIqd },
          ...(orderQuote.data ? { discountIqd: totals.discountIqd } : {}),
          clientRequestId: attempt.key,
        }),
      );
      cartStore.markPlaced(order.id);
      onClose();
      router.push({ pathname: '/kitchen/[id]', params: { id: order.id } });
    } catch (err) {
      cartStore.setPending(afterFailure(attempt, apiErrorCode(err)));
      onClose();
      toast.show({ message: t('reorder.place_failed'), tone: 'warning', icon: 'cart' });
      router.push('/checkout');
    }
  };

  const canPlace = !nothing && (scheduledFor !== null || !result.closed) && Boolean(dropoff) && Boolean(totals);
  const bookedFor = scheduledFor ? t('reorder.book_when', { day: cityDayDiff(scheduledFor, appNow()) >= 1 ? t('time.tomorrow') : t('time.today'), time: formatClock(scheduledFor) }) : null;
  return (
    <>
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: theme.space[5], paddingTop: theme.space[4], gap: theme.space[4] }}>
        {bookedFor ? <Note icon="clock" tone="surfaceSunken" fg="text" text={bookedFor} testID="reorder-booked-for" /> : null}
        {result.closed && !scheduledFor ? <Note icon="clock" tone="warningTint" fg="warningText" text={result.opensAt ? t('reorder.closed', { time: result.opensAt }) : t('reorder.closed_no_time')} /> : null}
        {nothing ? <Note icon="x" tone="dangerTint" fg="dangerText" text={t('reorder.nothing')} testID="reorder-nothing" /> : null}

        {!nothing ? (
          <View style={{ gap: theme.space[2] }} testID="reorder-added">
            {groups.map((g) => (
              <View key={g.personId} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
                {g.personId === TABLE ? <Avatar size={28} icon="family" tone="accent" /> : <Avatar size={28} name={g.person?.name ?? myName ?? t('item.for_me_chip')} tone={g.person ? undefined : 'accent'} />}
                <Text variant="body" style={{ flex: 1 }}>
                  <Text variant="body" weight={600}>
                    {g.personId === TABLE ? t('cart.for_table_section') : (g.person?.name ?? t('cart.for_me_section'))}:{' '}
                  </Text>
                  {g.lines.map((l) => (l.qty > 1 ? `${l.qty}× ${l.name}` : l.name)).join('، ')}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {result.missing.length > 0 ? (
          <Group title={t('reorder.missing_heading')} testID="reorder-missing">
            {result.missing.map((m, i) => {
              const swap = swaps.find((s) => s.missing === m.name);
              return (
                <View key={`${m.name}-${i}`} style={{ gap: theme.space[2] }}>
                  <Line icon="x" fg="dangerText" title={m.qty > 1 ? `${m.qty}× ${m.name}` : m.name} sub={t(REASON[m.reason])} muted />
                  {swap ? (
                    <View testID={`reorder-swap-${swap.item.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingStart: 36 }}>
                      <Text variant="footnote" style={{ flex: 1 }} tabular>
                        {t('reorder.swap', { dish: swap.item.name, amount: amountParam(swap.item.priceIqd) })}
                      </Text>
                      <Button size="sm" variant="secondary" icon="plus" label={t('reorder.swap_add')} onPress={() => addSwap(swap)} />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </Group>
        ) : null}

        {result.repriced.length > 0 ? (
          <Group title={t('reorder.repriced_heading')} testID="reorder-repriced">
            {result.repriced.map((p) => (
              <Line key={p.name} icon="receipt" fg="warningText" title={p.name} sub={t('reorder.price_change', { was: amountParam(p.wasIqd), now: amountParam(p.nowIqd) })} />
            ))}
          </Group>
        ) : null}

        {result.droppedExtras.length > 0 ? (
          <Group title={t('reorder.extras_heading')}>
            {result.droppedExtras.map((d, i) => (
              <Line key={`${d.dish}-${d.extra}-${i}`} icon="x" fg="textMuted" title={t('reorder.extra_line', { dish: d.dish, extra: d.extra })} muted />
            ))}
          </Group>
        ) : null}

        {!nothing ? (
          <Card elevation={0} tone="sunken" padding={0}>
            <DeliverToRow place={place} divider />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[4], minHeight: 52 }}>
              <Icon name="cash" size={20} color="text" />
              <Text variant="body" style={{ flex: 1 }}>
                {t('reorder.pay_cash')}
              </Text>
            </View>
          </Card>
        ) : null}

        {!nothing ? (
          <View testID="reorder-total" accessibilityLiveRegion="polite">
            {totals ? (
              <Text variant="title" tabular>
                {t('reorder.total_today', { amount: amountParam(totals.totalIqd) })}
                {totals.totalIqd !== oldTotalIqd ? (
                  <Text variant="body" color="textMuted" tabular>
                    {' '}
                    {t('reorder.total_was', { amount: amountParam(oldTotalIqd) })}
                  </Text>
                ) : null}
              </Text>
            ) : quoteFailed || !dropoff ? (
              <Text variant="footnote" color="textMuted">
                {t('reorder.total_note')}
              </Text>
            ) : (
              <Skeleton height={24} width="60%" />
            )}
          </View>
        ) : null}

        {replacing && !nothing ? <Note icon="cart" tone="surfaceSunken" fg="text" text={t('reorder.replace_note', { merchant: replacing })} testID="reorder-replace" /> : null}
      </ScrollView>
      <View style={{ paddingHorizontal: theme.space[5], paddingTop: theme.space[4], gap: theme.space[2] }}>
        {nothing ? (
          <Button
            testID="reorder-menu"
            size="lg"
            fullWidth
            icon="food"
            label={t('reorder.open_menu')}
            onPress={() => {
              onClose();
              if (merchantId) router.push({ pathname: '/restaurant/[id]', params: { id: merchantId } });
            }}
          />
        ) : (
          <>
            {canPlace && totals ? (
              <Button testID="reorder-place" size="lg" fullWidth haptic="success" label={scheduledFor ? t('reorder.book', { amount: amountParam(totals.totalIqd) }) : t('reorder.place', { amount: amountParam(totals.totalIqd) })} loading={placeOrder.isPending} loadingLabel={t('checkout.placing')} onPress={() => void placeNow()} />
            ) : null}
            <Button testID="reorder-go" size={canPlace ? 'md' : 'lg'} variant={canPlace ? 'ghost' : 'primary'} fullWidth icon="cart" label={t('reorder.edit_in_cart')} onPress={() => onCart(cart)} />
            {totals ? (
              <Text variant="caption" color="textMuted" align="center" tabular>
                {t('checkout.pay_line_cash', { amount: amountParam(totals.totalIqd) })}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </>
  );
}

function Group({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ gap: theme.space[2] }}>
      <Text variant="label" weight={600} color="textMuted">
        {title}
      </Text>
      <View style={{ gap: theme.space[2] }}>{children}</View>
    </View>
  );
}

function Line({ icon, fg, title, sub, muted }: { icon: IconName; fg: ThemeColorKey; title: string; sub?: string; muted?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSunken, marginTop: 2 }}>
        <Icon name={icon} size={14} color={fg} strokeWidth={2.4} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text variant="body" color={muted ? 'textMuted' : 'text'}>
          {title}
        </Text>
        {sub ? (
          <Text variant="footnote" color="textMuted" tabular>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Note({ icon, tone, fg, text, testID }: { icon: IconName; tone: ThemeColorKey; fg: ThemeColorKey; text: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors[tone] }}>
      <View style={{ marginTop: 2 }}>
        <Icon name={icon} size={18} color={fg} strokeWidth={2.2} />
      </View>
      <Text variant="label" color={fg} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

/** The small "اطلبه مرة ثانية" button (orders list rows, the home card). */
export function ReorderButton({ onPress, loading, testID, size = 'sm' }: { onPress: () => void; loading: boolean; testID?: string; size?: 'sm' | 'md' }) {
  const t = useT();
  return <Button testID={testID} size={size} variant="secondary" icon="refresh" label={t('orders.reorder')} loading={loading} onPress={onPress} />;
}
