import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Switch, View } from 'react-native';
import { Avatar, Button, Card, ChipGroup, EmptyState, Icon, ListRow, PriceBreakdown, SegmentedControl, Skeleton, Text, TextField, useNetwork, useTheme } from '@driver/ui';
import { changeDue, tenderOptions } from '@driver/contracts';
import { Screen } from '@/components/Screen';
import { groupByPerson, reconcile } from '@/features/food/cart';
import { cartStore, useCartStore } from '@/features/food/cart-store';
import { afterFailure, attemptFor, attemptSignature, shouldReplay } from '@/features/food/place-attempt';
import {
  NEW_CUSTOMER_CAP_IQD,
  buildPlaceOrderInput,
  checkoutTotals,
  clock12,
  overNewCustomerCap,
  placeProblem,
  priorCashOrders,
  scheduleSlots,
  validTender,
  walletChoice,
  type Recipient,
} from '@/features/food/checkout';
import { useWalletBalance } from '@/features/account/queries';
import { DeliverToRow } from '@/features/food/DeliverToRow';
import { priceItems } from '@/features/food/price-lines';
import { useCartQuote, useDeliverTo, useMenu, useOrderQuote, usePlaceOrder } from '@/features/food/queries';
import { useMyOrders } from '@/features/home/queries';
import { apiErrorCode, apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { formatPhoneInput, normalizeIraqiPhone } from '@/lib/phone';
import { useProfile } from '@/lib/profile';

const STREET_SAVING_IQD = 250;

/**
 * One-screen checkout (spec §3): deliver-to (saved place, door or street hand-over −250), who
 * receives it, when (now or a half-hour slot), payment (cash — rounded up to 250, the change back to
 * the wallet as "الباقي رصيد" — or the wallet, which pays the exact price; disabled with what is
 * missing and a top-up link when short, C-04), the named price lines and "اطلب هسة · total". No promo
 * field until promo codes exist (C-05). Places the order with catalog ids, participants and the
 * drop-off, and explains price_changed, sold-out items, a short wallet and the new-customer cash cap in
 * plain Arabic. The restaurant's deal is the server's own line (`orders.quote`); a deal that ended
 * between cart and place refreshes the total (`deal_changed`).
 *
 * No duplicate orders: each attempt carries one idempotency key (`place-attempt.ts`). When the answer
 * is lost (the network dropped mid-request) the key is kept with the cart; the next tap — or the app
 * itself once the network is back — re-sends it and the server answers with the order it already
 * placed, which opens. Kitchen and courier notes are separate fields (M-09).
 */
export default function CheckoutScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const queryClient = useQueryClient();
  const cartState = useCartStore();
  const cart = cartState.cart;
  const pending = cartState.pending ?? null;
  const { name: myName } = useProfile();
  const { place, dropoff } = useDeliverTo();
  const [street, setStreet] = useState(false);
  // W-02 «استخدم نقاطك»: the server decides how many points apply (delivery fee first, then service fee).
  const [usePoints, setUsePoints] = useState(false);
  const quote = useCartQuote(cart, dropoff, street);
  const orderQuote = useOrderQuote(cart, dropoff, street, usePoints);
  const menu = useMenu(cart.merchant?.id);
  const mine = useMyOrders();
  const placeOrder = usePlaceOrder();
  const net = useNetwork();
  const wallet = useWalletBalance();
  const [payment, setPayment] = useState<'cash' | 'wallet'>('cash');
  // "راح أدفع بـ …" ("الخردة علينا"): optional; kept only while it fits the cash total.
  const [tenderPick, setTenderPick] = useState<number | null>(null);

  const [recipientId, setRecipientId] = useState<string>('me');
  const [otherName, setOtherName] = useState('');
  const [otherPhone, setOtherPhone] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const slots = useMemo(() => scheduleSlots(new Date()), []);
  const [slot, setSlot] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string }>({});
  const [kitchenNote, setKitchenNote] = useState('');
  const [courierNote, setCourierNote] = useState('');
  // One try at a time, whatever the taps (a web double click lands before the button re-renders).
  const inFlight = useRef(false);
  const [replaying, setReplaying] = useState(false);

  const merchant = cart.merchant;
  const ready = Boolean(quote.data && (orderQuote.data || orderQuote.isError));
  const priced = ready && quote.data ? checkoutTotals(cart, quote.data, orderQuote.data, 'wallet') : null;
  const balance = wallet.data ? wallet.data.moneyIqd : null;
  const walletRow = walletChoice(balance, priced?.priceIqd ?? 0);
  // A wallet that no longer covers the order (cart grew, balance spent elsewhere) falls back to cash.
  useEffect(() => {
    if (payment === 'wallet' && priced && balance !== null && !walletRow.usable) setPayment('cash');
  }, [payment, priced, balance, walletRow.usable]);

  // Points that no longer apply (spent on another order, cart changed) switch themselves off.
  const pointsOffer = orderQuote.data?.points ?? null;
  useEffect(() => {
    if (usePoints && orderQuote.data && !pointsOffer) setUsePoints(false);
  }, [usePoints, orderQuote.data, pointsOffer]);

  // After a lost answer, check the order by re-sending its key (it opens if it was placed): once when
  // the screen can (or the app restarted with it pending), and again each time the network comes back.
  // Never in a loop: a server that stays unreachable waits for the person's tap.
  const signature = merchant ? attemptSignature(merchant.id, cart.lines) : '';
  const onPlaceRef = useRef<(opts?: { replay?: boolean }) => Promise<void>>(async () => {});
  const canReplay = shouldReplay(pending, { online: net.state === 'online', inFlight: placeOrder.isPending }) && pending?.signature === signature && ready && cart.lines.length > 0;
  const replay = useCallback(() => void onPlaceRef.current({ replay: true }), []);
  const prevNet = useRef(net.state);
  const autoTried = useRef<string | null>(null);
  useEffect(() => {
    const cameBack = prevNet.current !== 'online' && net.state === 'online';
    prevNet.current = net.state;
    if (!canReplay || !pending) return;
    if (cameBack || autoTried.current !== pending.key) {
      autoTried.current = pending.key;
      replay();
    }
  }, [net.state, canReplay, pending, replay]);

  if (!merchant || cart.lines.length === 0) {
    return (
      <Screen edges={['bottom']} testID="checkout">
        <EmptyState icon="cart" title={t('cart.empty')} body={t('cart.empty_hint')} action={{ label: t('shell.back_home'), onPress: () => (router.canDismiss() ? router.dismissAll() : router.replace('/')) }} />
      </Screen>
    );
  }

  // The server's deal (orders.quote) is part of the total; place sends it back as an expectation.
  const totals = ready && quote.data ? checkoutTotals(cart, quote.data, orderQuote.data, payment) : null;
  const tender = validTender(tenderPick, totals?.totalIqd ?? null, payment);
  const restaurant = menu.data?.restaurant;
  const scheduledFor = when === 'later' ? (slots[slot] ?? null) : null;
  const { groups } = groupByPerson(cart);
  const capHit = totals ? overNewCustomerCap(totals.totalIqd, priorCashOrders(mine.data ?? []), payment) : false;
  const closedNow = restaurant ? !restaurant.open && !scheduledFor : false;

  const recipientItems = [
    { id: 'me', label: t('checkout.recipient_me'), avatar: { name: myName ?? t('checkout.recipient_me'), tone: 'accent' as const } },
    ...cart.people.map((p) => ({ id: p.id, label: p.name, avatar: { name: p.name } })),
    { id: 'other', label: t('checkout.recipient_other'), avatar: { icon: 'user' as const, tone: 'info' as const } },
  ];
  const recipientName = recipientId === 'me' ? null : recipientId === 'other' ? otherName.trim() || null : (cart.people.find((p) => p.id === recipientId)?.name ?? null);

  // Offline: say so up front and keep the cart, instead of a tap that fails (C-17). After a lost
  // answer, say that the order will be checked (not placed twice) once the network is back.
  const lostAnswer = pending?.unknownSince != null && pending.signature === signature;
  const netBlocker =
    net.state === 'offline' || net.state === 'unreachable'
      ? lostAnswer
        ? t('checkout.lost_answer_offline')
        : net.state === 'offline'
          ? t('checkout.offline_blocked')
          : t('checkout.unreachable_blocked')
      : null;
  const blocker = netBlocker ?? (!dropoff
    ? t('cart.pick_place')
    : closedNow && restaurant
        ? restaurant.closedReason === 'paused'
          ? t('restaurant.paused_until', { time: restaurant.opensAt ?? '' })
          : t('error.merchant_closed', { time: restaurant.opensAt ?? '' })
        : capHit
          ? t('checkout.cash_cap', { amount: amountParam(NEW_CUSTOMER_CAP_IQD) })
          : null);

  const recipient = (): Recipient | null => {
    if (recipientId === 'me') return { kind: 'me' };
    if (recipientId !== 'other') return { kind: 'person', personId: recipientId };
    const phone = normalizeIraqiPhone(otherPhone);
    const errors = { ...(otherName.trim() ? {} : { name: t('item.person_name_required') }), ...(phone ? {} : { phone: t('error.phone_invalid') }) };
    setFieldErrors(errors);
    return errors.name || errors.phone || !phone ? null : { kind: 'other', name: otherName.trim(), phone };
  };


  const onPlace = async (opts: { replay?: boolean } = {}) => {
    if (!totals || !dropoff || blocker || inFlight.current) return;
    const r = recipient();
    if (!r) return;
    setProblem(null);
    // The same basket re-uses the attempt whose answer was lost: the server places it once.
    const attempt = attemptFor(cartStore.getSnapshot().pending ?? null, signature);
    cartStore.setPending(attempt);
    inFlight.current = true;
    setReplaying(Boolean(opts.replay || attempt.unknownSince !== null));
    try {
      const order = await placeOrder.mutateAsync(
        buildPlaceOrderInput({
          cart,
          dropoff,
          streetHandover: street,
          recipient: r,
          scheduledFor,
          paymentMethod: payment,
          fees: { deliveryFeeIqd: totals.deliveryFeeIqd, serviceFeeIqd: totals.serviceFeeIqd },
          ...(orderQuote.data ? { discountIqd: totals.discountIqd } : {}),
          note: kitchenNote,
          courierNote,
          clientRequestId: attempt.key,
          statedTenderIqd: tender,
          usePoints: usePoints && totals.pointsIqd > 0,
          pointsIqd: totals.pointsIqd,
        }),
      );
      cartStore.markPlaced(order.id);
      void queryClient.invalidateQueries({ queryKey: api.orders.mine.queryKey() });
      router.replace({ pathname: '/kitchen/[id]', params: { id: order.id } });
    } catch (err) {
      const errCode = apiErrorCode(err);
      const next = afterFailure(attempt, errCode);
      cartStore.setPending(next);
      if (next) {
        // The answer was lost: the order may exist. Never a second order — the key is kept.
        // The footer says so from the kept attempt (and says "once the network is back" while offline).
        setProblem(null);
        return;
      }
      const kind = placeProblem(errCode);
      if (kind === 'deal_changed') {
        // The deal ended, ran out or changed since the cart: show the server's new total, ask again.
        await Promise.all([orderQuote.refetch(), quote.refetch()]);
        setProblem(t('checkout.deal_changed'));
      } else if (kind === 'price_changed' || kind === 'catalog_item_unavailable' || kind === 'modifier_invalid') {
        try {
          const fresh = await queryClient.fetchQuery({ ...api.catalog.menu.queryOptions({ merchantId: merchant.id, dropoff }), staleTime: 0 });
          const res = reconcile(cart, fresh.categories);
          cartStore.replaceCart(res.cart);
          await Promise.all([quote.refetch(), orderQuote.refetch()]);
          setProblem(res.removed.length ? t('checkout.item_unavailable', { items: res.removed.join('، ') }) : t('checkout.price_changed'));
        } catch {
          setProblem(t('error.price_changed'));
        }
      } else if (kind === 'new_customer_cash_cap') {
        setProblem(t('checkout.cash_cap', { amount: amountParam(NEW_CUSTOMER_CAP_IQD) }));
      } else if (kind === 'merchant_paused') {
        setProblem(t('checkout.paused'));
      } else if (kind === 'tender_invalid') {
        // The note no longer fits the total (it moved): drop it, he can pick again.
        setTenderPick(null);
        setProblem(apiErrorMessage(err, t('error.network'), locale));
      } else if (kind === 'wallet_insufficient') {
        await wallet.refetch();
        setPayment('cash');
        setProblem(t('checkout.wallet_insufficient'));
      } else {
        setProblem(apiErrorMessage(err, t('error.network'), locale));
      }
    } finally {
      inFlight.current = false;
      setReplaying(false);
    }
  };
  onPlaceRef.current = onPlace;

  const buttonLabel = totals
    ? scheduledFor
      ? t('checkout.place_scheduled', { time: clock12(scheduledFor), amount: amountParam(totals.totalIqd) })
      : t('checkout.place_now', { amount: amountParam(totals.totalIqd) })
    : t('checkout.title');
  // After a lost answer: "tap again, it won't be placed twice" (or, offline, "we'll check once it's back").
  const notice = blocker ?? (lostAnswer ? t('checkout.lost_answer') : null);

  const footer = (
    <View style={{ gap: theme.space[2] }}>
      {problem || notice ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }} testID="checkout-problem" accessibilityLiveRegion="polite">
          <Icon name={problem ? 'x' : 'clock'} size={18} color={problem ? 'dangerText' : 'warningText'} />
          <Text variant="footnote" color={problem ? 'dangerText' : 'warningText'} style={{ flex: 1 }}>
            {problem ?? notice}
          </Text>
        </View>
      ) : null}
      <Button
        testID="checkout-place"
        size="lg"
        fullWidth
        label={buttonLabel}
        loading={placeOrder.isPending}
        loadingLabel={replaying ? t('checkout.checking') : t('checkout.placing')}
        disabled={!totals || Boolean(blocker)}
        haptic="success"
        onPress={() => void onPlace()}
        accessibilityHint={lostAnswer ? t('checkout.lost_answer') : undefined}
      />
    </View>
  );

  return (
    <Screen edges={['bottom']} footer={footer} testID="checkout">
      <Section title={t('checkout.summary', { name: merchant.name })}>
        <Card elevation={0} padding={3}>
          <View style={{ gap: theme.space[2] }}>
            {groups.map((g) => (
              <View key={g.personId} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
                <Avatar size={28} name={g.person?.name ?? myName ?? t('item.for_me_chip')} tone={g.person ? undefined : 'accent'} />
                <Text variant="footnote" style={{ flex: 1 }} numberOfLines={2}>
                  <Text variant="footnote" weight={600}>
                    {g.person?.name ?? t('cart.for_me_section')}:{' '}
                  </Text>
                  {g.lines.map((l) => (l.qty > 1 ? `${l.name} ×${l.qty}` : l.name)).join('، ')}
                </Text>
              </View>
            ))}
            {restaurant?.etaMinMinutes != null && restaurant.etaMaxMinutes != null && !scheduledFor ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <Icon name="clock" size={16} color="accentText" />
                <Text variant="footnote" color="accentText" weight={600}>
                  {t('checkout.eta', { min: `⁦${restaurant.etaMinMinutes}`, max: `${restaurant.etaMaxMinutes}⁩` })}
                </Text>
              </View>
            ) : null}
            {/* Audit d-5: the honest-delay promise, in the server's own terms (threshold and credit). */}
            {orderQuote.data?.latePromise && !scheduledFor ? (
              <View testID="checkout-late-promise" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
                <View style={{ marginTop: 3 }}>
                  <Icon name="shield" size={16} color="successText" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="footnote" weight={600} color="successText">
                    {t('promise.line', { minutes: orderQuote.data.latePromise.afterMin })}
                  </Text>
                  <Text variant="caption" color="textMuted">
                    {t('promise.checkout_hint', { amount: amountParam(orderQuote.data.latePromise.creditIqd) })}
                  </Text>
                </View>
              </View>
            ) : null}
          </View>
        </Card>
      </Section>

      <Section title={t('checkout.deliver_to')}>
        <Card elevation={0} padding={0}>
          <DeliverToRow place={place} />
        </Card>
        <SegmentedControl
          accessibilityLabel={t('checkout.pickup_mode')}
          value={street ? 'street' : 'door'}
          onChange={(v) => setStreet(v === 'street')}
          options={[
            { value: 'door', label: t('checkout.pickup_door') },
            { value: 'street', label: `${t('checkout.pickup_street')} ${amountParam(-STREET_SAVING_IQD)}` },
          ]}
        />
        <Text variant="footnote" color="textMuted">
          {street ? t('checkout.pickup_street_hint', { amount: amountParam(STREET_SAVING_IQD) }) : t('checkout.pickup_door_hint')}
        </Text>
      </Section>

      <Section title={t('checkout.recipient')}>
        <ChipGroup items={recipientItems} value={[recipientId]} required onChange={(v) => setRecipientId(v[0] ?? 'me')} accessibilityLabel={t('checkout.recipient')} />
        {recipientId === 'other' ? (
          <View style={{ gap: theme.space[2] }}>
            <TextField testID="checkout-recipient-name" value={otherName} onChangeText={setOtherName} placeholder={t('checkout.recipient_name')} error={fieldErrors.name} />
            <TextField
              testID="checkout-recipient-phone"
              value={otherPhone}
              onChangeText={(v) => setOtherPhone(formatPhoneInput(v))}
              placeholder={t('checkout.recipient_phone')}
              keyboardType="phone-pad"
              error={fieldErrors.phone}
            />
          </View>
        ) : null}
        {recipientName ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="phone" size={16} color="textMuted" />
            <Text variant="footnote" color="textMuted">
              {t('checkout.recipient_hint', { name: recipientName })}
            </Text>
          </View>
        ) : null}
      </Section>

      <Section title={t('checkout.when')}>
        <ChipGroup
          items={[
            { id: 'now', label: t('checkout.when_now'), icon: 'bike' },
            { id: 'later', label: t('checkout.schedule'), icon: 'clock' },
          ]}
          value={[when]}
          required
          onChange={(v) => setWhen(v[0] === 'later' ? 'later' : 'now')}
          accessibilityLabel={t('checkout.when')}
        />
        {when === 'later' ? (
          <ChipGroup
            items={slots.map((s, i) => ({ id: String(i), label: t('checkout.when_at', { time: clock12(s) }) }))}
            value={[String(slot)]}
            required
            onChange={(v) => setSlot(Number(v[0] ?? 0))}
          />
        ) : null}
      </Section>

      <Section title={t('checkout.notes')}>
        <TextField
          testID="checkout-note-kitchen"
          label={t('checkout.note_kitchen')}
          placeholder={t('checkout.note_kitchen_placeholder')}
          value={kitchenNote}
          onChangeText={setKitchenNote}
          maxLength={500}
          multiline
        />
        <TextField
          testID="checkout-note-courier"
          label={t('checkout.note_courier')}
          placeholder={t('checkout.note_courier_placeholder')}
          value={courierNote}
          onChangeText={setCourierNote}
          maxLength={300}
          multiline
        />
      </Section>

      <Section title={t('checkout.payment')}>
        <Card elevation={0} padding={0}>
          <ListRow
            testID="checkout-pay-cash"
            leading="cash"
            title={t('checkout.pay_cash')}
            subtitle={t('checkout.cash_change_hint')}
            selected={payment === 'cash'}
            onPress={() => setPayment('cash')}
            chevron={false}
            divider
          />
          <ListRow
            testID="checkout-pay-wallet"
            leading="wallet"
            title={t('checkout.pay_wallet')}
            subtitle={
              balance === null
                ? '…'
                : walletRow.usable || walletRow.missingIqd === 0
                  ? t('checkout.wallet_balance', { amount: amountParam(balance) })
                  : t('checkout.wallet_short', { balance: amountParam(balance), missing: amountParam(walletRow.missingIqd) })
            }
            selected={payment === 'wallet'}
            onPress={walletRow.usable ? () => setPayment('wallet') : undefined}
            chevron={false}
            trailing={
              payment === 'wallet' ? undefined : balance !== null && !walletRow.usable ? (
                <Button size="sm" variant="secondary" icon="plus" label={t('checkout.wallet_topup')} onPress={() => router.push('/topup')} testID="checkout-wallet-topup" />
              ) : undefined
            }
          />
        </Card>
        {pointsOffer ? (
          <Card elevation={0} padding={0}>
            <ListRow
              testID="checkout-points"
              leading="gift"
              title={t('checkout.points_row', { amount: amountParam(pointsOffer.valueIqd) })}
              subtitle={t('checkout.points_hint', { n: amountParam(pointsOffer.balance) })}
              onPress={() => setUsePoints((v) => !v)}
              chevron={false}
              trailing={
                <Switch
                  testID="checkout-points-switch"
                  accessibilityLabel={t('checkout.points_row', { amount: amountParam(pointsOffer.valueIqd) })}
                  value={usePoints}
                  onValueChange={setUsePoints}
                  trackColor={{ true: theme.colors.accent, false: theme.colors.border }}
                  {...(Platform.OS === 'web' ? { activeThumbColor: theme.colors.surface } : {})}
                />
              }
            />
          </Card>
        ) : null}
        {payment === 'cash' && totals ? <PayWith totalIqd={totals.totalIqd} value={tender} onChange={setTenderPick} /> : null}
      </Section>

      <Section title={t('checkout.price_breakdown')}>
        {totals ? (
          <PriceBreakdown items={priceItems(totals, t, locale)} total={totals.totalIqd} change={totals.changeIqd} note={t('quote.quote_locked')} testID="checkout-price" />
        ) : (
          <View style={{ gap: theme.space[2] }}>
            <Skeleton height={16} />
            <Skeleton height={16} width="70%" />
            <Skeleton height={28} width="50%" />
          </View>
        )}
      </Section>
    </Screen>
  );
}

/**
 * "راح أدفع بـ …" ("الخردة علينا", customer d-1): optional chips — the exact amount and the next notes
 * above the total — so the courier brings the change. Tapping the chosen one again clears it. The
 * courier sees "الزبون يدفع بـ 25,000 · جهّز 7,250 خردة"; without change on him the rest goes to the
 * wallet.
 */
function PayWith({ totalIqd, value, onChange }: { totalIqd: number; value: number | null; onChange: (v: number | null) => void }) {
  const theme = useTheme();
  const t = useT();
  const options = tenderOptions(totalIqd);
  if (options.length === 0) return null;
  const change = value !== null ? changeDue(value, totalIqd) : 0;
  return (
    <View testID="checkout-pay-with" style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2], flexWrap: 'wrap' }}>
        <Text variant="label" weight={600}>
          {t('cashchange.pay_with_title')}
        </Text>
        <Text variant="caption" color="textMuted">
          {t('cashchange.pay_with_hint')}
        </Text>
      </View>
      <ChipGroup
        accessibilityLabel={t('cashchange.pay_with_title')}
        items={options.map((n) => ({ id: `tender-${n}`, label: n === totalIqd ? `${amountParam(n)} ${t('cashchange.pay_with_exact')}` : amountParam(n) }))}
        value={value !== null ? [`tender-${value}`] : []}
        onChange={(next) => onChange(next[0] ? Number(next[0].slice('tender-'.length)) : null)}
      />
      {value !== null ? (
        <View testID="checkout-pay-with-note" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }} accessibilityLiveRegion="polite">
          <Icon name={change > 0 ? 'cash' : 'check'} size={16} color="successText" strokeWidth={2.2} />
          <Text variant="footnote" color="successText" tabular style={{ flex: 1 }}>
            {change > 0 ? t('cashchange.pay_with_change', { amount: amountParam(change) }) : t('cashchange.pay_with_exact_note')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="title" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}
