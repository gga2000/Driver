import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, Switch, View } from 'react-native';
import { Avatar, Button, Card, ChipGroup, EmptyState, Icon, ListRow, PriceBreakdown, SegmentedControl, Skeleton, Text, TextField, useNetwork, useTheme } from '@driver/ui';
import { changeDue, householdApproval, tenderOptions } from '@driver/contracts';
import { cityDayDiff, formatClock, formatMinuteCount, formatMinutesRange } from '@driver/i18n';
import { Screen } from '@/components/Screen';
import { TABLE, groupByPerson, reconcile } from '@/features/food/cart';
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
  validTender,
  walletChoice,
  type Recipient,
} from '@/features/food/checkout';
import { useHousehold, useWalletBalance } from '@/features/account/queries';
import { payerOf as householdPayerOf } from '@/features/account/family';
import { householdToPayFrom } from '@/features/account/household-pay';
import { etaClockAt, payCopy, paymentOf, payerOf, receiverHint, type Payer } from '@/features/food/checkout-lines';
import { DeliverToRow } from '@/features/food/DeliverToRow';
import { firstOpenSlot, preorderSlots } from '@/features/food/slots';
import { dinnerStore, useDinnerPick } from '@/features/ride-habits/dinner-store';
import { dinnerLine, withDinnerSlot } from '@/features/ride-habits/logic';
import { useDinnerTime } from '@/features/ride-habits/queries';
import { IFTAR_MIN_LEAD_MIN, iftarLeadMinutes, timesFor, withIftarSlot } from '@/features/season/ramadan';
import { useTimetable } from '@/features/season/use-timetable';
import { useSeason } from '@/lib/use-season';
import { EarnPill } from '@/features/food/EarnPill';
import { priceItems } from '@/features/food/price-lines';
import { quoteStop } from '@/features/food/stopped';
import { useCartQuote, useDeliverTo, useMenu, useOrderQuote, usePlaceOrder } from '@/features/food/queries';
import { useMyOrders } from '@/features/home/queries';
import { apiErrorCode, apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { promiseCopy } from '@/features/track/late-promise';
import { formatPhoneInput, normalizeIraqiPhone } from '@/lib/phone';
import { useProfile } from '@/lib/profile';
import { playCue } from '@/lib/sound';
import { cleanCard, giftInput } from '@/features/gift/gift';
import { GiftChoice, type GiftChoiceValue } from '@/features/gift/GiftChoice';
import { giftStore } from '@/features/gift/gift-store';

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
  // Joy w4: a wallet payment from the household wallet instead of his own (payers and orderers).
  const [fromHome, setFromHome] = useState(false);
  const household = useHousehold();
  // "راح أدفع بـ …" ("الخردة علينا"): optional; kept only while it fits the cash total.
  const [tenderPick, setTenderPick] = useState<number | null>(null);

  const [recipientId, setRecipientId] = useState<string>('me');
  const [otherName, setOtherName] = useState('');
  const [otherPhone, setOtherPhone] = useState('');
  // «عزيمة» (joy g1): a gift for whoever receives it; prices hide only with the wallet.
  const [gift, setGift] = useState<GiftChoiceValue>({ on: false, hidePrices: true, card: '' });
  const [when, setWhen] = useState<'now' | 'later'>('now');
  // o11: slots for today or tomorrow inside the kitchen's hours; a closed kitchen starts on its first one.
  const [day, setDay] = useState<0 | 1>(0);
  const hours = menu.data?.restaurant.hours;
  const pauses = menu.data?.restaurant.pauses;
  const baseSlots = useMemo(() => preorderSlots(new Date(), hours ?? [], day, { pauses: pauses ?? [] }), [hours, pauses, day]);
  // J6: in Ramadan, «على الفطور» on the person's timetable joins today's list (the server's slot, before the adhan).
  const season = useSeason();
  const [timetable] = useTimetable();
  const iftar = timesFor(season.ramadan, timetable);
  const plainSlots = useMemo(() => (day === 0 ? withIftarSlot(baseSlots, iftar, new Date(), IFTAR_MIN_LEAD_MIN) : baseSlots.map((at) => ({ at, iftar: false }))), [baseSlots, iftar, day]);
  // Joy r6 «عشاك يوصل وياك»: the server's time against the ride home (to this deliver-to place) joins
  // the day's slots and is chosen; the order is an ordinary pre-order at that time.
  const dinnerPick = useDinnerPick();
  const dinnerOn = Boolean(dinnerPick && place && place.id === dinnerPick.placeId);
  const dinnerTime = useDinnerTime(dinnerOn && dinnerPick ? dinnerPick.source : null, cart.merchant?.id ?? null);
  const dinnerAt = dinnerTime.data?.deliverAt ?? null;
  const dinnerDay: 0 | 1 | null = dinnerAt ? (cityDayDiff(dinnerAt, new Date()) >= 1 ? 1 : 0) : null;
  const dinnerAtMs = dinnerAt?.getTime() ?? null;
  const slots = useMemo(() => withDinnerSlot(plainSlots, dinnerAtMs !== null && dinnerDay === day ? new Date(dinnerAtMs) : null, (at) => ({ at, iftar: false })), [plainSlots, dinnerAtMs, dinnerDay, day]);
  const [slot, setSlot] = useState<string | null>(null);
  const preset = useRef(false);
  useEffect(() => {
    const r = menu.data?.restaurant;
    if (!r || preset.current) return;
    preset.current = true;
    if (r.open) return;
    const first = firstOpenSlot(new Date(), r.hours ?? [], undefined, r.pauses ?? []);
    if (!first) return;
    setWhen('later');
    setDay(first.day);
    setSlot(null);
  }, [menu.data]);
  // The dinner time, once the server gives it, is the chosen one (the rider may still pick another).
  const dinnerPreset = useRef<number | null>(null);
  useEffect(() => {
    if (dinnerAtMs === null || dinnerDay === null || dinnerPreset.current === dinnerAtMs) return;
    dinnerPreset.current = dinnerAtMs;
    setWhen('later');
    setDay(dinnerDay);
    setSlot(String(dinnerAtMs));
  }, [dinnerAtMs, dinnerDay]);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string }>({});
  const [kitchenNote, setKitchenNote] = useState('');
  const [courierNote, setCourierNote] = useState('');
  // o9: the receiver and the time are compact rows that open on «غيّر»; the notes open on a tap.
  const [open, setOpen] = useState<{ receiver: boolean; when: boolean; kitchenNote: boolean; courierNote: boolean }>({ receiver: false, when: false, kitchenNote: false, courierNote: false });
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  // One try at a time, whatever the taps (a web double click lands before the button re-renders).
  const inFlight = useRef(false);
  const [replaying, setReplaying] = useState(false);

  const merchant = cart.merchant;
  const ready = Boolean(quote.data && (orderQuote.data || orderQuote.isError));
  const priced = ready && quote.data ? checkoutTotals(cart, quote.data, orderQuote.data, 'wallet') : null;
  const balance = wallet.data ? wallet.data.moneyIqd : null;
  const walletRow = walletChoice(balance, priced?.priceIqd ?? 0);
  // Joy w4: the household wallet, for its payers and orderers; the server decides whether the payer
  // is asked first — the hint here reads the same rule on the hub's own numbers. Hidden while
  // HOUSEHOLD_PAY_ENABLED is off (RDB-03: nothing funds the household account yet).
  const home = householdToPayFrom(household.data);
  const homeBalance = home && wallet.data?.household?.id === home.id ? wallet.data.household.balanceIqd : null;
  const homeRow = walletChoice(homeBalance, priced?.priceIqd ?? 0);
  const meInHome = home?.members.find((m) => m.isMe) ?? null;
  const homePayer = home ? householdPayerOf(home) : null;
  const asksPayer =
    home && meInHome && priced
      ? householdApproval({ role: meInHome.role, orderLimitIqd: meInHome.spendingLimitIqd, monthlyBudgetIqd: meInHome.monthlyBudgetIqd, monthSpentIqd: meInHome.monthSpentIqd ?? 0, totalIqd: priced.priceIqd }) !== null
      : false;
  // A wallet that no longer covers the order (cart grew, balance spent elsewhere) falls back to cash.
  useEffect(() => {
    if (payment !== 'wallet' || !priced) return;
    if (fromHome ? homeBalance !== null && !homeRow.usable : balance !== null && !walletRow.usable) setPayment('cash');
  }, [payment, priced, balance, walletRow.usable, fromHome, homeBalance, homeRow.usable]);

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
  const chosen = slots.find((sl) => String(sl.at.getTime()) === slot) ?? slots[0] ?? null;
  const scheduledFor = when === 'later' ? (chosen?.at ?? null) : null;
  const { groups } = groupByPerson(cart);
  const capHit = totals ? overNewCustomerCap(totals.totalIqd, priorCashOrders(mine.data ?? []), payment) : false;
  const closedNow = restaurant ? !restaurant.open && !scheduledFor : false;

  const savedOthers = cartState.people.filter((p) => p.phone && !cart.people.some((c) => c.id === p.id));
  const savedPick = recipientId.startsWith('saved:') ? (savedOthers.find((p) => `saved:${p.id}` === recipientId) ?? null) : null;
  const recipientItems = [
    { id: 'me', label: t('checkout.recipient_me'), avatar: { name: myName ?? t('checkout.recipient_me'), tone: 'accent' as const } },
    ...cart.people.map((p) => ({ id: p.id, label: p.name, avatar: { name: p.name } })),
    // People saved on this phone with a number (g1: send mum a meal without adding her to the cart).
    ...savedOthers.map((p) => ({ id: `saved:${p.id}`, label: p.name, avatar: { name: p.name } })),
    { id: 'other', label: t('checkout.recipient_other'), avatar: { icon: 'user' as const, tone: 'info' as const } },
  ];
  const recipientName = recipientId === 'me' ? null : recipientId === 'other' ? otherName.trim() || null : savedPick ? savedPick.name : (cart.people.find((p) => p.id === recipientId)?.name ?? null);

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
  // REL-16: a service ops paused, or a zone that is full, is said calmly and holds the button.
  const stopped = quoteStop(orderQuote.error ?? quote.error, t, locale);
  const blocker = netBlocker ?? stopped ?? (!dropoff
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
    if (savedPick?.phone) return { kind: 'other', name: savedPick.name, phone: savedPick.phone };
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
          householdOrgId: fromHome && home ? home.id : null,
          gift: giftInput(gift, payment),
        }),
      );
      // o12: someone else receives it — keep their name and phone for «دز له رابط التتبع».
      const person = r.kind === 'person' ? cart.people.find((p) => p.id === r.personId) : undefined;
      const receiver = r.kind === 'other' ? { name: r.name, phone: r.phone } : person?.phone ? { name: person.name, phone: person.phone } : null;
      cartStore.markPlaced(order.id, receiver);
      // The order is in: a spoon taps the istikan twice (quiet on silent and with order sounds off).
      playCue('placed');
      // g1: the card line and who it goes to stay on this phone for the heads-up (never on the server).
      if (order.gift && receiver) giftStore.remember(order.id, { ...receiver, card: cleanCard(gift.card), paidByMe: payment === 'wallet' });
      void queryClient.invalidateQueries({ queryKey: api.orders.mine.queryKey() });
      dinnerStore.clear();
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

  const receiver = recipientName ? ({ kind: 'other', name: recipientName } as const) : ({ kind: 'me' } as const);
  const payLine = payCopy(amountParam(totals?.totalIqd ?? 0), payment, receiver);
  const etaMax = restaurant?.etaMaxMinutes ?? null;
  const whenValue = !scheduledFor
    ? t('checkout.when_now')
    : chosen?.dinner
      ? t(dinnerTime.data?.lateByMin ? 'dinner.slot_after' : 'dinner.slot', { time: clock12(scheduledFor) })
      : chosen?.iftar && iftar
      ? t('checkout.when_iftar', { time: clock12(iftar.iftarAt) })
      : `${day === 1 ? t('time.tomorrow') : t('time.today')} ${t('checkout.when_at', { time: clock12(scheduledFor) })}`;
  const receiverValue = recipientId === 'me' ? t('checkout.recipient_me') : recipientId === 'other' ? otherName.trim() || t('checkout.recipient_other') : (recipientName ?? t('checkout.recipient_other'));
  const choosePayer = (payer: Payer) => {
    const next = paymentOf(payer);
    if (next === 'wallet' && !walletRow.usable) return;
    setFromHome(false);
    setPayment(next);
  };
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
      <EarnPill points={orderQuote.data?.pointsEarn} grouped={groups.length > 1} />
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
      {/* o9: how the money moves, said once, right under the button. */}
      {totals ? (
        <Text variant="caption" color="textMuted" align="center" tabular testID="checkout-pay-line">
          {t(payLine.key, payLine.params)}
        </Text>
      ) : null}
    </View>
  );

  return (
    <Screen edges={['bottom']} footer={footer} testID="checkout">
      {/* o9: summary → place → payment → price → who/when → notes. */}
      <Section title={t('checkout.summary', { name: merchant.name })}>
        <Card elevation={0} padding={3}>
          <View style={{ gap: theme.space[2] }}>
            {groups.map((g) => (
              <View key={g.personId} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
                {g.personId === TABLE ? <Avatar size={28} icon="family" tone="accent" /> : <Avatar size={28} name={g.person?.name ?? myName ?? t('item.for_me_chip')} tone={g.person ? undefined : 'accent'} />}
                <Text variant="footnote" style={{ flex: 1 }} numberOfLines={2}>
                  <Text variant="footnote" weight={600}>
                    {g.personId === TABLE ? t('cart.for_table_section') : (g.person?.name ?? t('cart.for_me_section'))}:{' '}
                  </Text>
                  {g.lines.map((l) => (l.qty > 1 ? `${l.name} ×${l.qty}` : l.name)).join('، ')}
                </Text>
              </View>
            ))}
            {etaMax !== null && restaurant?.etaMinMinutes != null && !scheduledFor ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }} testID="checkout-eta">
                <Icon name="clock" size={16} color="liveText" />
                <Text variant="footnote" color="liveText" weight={600} tabular>
                  {t('checkout.eta_clock', { time: formatClock(etaClockAt(new Date(), etaMax), { locale }), range: formatMinutesRange(restaurant.etaMinMinutes, etaMax, { locale }) })}
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
                    {t(promiseCopy(orderQuote.data.latePromise.basis).line, { minutes: orderQuote.data.latePromise.afterMin })}
                  </Text>
                  <Text variant="caption" color="textMuted">
                    {t(promiseCopy(orderQuote.data.latePromise.basis).checkoutHint, { amount: amountParam(orderQuote.data.latePromise.creditIqd) })}
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
            { value: 'street', label: t('checkout.pickup_street_save', { amount: amountParam(STREET_SAVING_IQD) }) },
          ]}
        />
        <Text variant="footnote" color="textMuted">
          {street ? t('checkout.pickup_street_hint', { amount: amountParam(STREET_SAVING_IQD) }) : t('checkout.pickup_door_hint')}
        </Text>
      </Section>

      <Section title={recipientId !== 'me' ? t('checkout.payer_title') : t('checkout.payment')}>
        {recipientId !== 'me' ? (
          // o12: ordering for someone else — who pays, in the two ways that exist (no new money rule).
          <View style={{ gap: theme.space[2] }} testID="checkout-payer">
            <ChipGroup
              items={[
                { id: 'them_cash', label: recipientName ? t('checkout.payer_them', { name: recipientName }) : t('checkout.payer_them_generic'), icon: 'cash' },
                { id: 'me_wallet', label: t('checkout.payer_me'), icon: 'wallet' },
              ]}
              value={[payerOf(payment)]}
              required
              onChange={(v) => choosePayer(v[0] === 'me_wallet' ? 'me_wallet' : 'them_cash')}
              accessibilityLabel={t('checkout.payer_title')}
            />
            {balance !== null && !walletRow.usable && walletRow.missingIqd > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
                  {t('checkout.payer_wallet_short', { missing: amountParam(walletRow.missingIqd) })}
                </Text>
                <Button size="sm" variant="secondary" icon="plus" label={t('checkout.wallet_topup')} onPress={() => router.push('/topup')} testID="checkout-wallet-topup" />
              </View>
            ) : null}
            {recipientName ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <Icon name="phone" size={16} color="textMuted" />
                <Text variant="footnote" color="textMuted" style={{ flex: 1 }} testID="checkout-receiver-hint">
                  {t(receiverHint(recipientName, payment).key, receiverHint(recipientName, payment).params)}
                </Text>
              </View>
            ) : null}
            <GiftChoice name={recipientName} payment={payment} value={gift} onChange={setGift} />
          </View>
        ) : (
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
              selected={payment === 'wallet' && !fromHome}
              onPress={
                walletRow.usable
                  ? () => {
                      setFromHome(false);
                      setPayment('wallet');
                    }
                  : undefined
              }
              chevron={false}
              divider={home !== null}
              trailing={
                payment === 'wallet' && !fromHome ? undefined : balance !== null && !walletRow.usable ? (
                  <Button size="sm" variant="secondary" icon="plus" label={t('checkout.wallet_topup')} onPress={() => router.push('/topup')} testID="checkout-wallet-topup" />
                ) : undefined
              }
            />
            {home ? (
              <ListRow
                testID="checkout-pay-household"
                leading="family"
                title={t('checkout.pay_household')}
                subtitle={[
                  homeBalance === null ? '…' : homeRow.usable || homeRow.missingIqd === 0 ? t('checkout.household_balance', { name: home.name, amount: amountParam(homeBalance) }) : t('checkout.household_short', { amount: amountParam(homeBalance) }),
                  asksPayer && homePayer ? t('checkout.household_ask', { payer: homePayer.name ?? t('household.role_payer') }) : null,
                ]
                  .filter(Boolean)
                  .join('\n')}
                selected={payment === 'wallet' && fromHome}
                onPress={
                  homeRow.usable
                    ? () => {
                        setFromHome(true);
                        setPayment('wallet');
                      }
                    : undefined
                }
                chevron={false}
              />
            ) : null}
          </Card>
        )}
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
                  trackColor={{ true: theme.colors.accent, false: theme.colors.borderStrong }}
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

      <Card elevation={0} padding={0}>
        <ChoiceRow testID="checkout-row-receiver" icon="user" label={t('checkout.row_receiver')} value={receiverValue} open={open.receiver} onPress={() => toggle('receiver')} divider />
        {open.receiver ? (
          <View style={{ gap: theme.space[2], paddingHorizontal: theme.space[4], paddingBottom: theme.space[4] }}>
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
          </View>
        ) : null}
        <ChoiceRow testID="checkout-row-when" icon="clock" label={t('checkout.row_when')} value={whenValue} open={open.when} onPress={() => toggle('when')} />
        {chosen?.dinner && scheduledFor && dinnerTime.data ? (
          <View testID="checkout-dinner-note" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2], paddingHorizontal: theme.space[4], paddingBottom: theme.space[3] }}>
            <Icon name="food" size={16} color="accentText" />
            <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
              {(() => {
                const l = dinnerLine(dinnerTime.data.lateByMin);
                return l.key === 'with' ? t('dinner.with', { place: dinnerTime.data.place.name, time: clock12(dinnerTime.data.arriveAt) }) : t('dinner.after', { minutes: formatMinuteCount(l.minutes, { locale }), time: clock12(dinnerTime.data.arriveAt) });
              })()}
            </Text>
          </View>
        ) : null}
        {open.when ? (
          <View style={{ gap: theme.space[2], paddingHorizontal: theme.space[4], paddingBottom: theme.space[4] }}>
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
              <>
                <SegmentedControl
                  accessibilityLabel={t('checkout.day')}
                  value={String(day)}
                  onChange={(v) => {
                    setDay(v === '1' ? 1 : 0);
                    setSlot(null);
                  }}
                  options={[
                    { value: '0', label: t('time.today') },
                    { value: '1', label: t('time.tomorrow') },
                  ]}
                />
                {slots.length > 0 ? (
                  <ChipGroup
                    items={slots.map((sl) => ({ id: String(sl.at.getTime()), ...(sl.dinner ? { icon: 'food' as const } : {}), label: sl.dinner ? t(dinnerTime.data?.lateByMin ? 'dinner.slot_after' : 'dinner.slot', { time: clock12(sl.at) }) : sl.iftar && iftar ? t('checkout.when_iftar', { time: clock12(iftar.iftarAt) }) : t('checkout.when_at', { time: clock12(sl.at) }) }))}
                    value={chosen ? [String(chosen.at.getTime())] : []}
                    required
                    onChange={(v) => setSlot(v[0] ?? null)}
                  />
                ) : (
                  <Text variant="footnote" color="textMuted" testID="checkout-no-slots">
                    {t('checkout.no_slots_day')}
                  </Text>
                )}
                {chosen?.iftar && iftar && timetable ? (
                  <Text testID="checkout-iftar-note" variant="footnote" color="textMuted">
                    {t('checkout.iftar_note', { minutes: formatMinuteCount(iftarLeadMinutes(iftar), { locale }), timetable: t(timetable === 'sunni' ? 'season.timetable_sunni' : 'season.timetable_shia') })}
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        ) : null}
      </Card>

      <View style={{ gap: theme.space[2] }}>
        {open.kitchenNote || kitchenNote ? (
          <TextField
            testID="checkout-note-kitchen"
            label={t('checkout.note_kitchen')}
            placeholder={t('checkout.note_kitchen_placeholder')}
            value={kitchenNote}
            onChangeText={setKitchenNote}
            maxLength={500}
            multiline
          />
        ) : (
          <NoteLink testID="checkout-add-note-kitchen" label={t('checkout.note_kitchen')} onPress={() => toggle('kitchenNote')} />
        )}
        {open.courierNote || courierNote ? (
          <TextField
            testID="checkout-note-courier"
            label={t('checkout.note_courier')}
            placeholder={t('checkout.note_courier_placeholder')}
            value={courierNote}
            onChangeText={setCourierNote}
            maxLength={300}
            multiline
          />
        ) : (
          <NoteLink testID="checkout-add-note-courier" label={t('checkout.note_courier')} onPress={() => toggle('courierNote')} />
        )}
      </View>
    </Screen>
  );
}

/** «يستلم: أنا · غيّر» — a choice already made, shown as one line until the person wants to change it (o9). */
function ChoiceRow({ icon, label, value, open, onPress, divider, testID }: { icon: 'user' | 'clock'; label: string; value: string; open: boolean; onPress: () => void; divider?: boolean; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={t('checkout.row_change_a11y', { what: label, value })}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        minHeight: 52,
        paddingHorizontal: theme.space[4],
        borderBottomWidth: divider && !open ? 1 : 0,
        borderBottomColor: theme.colors.border,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Icon name={icon} size={18} color="textMuted" />
      <Text variant="body" style={{ flex: 1 }} numberOfLines={1}>
        <Text variant="body" color="textMuted">
          {label}:{' '}
        </Text>
        <Text variant="body" weight={600}>
          {value}
        </Text>
      </Text>
      <Text variant="label" weight={600} color="accentText">
        {t('checkout.row_change')}
      </Text>
    </Pressable>
  );
}

/** «+ ملاحظة للمطبخ»: an optional field stays a link until it is wanted (form CRO, audit F-18). */
function NoteLink({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: 44, alignSelf: 'flex-start', opacity: pressed ? 0.7 : 1 })}>
      <Icon name="plus" size={16} color="accentText" strokeWidth={2.4} />
      <Text variant="label" weight={600} color="accentText">
        {label}
      </Text>
    </Pressable>
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
      {/* An even 2×2 of notes: four in a row do not fit at 360 px, and wrapping left 50,000 alone. */}
      <ChipGroup
        columns={2}
        accessibilityLabel={t('cashchange.pay_with_title')}
        items={options.map((n) => ({ id: `tender-${n}`, label: n === totalIqd ? `${t('unit.iqd', { amount: amountParam(n) })} ${t('cashchange.pay_with_exact')}` : t('unit.iqd', { amount: amountParam(n) }) }))}
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
