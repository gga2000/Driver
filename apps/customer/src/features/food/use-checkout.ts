import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNetwork } from '@driver/ui';
import { householdApproval } from '@driver/contracts';
import { cityDayDiff } from '@driver/i18n';
import { groupByPerson, reconcile } from '@/features/food/cart';
import { cartStore, useCartStore } from '@/features/food/cart-store';
import { afterFailure, attemptFor, attemptSignature, shouldReplay } from '@/features/food/place-attempt';
import { NEW_CUSTOMER_CAP_IQD, buildPlaceOrderInput, checkoutTotals, overNewCustomerCap, placeProblem, priorCashOrders, validTender, walletChoice, type Recipient } from '@/features/food/checkout';
import { useHousehold, useWalletBalance } from '@/features/account/queries';
import { payerOf as householdPayerOf } from '@/features/account/family';
import { firstOpenSlot, preorderSlots } from '@/features/food/slots';
import { dinnerStore, useDinnerPick } from '@/features/ride-habits/dinner-store';
import { withDinnerSlot } from '@/features/ride-habits/logic';
import { useDinnerTime } from '@/features/ride-habits/queries';
import { IFTAR_MIN_LEAD_MIN, timesFor, withIftarSlot } from '@/features/season/ramadan';
import { useTimetable } from '@/features/season/use-timetable';
import { useSeason } from '@/lib/use-season';
import { useCartQuote, useDeliverTo, useMenu, useOrderQuote, usePlaceOrder } from '@/features/food/queries';
import { useMyOrders } from '@/features/home/queries';
import { apiErrorCode, apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { normalizeIraqiPhone } from '@/lib/phone';
import { useProfile } from '@/lib/profile';
import { playCue } from '@/lib/sound';
import { cleanCard, giftInput } from '@/features/gift/gift';
import type { GiftChoiceValue } from '@/features/gift/GiftChoice';
import { giftStore } from '@/features/gift/gift-store';
import { priceChanges, type PriceChangeRow } from './checkout-slip';

/** What the calm sheet shows after the menu or the deal moved under the basket (c12). */
export interface PriceChange {
  rows: PriceChangeRow[];
  /** The total he saw before; the sheet shows it beside the server's new one. */
  oldTotalIqd: number | null;
  /** Which kind of move, for the sheet's one line. */
  reason: 'price' | 'deal';
}

/**
 * Checkout v2's state and actions (after-order design c1–c12), kept apart from the screens so both
 * steps share one set: what is typed on step 1 survives the slip and Android back.
 *
 * This is the same behaviour as today's `app/checkout.tsx` (which stays as the switched-off screen):
 * the same queries, the server's totals, the same idempotency key per basket (`place-attempt.ts`), the
 * same replay after a lost answer and the same answers to every place error. The one change is the
 * price/deal move (c12): instead of a red line it keeps the old and new figures for a calm sheet.
 */
export function useCheckout() {
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
  const [usePoints, setUsePoints] = useState(false);
  const quote = useCartQuote(cart, dropoff, street);
  const orderQuote = useOrderQuote(cart, dropoff, street, usePoints);
  const menu = useMenu(cart.merchant?.id);
  const mine = useMyOrders();
  const placeOrder = usePlaceOrder();
  const net = useNetwork();
  const wallet = useWalletBalance();
  const [payment, setPayment] = useState<'cash' | 'wallet'>('cash');
  const [fromHome, setFromHome] = useState(false);
  const household = useHousehold();
  const [tenderPick, setTenderPick] = useState<number | null>(null);

  const [recipientId, setRecipientId] = useState<string>('me');
  const [otherName, setOtherName] = useState('');
  const [otherPhone, setOtherPhone] = useState('');
  const [gift, setGift] = useState<GiftChoiceValue>({ on: false, hidePrices: true, card: '' });
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [day, setDay] = useState<0 | 1>(0);
  const hours = menu.data?.restaurant.hours;
  const pauses = menu.data?.restaurant.pauses;
  const baseSlots = useMemo(() => preorderSlots(new Date(), hours ?? [], day, { pauses: pauses ?? [] }), [hours, pauses, day]);
  const season = useSeason();
  const [timetable] = useTimetable();
  const iftar = timesFor(season.ramadan, timetable);
  const plainSlots = useMemo(() => (day === 0 ? withIftarSlot(baseSlots, iftar, new Date(), IFTAR_MIN_LEAD_MIN) : baseSlots.map((at) => ({ at, iftar: false }))), [baseSlots, iftar, day]);
  const dinnerPick = useDinnerPick();
  const dinnerOn = Boolean(dinnerPick && place && place.id === dinnerPick.placeId);
  const dinnerTime = useDinnerTime(dinnerOn && dinnerPick ? dinnerPick.source : null, cart.merchant?.id ?? null);
  const dinnerAt = dinnerTime.data?.deliverAt ?? null;
  const dinnerDay: 0 | 1 | null = dinnerAt ? (cityDayDiff(dinnerAt, new Date()) >= 1 ? 1 : 0) : null;
  const dinnerAtMs = dinnerAt?.getTime() ?? null;
  const slots = useMemo(() => withDinnerSlot(plainSlots, dinnerAtMs !== null && dinnerDay === day ? new Date(dinnerAtMs) : null, (at) => ({ at, iftar: false })), [plainSlots, dinnerAtMs, dinnerDay, day]);
  const [slot, setSlot] = useState<string | null>(null);
  // A closed kitchen starts on its first open slot.
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
  // The dinner time, once the server gives it, is the chosen one.
  const dinnerPreset = useRef<number | null>(null);
  useEffect(() => {
    if (dinnerAtMs === null || dinnerDay === null || dinnerPreset.current === dinnerAtMs) return;
    dinnerPreset.current = dinnerAtMs;
    setWhen('later');
    setDay(dinnerDay);
    setSlot(String(dinnerAtMs));
  }, [dinnerAtMs, dinnerDay]);
  const [problem, setProblem] = useState<string | null>(null);
  const [change, setChange] = useState<PriceChange | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string }>({});
  const [kitchenNote, setKitchenNote] = useState('');
  const [courierNote, setCourierNote] = useState('');
  const inFlight = useRef(false);
  const [replaying, setReplaying] = useState(false);

  const merchant = cart.merchant;
  const ready = Boolean(quote.data && (orderQuote.data || orderQuote.isError));
  const priced = ready && quote.data ? checkoutTotals(cart, quote.data, orderQuote.data, 'wallet') : null;
  const balance = wallet.data ? wallet.data.moneyIqd : null;
  const walletRow = walletChoice(balance, priced?.priceIqd ?? 0);
  const home = household.data && household.data.myRole !== 'member' ? household.data : null;
  const homeBalance = home && wallet.data?.household?.id === home.id ? wallet.data.household.balanceIqd : null;
  const homeRow = walletChoice(homeBalance, priced?.priceIqd ?? 0);
  const meInHome = home?.members.find((m) => m.isMe) ?? null;
  const homePayer = home ? householdPayerOf(home) : null;
  const asksPayer =
    home && meInHome && priced
      ? householdApproval({ role: meInHome.role, orderLimitIqd: meInHome.spendingLimitIqd, monthlyBudgetIqd: meInHome.monthlyBudgetIqd, monthSpentIqd: meInHome.monthSpentIqd ?? 0, totalIqd: priced.priceIqd }) !== null
      : false;
  // A wallet that no longer covers the order falls back to cash.
  useEffect(() => {
    if (payment !== 'wallet' || !priced) return;
    if (fromHome ? homeBalance !== null && !homeRow.usable : balance !== null && !walletRow.usable) setPayment('cash');
  }, [payment, priced, balance, walletRow.usable, fromHome, homeBalance, homeRow.usable]);

  const pointsOffer = orderQuote.data?.points ?? null;
  useEffect(() => {
    if (usePoints && orderQuote.data && !pointsOffer) setUsePoints(false);
  }, [usePoints, orderQuote.data, pointsOffer]);

  // After a lost answer, check the order by re-sending its key (never in a loop).
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

  const totals = ready && quote.data ? checkoutTotals(cart, quote.data, orderQuote.data, payment) : null;
  const tender = validTender(tenderPick, totals?.totalIqd ?? null, payment);
  const restaurant = menu.data?.restaurant;
  const chosen = slots.find((sl) => String(sl.at.getTime()) === slot) ?? slots[0] ?? null;
  const scheduledFor = when === 'later' ? (chosen?.at ?? null) : null;
  const { grouped, groups } = groupByPerson(cart);
  const priorCash = priorCashOrders(mine.data ?? []);
  const capHit = totals ? overNewCustomerCap(totals.totalIqd, priorCash, payment) : false;
  const closedNow = restaurant ? !restaurant.open && !scheduledFor : false;

  const savedOthers = cartState.people.filter((p) => p.phone && !cart.people.some((c) => c.id === p.id));
  const savedPick = recipientId.startsWith('saved:') ? (savedOthers.find((p) => `saved:${p.id}` === recipientId) ?? null) : null;
  const recipientName = recipientId === 'me' ? null : recipientId === 'other' ? otherName.trim() || null : savedPick ? savedPick.name : (cart.people.find((p) => p.id === recipientId)?.name ?? null);

  const lostAnswer = pending?.unknownSince != null && pending.signature === signature;
  const netBlocker =
    net.state === 'offline' || net.state === 'unreachable'
      ? lostAnswer
        ? t('checkout.lost_answer_offline')
        : net.state === 'offline'
          ? t('checkout.offline_blocked')
          : t('checkout.unreachable_blocked')
      : null;
  const blocker =
    netBlocker ??
    (!dropoff
      ? t('cart.pick_place')
      : closedNow && restaurant
        ? restaurant.closedReason === 'paused'
          ? t('restaurant.paused_until', { time: restaurant.opensAt ?? '' })
          : t('error.merchant_closed', { time: restaurant.opensAt ?? '' })
        : capHit
          ? t('checkout.cash_cap', { amount: amountParam(NEW_CUSTOMER_CAP_IQD) })
          : null);

  /** The receiver as the order takes it; marks the name/phone fields when they are missing. */
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
    if (!totals || !dropoff || blocker || inFlight.current || !merchant) return;
    const r = recipient();
    if (!r) return;
    setProblem(null);
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
      const person = r.kind === 'person' ? cart.people.find((p) => p.id === r.personId) : undefined;
      const receiver = r.kind === 'other' ? { name: r.name, phone: r.phone } : person?.phone ? { name: person.name, phone: person.phone } : null;
      cartStore.markPlaced(order.id, receiver);
      playCue('placed');
      if (order.gift && receiver) giftStore.remember(order.id, { ...receiver, card: cleanCard(gift.card), paidByMe: payment === 'wallet' });
      void queryClient.invalidateQueries({ queryKey: api.orders.mine.queryKey() });
      dinnerStore.clear();
      router.replace({ pathname: '/kitchen/[id]', params: { id: order.id } });
    } catch (err) {
      const errCode = apiErrorCode(err);
      const next = afterFailure(attempt, errCode);
      cartStore.setPending(next);
      if (next) {
        // The answer was lost: the order may exist. Never a second order: the key is kept.
        setProblem(null);
        return;
      }
      const kind = placeProblem(errCode);
      if (kind === 'deal_changed') {
        // c12: the deal moved; the sheet shows the old total beside the server's new one.
        const oldTotalIqd = totals.totalIqd;
        await Promise.all([orderQuote.refetch(), quote.refetch()]);
        setChange({ rows: [], oldTotalIqd, reason: 'deal' });
      } else if (kind === 'price_changed' || kind === 'catalog_item_unavailable' || kind === 'modifier_invalid') {
        try {
          const before = cart.lines;
          const oldTotalIqd = totals.totalIqd;
          const fresh = await queryClient.fetchQuery({ ...api.catalog.menu.queryOptions({ merchantId: merchant.id, dropoff }), staleTime: 0 });
          const res = reconcile(cart, fresh.categories);
          cartStore.replaceCart(res.cart);
          await Promise.all([quote.refetch(), orderQuote.refetch()]);
          const rows = priceChanges(before, res.cart.lines);
          // Nothing to show side by side (the menu already matched): today's plain line instead.
          if (rows.length > 0) setChange({ rows, oldTotalIqd, reason: 'price' });
          else setProblem(t('checkout.price_changed'));
        } catch {
          setProblem(t('error.price_changed'));
        }
      } else if (kind === 'new_customer_cash_cap') {
        setProblem(t('checkout.cash_cap', { amount: amountParam(NEW_CUSTOMER_CAP_IQD) }));
      } else if (kind === 'merchant_paused') {
        setProblem(t('checkout.paused'));
      } else if (kind === 'tender_invalid') {
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

  return {
    cart,
    merchant,
    myName,
    place,
    dropoff,
    restaurant,
    menu,
    quote,
    orderQuote,
    totals,
    placing: placeOrder.isPending,
    replaying,
    // where
    street,
    setStreet,
    // when
    when,
    setWhen,
    day,
    setDay,
    slots,
    slot,
    setSlot,
    chosen,
    scheduledFor,
    iftar,
    timetable,
    dinnerTime,
    // pay
    payment,
    setPayment,
    fromHome,
    setFromHome,
    balance,
    walletRow,
    home,
    homeBalance,
    homeRow,
    homePayer,
    asksPayer,
    pointsOffer,
    usePoints,
    setUsePoints,
    tender,
    setTenderPick,
    priorCash,
    // who
    recipientId,
    setRecipientId,
    otherName,
    setOtherName,
    otherPhone,
    setOtherPhone,
    fieldErrors,
    savedOthers,
    recipientName,
    gift,
    setGift,
    // notes
    kitchenNote,
    setKitchenNote,
    courierNote,
    setCourierNote,
    // basket
    grouped,
    groups,
    // place
    blocker,
    lostAnswer,
    problem,
    setProblem,
    change,
    clearChange: () => setChange(null),
    onPlace,
    /** Step 1's own check before the slip: the receiver's name and phone when it is someone new. */
    checkRecipient: () => recipient() !== null,
  };
}

export type CheckoutModel = ReturnType<typeof useCheckout>;
