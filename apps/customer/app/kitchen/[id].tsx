import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { RestaurantCard } from '@driver/contracts';
import { formatRange } from '@driver/i18n';
import { Button, Card, CountdownRing, EmptyState, Icon, Skeleton, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { carryOver, cartMerchantOf } from '@/features/food/cart';
import { cartStore, useCartStore } from '@/features/food/cart-store';
import { FoodArt, motifForKitchen } from '@/features/food/FoodArt';
import { isKitchenAccepted, isKitchenRejection, useCancelOrder, useCatalogRestaurants, useDeliverTo, useKitchenAnswer } from '@/features/food/queries';
import { similarOpenRestaurants } from '@/features/food/similar';
import { PushAskCard, usePushAsk } from '@/features/notify/PrePrompt';
import { apiErrorMessage, useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

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
  const order = useKitchenAnswer(id);
  const { placed } = useCartStore();
  const cancel = useCancelOrder();
  const o = order.data;
  // Joy f1: the notification ask lives here, in the dead time before the kitchen answers — never over the map.
  const pushAsk = usePushAsk(o?.state === 'placed');
  const mineCart = placed?.orderId === id ? placed.cart : null;
  const name = mineCart?.merchant?.name ?? '';
  const items = mineCart ? mineCart.lines.map((l) => (l.qty > 1 ? `${l.name} ×${l.qty}` : l.name)).join('، ') : '';

  useEffect(() => {
    if (!o || !id) return;
    if (isKitchenAccepted(o)) {
      cartStore.settlePlaced(id);
      router.replace({ pathname: '/order/[id]', params: { id } });
    } else if (o.state === 'customer_cancelled' && placed?.orderId === id) {
      cartStore.replaceCart(placed.cart);
      cartStore.settlePlaced(id);
      router.replace('/cart');
    }
  }, [o, id, placed]);

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
          <Skeleton height={160} width={160} radius={80} />
          <Skeleton height={22} width="60%" />
        </View>
      </Screen>
    );
  }

  if (isKitchenRejection(o)) return <Rejected orderId={o.id} />;

  return (
    <Screen
      testID="kitchen"
      edges={['top', 'bottom']}
      contentStyle={{ flexGrow: 1 }}
      footer={
        o.state === 'placed' ? (
          <View style={{ gap: theme.space[1] }}>
            <Button testID="kitchen-cancel" variant="secondary" fullWidth label={t('kitchen.cancel')} loading={cancel.isPending} onPress={() => void onCancel()} />
            <Text variant="caption" color="textMuted" align="center">
              {t('kitchen.cancel_free')}
            </Text>
          </View>
        ) : null
      }
    >
      <View style={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: theme.space[5], paddingVertical: theme.space[6] }}>
        <WaitingMark startedAt={(o.merchantOfferedAt ?? o.placedAt).getTime()} />
        <View style={{ alignItems: 'center', gap: theme.space[2] }}>
          <StatusPill live tone="accent" label={t('order.status.placed')} />
          <Text variant="heading" align="center" testID="kitchen-title">
            {name ? t('kitchen.waiting_title', { name }) : t('order.status.placed')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('order.status.placed_hint')}
          </Text>
        </View>
        <Card elevation={0} tone="sunken" padding={3} style={{ alignSelf: 'stretch' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="wallet" size={18} color="text" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label" weight={600} tabular>
                {t('kitchen.total_cash', { amount: amountParam(o.totalIqd) })}
              </Text>
              {items ? (
                <Text variant="footnote" color="textMuted" numberOfLines={2}>
                  {items}
                </Text>
              ) : null}
            </View>
          </View>
        </Card>
        {pushAsk.visible ? <PushAskCard kind="food" busy={pushAsk.busy} onAllow={pushAsk.allow} onLater={pushAsk.later} /> : null}
      </View>
    </Screen>
  );
}

/** The accept ring with a gently bobbing bag inside: something is happening, calmly. */
function WaitingMark({ startedAt }: { startedAt: number }) {
  const theme = useTheme();
  const bob = useSharedValue(0);
  useEffect(() => {
    if (theme.reduceMotion) return;
    bob.value = withRepeat(withSequence(withTiming(-6, { duration: 700 }), withTiming(0, { duration: 700 })), -1);
  }, [bob, theme.reduceMotion]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));
  return (
    <View style={{ width: 168, height: 168, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute' }}>
        <CountdownRing mode="accept" startedAt={startedAt} durationMs={ACCEPT_MS} size={168} strokeWidth={8} />
      </View>
      <Animated.View style={[{ width: 92, height: 92, borderRadius: 46, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }, style]}>
        <Icon name="bag" size={44} color="accentText" strokeWidth={1.8} />
      </Animated.View>
    </View>
  );
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
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.warningTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bag" size={34} color="warningText" />
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
                        <Icon name="star" size={14} color="accent" filled />
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
