import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { travelMinutes, type RestaurantCard } from '@driver/contracts';
import { formatClock, formatRange } from '@driver/i18n';
import { Button, Card, EmptyState, Icon, SketchScene, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { carryOver, cartMerchantOf } from '@/features/food/cart';
import { cartStore, useCartStore } from '@/features/food/cart-store';
import { FoodArt, motifForKitchen } from '@/features/food/FoodArt';
import { trackingMessage } from '@/features/food/checkout-lines';
import { ACCEPT_RING_MS, acceptFeedback, acceptedEta, answerIsSlow, linesByPerson, waitingSteps } from '@/features/food/kitchen-moment';
import { AcceptedCard, KitchenMark, PersonLinesCard, WaitingSteps } from '@/features/food/KitchenWait';
import { isKitchenAccepted, isKitchenRejection, useCancelOrder, useCatalogRestaurants, useDeliverTo, useKitchenAnswer } from '@/features/food/queries';
import { similarOpenRestaurants } from '@/features/food/similar';
import { whatsappUrl } from '@/features/help/whatsapp';
import { PushAskCard, usePushAsk } from '@/features/notify/PrePrompt';
import { shareUrl } from '@/features/rajaa/share';
import { apiErrorMessage, useApi, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useProfile } from '@/lib/profile';
import { playCue } from '@/lib/sound';
import { useSeason } from '@/lib/use-season';

/** The merchant's acceptance window (domain §2: 90 s, then the order auto-rejects). */
const ACCEPT_MS = 90_000;

/**
 * After "اطلب هسة" (spec §3): "finding your kitchen" until the merchant accepts — then the live
 * order screen — or, when the kitchen says no (or the 90 s run out), two similar open restaurants
 * with the cart carried over. Cancelling while waiting is free and puts the cart back.
 */
export default function KitchenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const today = useSeason();
  const order = useKitchenAnswer(id);
  const { placed } = useCartStore();
  const { name: myName } = useProfile();
  const { dropoff } = useDeliverTo();
  const cancel = useCancelOrder();
  const client = useApiClient();
  const [sending, setSending] = useState(false);
  const o = order.data;
  // Joy f1: the notification ask lives here, in the dead time before the kitchen answers — never over the map.
  const pushAsk = usePushAsk(o?.state === 'placed');
  const mineCart = placed?.orderId === id ? placed.cart : null;
  const name = mineCart?.merchant?.name ?? '';
  const groups = useMemo(() => (mineCart ? linesByPerson(mineCart) : []), [mineCart]);
  // o14: the yes plays only when this screen saw the order waiting (opened later, it just moves on).
  const sawWaiting = useRef(false);
  const [yes, setYes] = useState<{ time: string } | null>(null);
  const fade = useSharedValue(1);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const now = useNow(o?.state === 'placed' ? 5_000 : null);

  useEffect(() => {
    if (!o || !id) return;
    if (o.state === 'placed') sawWaiting.current = true;
    if (isKitchenAccepted(o)) {
      if (!sawWaiting.current) {
        cartStore.settlePlaced(id);
        router.replace({ pathname: '/order/[id]', params: { id } });
        return;
      }
      if (yes) return;
      const kitchen = mineCart?.merchant?.pickup?.pin ?? null;
      const door = dropoff?.pin ?? null;
      const eta = acceptedEta({ now: new Date(), promisedReadyAt: o.promisedReadyAt, rideMin: kitchen && door ? travelMinutes(kitchen, door, 'bike') : null });
      const feedback = acceptFeedback(today, theme.reduceMotion);
      setYes({ time: formatClock(eta, { locale }) });
      theme.haptic(feedback.haptic);
      if (feedback.cue) playCue(feedback.cue);
      const go = () => {
        cartStore.settlePlaced(id);
        router.replace({ pathname: '/order/[id]', params: { id } });
      };
      const lead = feedback.animate ? ACCEPT_RING_MS : 0;
      const timer = setTimeout(() => {
        if (!feedback.animate) {
          go();
          return;
        }
        fade.value = withTiming(0, { duration: theme.motion.duration.base }, (done) => {
          if (done) runOnJS(go)();
        });
      }, lead + feedback.holdMs);
      return () => clearTimeout(timer);
    } else if (o.state === 'customer_cancelled' && placed?.orderId === id) {
      cartStore.replaceCart(placed.cart);
      cartStore.settlePlaced(id);
      router.replace('/cart');
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the moment runs once per answer
  }, [o?.state, id]);

  // o12: send the person receiving it the live tracking link (the share page), typed into WhatsApp.
  const recipient = placed?.orderId === id ? (placed.recipient ?? null) : null;
  const sendTracking = async () => {
    if (!id || !recipient) return;
    setSending(true);
    try {
      const link = await client.tracking.createShareLink.mutate({ orderId: id });
      const msg = trackingMessage(name, shareUrl(link.path));
      await Linking.openURL(whatsappUrl(recipient.phone, t(msg.key, msg.params)));
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    } finally {
      setSending(false);
    }
  };

  const onCancel = async () => {
    if (!id) return;
    try {
      await cancel.mutateAsync({ orderId: id, reason: 'customer_changed_mind' });
      await order.refetch();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    }
  };

  if (!o) {
    return (
      <Screen testID="kitchen" edges={['top', 'bottom']}>
        <View style={{ alignItems: 'center', gap: theme.space[4], paddingTop: theme.space[16] }}>
          <Skeleton height={176} width={280} radius={24} />
          <Skeleton height={22} width="60%" />
        </View>
      </Screen>
    );
  }

  if (isKitchenRejection(o)) return <Rejected orderId={o.id} />;

  const offeredAt = o.merchantOfferedAt ?? o.placedAt;
  const waiting = o.state === 'placed';
  const slow = waiting && answerIsSlow(offeredAt, now);
  return (
    <Animated.View style={[{ flex: 1 }, fadeStyle]}>
      <Screen
        testID="kitchen"
        edges={['top', 'bottom']}
        contentStyle={{ flexGrow: 1 }}
        footer={
          waiting ? (
            <View style={{ gap: theme.space[1] }}>
              <Button testID="kitchen-cancel" variant="secondary" fullWidth label={t('kitchen.cancel')} loading={cancel.isPending} onPress={() => void onCancel()} />
              <Text variant="caption" color="textMuted" align="center">
                {t('kitchen.cancel_free')}
              </Text>
            </View>
          ) : null
        }
      >
        <View style={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: theme.space[5], paddingVertical: theme.space[4] }}>
          <KitchenMark startedAt={offeredAt.getTime()} acceptMs={ACCEPT_MS} accepted={Boolean(yes)} animate={!theme.reduceMotion} />
          {yes ? (
            <AcceptedCard name={name || t('order.status.placed')} time={yes.time} animate={!theme.reduceMotion} />
          ) : (
            <View style={{ alignItems: 'center', gap: theme.space[2] }}>
              <Text variant="heading" align="center" testID="kitchen-title">
                {name ? t('kitchen.sent_title', { name }) : t('order.status.placed')}
              </Text>
              <Text variant="body" color={slow ? 'warningText' : 'textMuted'} align="center" testID="kitchen-hint" accessibilityLiveRegion="polite">
                {slow ? t('kitchen.slow_hint') : t('kitchen.sent_hint')}
              </Text>
            </View>
          )}
          <WaitingSteps steps={waitingSteps(Boolean(yes) || !waiting)} />
          <PersonLinesCard groups={groups} myName={myName} totalLine={t('kitchen.total_cash', { amount: amountParam(o.totalIqd) })} />
          {recipient && !yes ? (
            <Card elevation={0} padding={3} style={{ alignSelf: 'stretch' }} testID="kitchen-send-tracking">
              <View style={{ gap: theme.space[2] }}>
                <Text variant="label" weight={600}>
                  {t('kitchen.whatsapp_title', { name: recipient.name })}
                </Text>
                <Text variant="footnote" color="textMuted">
                  {t('kitchen.whatsapp_body')}
                </Text>
                <Button size="sm" variant="secondary" icon="share" label={t('kitchen.whatsapp_send')} loading={sending} onPress={() => void sendTracking()} testID="kitchen-send-tracking-button" style={{ alignSelf: 'flex-start' }} />
              </View>
            </Card>
          ) : null}
          {pushAsk.visible && !yes ? <PushAskCard kind="food" busy={pushAsk.busy} onAllow={pushAsk.allow} onLater={pushAsk.later} /> : null}
        </View>
      </Screen>
    </Animated.View>
  );
}

/** A clock that ticks every `everyMs` while set (the 45 s "not answered yet" line). */
function useNow(everyMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (everyMs === null) return;
    const h = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(h);
  }, [everyMs]);
  return now;
}

/** The kitchen said no: nothing charged; two similar open kitchens, cart carried over on a tap. */
function Rejected({ orderId }: { orderId: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const api = useApi();
  const queryClient = useQueryClient();
  const { placed } = useCartStore();
  const { dropoff } = useDeliverTo();
  const list = useCatalogRestaurants({ openNow: true });
  const [moving, setMoving] = useState<string | null>(null);
  const cart = placed?.orderId === orderId ? placed.cart : null;
  const rejectedId = cart?.merchant?.id ?? '';
  const rejectedCard = list.data?.find((c) => c.id === rejectedId);
  const suggestions = list.data ? similarOpenRestaurants({ id: rejectedId, tags: rejectedCard?.tags ?? [] }, list.data) : [];

  const move = async (target: RestaurantCard) => {
    if (!cart) return;
    setMoving(target.id);
    try {
      const menu = await queryClient.fetchQuery(api.catalog.menu.queryOptions({ merchantId: target.id, ...(dropoff ? { dropoff } : {}) }));
      const res = carryOver(cart, cartMerchantOf(menu.restaurant), menu.categories);
      cartStore.settlePlaced(orderId);
      if (res.moved.length === 0) {
        toast.show({ message: t('kitchen.nothing_moved'), icon: 'bag' });
        router.replace({ pathname: '/restaurant/[id]', params: { id: target.id } });
        return;
      }
      cartStore.replaceCart(res.cart);
      const moved = t('kitchen.moved', { n: res.moved.length, name: target.name });
      toast.show({ message: res.dropped.length ? `${moved} · ${t('kitchen.dropped', { items: res.dropped.join('، ') })}` : moved, tone: 'success', icon: 'cart' });
      router.replace('/cart');
    } catch {
      toast.show({ message: t('error.network'), tone: 'danger' });
    } finally {
      setMoving(null);
    }
  };

  return (
    <Screen testID="kitchen-rejected" edges={['top', 'bottom']}>
      <View style={{ alignItems: 'center', gap: theme.space[2], paddingTop: theme.space[6] }}>
        <View style={{ width: '100%', maxWidth: 260, marginBottom: theme.space[2] }}>
          <SketchScene name="rejected" />
        </View>
        <Text variant="heading" align="center">
          {t('order.status.merchant_rejected')}
        </Text>
        <Text variant="body" color="textMuted" align="center">
          {t('order.status.merchant_rejected_hint')}
        </Text>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <Text variant="title">{t('kitchen.suggest_title')}</Text>
        {list.isPending ? (
          <Skeleton height={120} />
        ) : suggestions.length === 0 ? (
          <EmptyState icon="clock" title={t('kitchen.no_suggestions')} />
        ) : (
          suggestions.map((r) => (
            <Card key={r.id} padding={0} style={{ overflow: 'hidden' }} testID={`suggest-${r.id}`}>
              <View style={{ flexDirection: 'row' }}>
                <View style={{ width: 104 }}>
                  <FoodArt motif={motifForKitchen(r.tags)} photoUrl={r.photoUrl} />
                </View>
                <View style={{ flex: 1, padding: theme.space[3], gap: 4 }}>
                  <Text variant="bodyStrong">{r.name}</Text>
                  <Text variant="footnote" color="textMuted">
                    {r.cuisine}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                    {r.rating ? (
                      <>
                        <Icon name="star" size={14} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
                        <Text variant="caption" weight={600} tabular>
                          {r.rating.avg.toFixed(1)}
                        </Text>
                      </>
                    ) : null}
                    {r.etaMinMinutes !== null && r.etaMaxMinutes !== null ? (
                      <Text variant="caption" color="textMuted" tabular>
                        {t('restaurant.eta', { range: formatRange(r.etaMinMinutes, r.etaMaxMinutes, locale) })}
                      </Text>
                    ) : null}
                  </View>
                  <Button size="sm" label={t('kitchen.move_cart')} icon="cart" loading={moving === r.id} onPress={() => void move(r)} testID={`suggest-move-${r.id}`} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
                </View>
              </View>
            </Card>
          ))
        )}
      </View>

      <Button variant="ghost" style={{ alignSelf: 'center' }} label={t('shell.back_home')} onPress={() => (router.canDismiss() ? router.dismissAll() : router.replace('/'))} />
    </Screen>
  );
}
