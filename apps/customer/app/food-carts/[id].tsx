import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CartCard, CartDish } from '@driver/contracts';
import { formatHourPart, formatMinuteCount } from '@driver/i18n';
import { Icon, IconButton, RetryState, retryKindFor, Skeleton, Stepper, Text, useNetwork, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { cartStore } from '@/features/food/cart-store';
import { CartBell } from '@/features/food-carts/CartBell';
import { CartPhoto } from '@/features/food-carts/CartPhoto';
import { cartPalette } from '@/features/food-carts/palette';
import { useFoodCart, usePlaceWalkup } from '@/features/food-carts/queries';
import { cartStatus } from '@/features/food-carts/status';
import { useGrantedPosition } from '@/features/ride/phone-position';
import { requireSignIn } from '@/lib/guest';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { useSignedIn } from '@/lib/session';

type Way = 'walk' | 'delivery';
const HERO = 280;

/**
 * A cart's page (look A, Ali 2026-10-11): its photo, name, where it stands tonight and since when, how
 * long it takes, the menu with steppers, then «أجي آخذه» (a walk-over ticket: cash at the cart, a code to
 * show) or «يجيبه الدليفري» (the dishes go into the basket and the usual checkout). Walking is picked
 * first when the cart is close. A closed cart shows its menu and the bell, nothing to order.
 */
export default function FoodCartPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const here = useGrantedPosition();
  // No position (refused, failed): the cart page shows no walking minutes.
  const cart = useFoodCart(id ?? '', here.isError ? null : (here.data ?? null));
  const card = cart.data;

  if (cart.isError && !card) {
    return (
      <Screen testID="food-cart" edges={['top', 'bottom']}>
        <RetryState kind={retryKindFor({ net, error: cart.error })} locale={locale} {...(retryKindFor({ net, error: cart.error }) === 'server' ? { title: t('carts.load_error') } : {})} onRetry={() => void cart.refetch()} />
      </Screen>
    );
  }
  if (!card) {
    return (
      <Screen testID="food-cart-loading" edges={['top', 'bottom']}>
        <Skeleton height={HERO - 40} />
        <Skeleton height={32} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </Screen>
    );
  }
  return <CartPage card={card} />;
}

function CartPage({ card }: { card: CartCard }) {
  const theme = useTheme();
  const pal = cartPalette(theme);
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const signedIn = useSignedIn();
  const place = usePlaceWalkup();
  const [qty, setQty] = useState<Record<string, number>>({});
  const near = card.walkMin !== null && card.walkMin <= 15;
  const [way, setWay] = useState<Way>(card.delivery && !near ? 'delivery' : 'walk');
  const lines = useMemo(() => card.dishes.filter((d) => (qty[d.itemId] ?? 0) > 0).map((d) => ({ dish: d, qty: qty[d.itemId]! })), [card.dishes, qty]);
  const total = lines.reduce((s, l) => s + l.qty * l.dish.priceIqd, 0);
  const since = card.openedAt ? formatHourPart(card.openedAt, { locale }) : null;
  const where = card.spot?.label ?? null;

  const order = () => {
    if (lines.length === 0) return;
    if (way === 'delivery') {
      toBasket();
      return;
    }
    if (!signedIn) {
      void requireSignIn(`/food-carts/${card.id}`);
      return;
    }
    theme.haptic('medium');
    place.mutate(
      { cartId: card.id, lines: lines.map((l) => ({ itemId: l.dish.itemId, qty: l.qty })) },
      {
        onSuccess: (w) => router.replace({ pathname: '/food-carts/ticket/[id]', params: { id: w.id } }),
        onError: () => toast.show({ message: t('carts.order_failed'), tone: 'danger' }),
      },
    );
  };

  const toBasket = (replace = false) => {
    const merchant = { id: card.merchantOrgId, name: card.name, cityId: 'aziziyah', pickup: card.pickup, minOrderIqd: 0 };
    for (const [i, l] of lines.entries()) {
      const res = cartStore.add(merchant, { itemId: l.dish.itemId, name: l.dish.nameAr, basePriceIqd: l.dish.priceIqd, modifiers: [], qty: l.qty, note: null, personId: 'me' }, { replace: replace && i === 0 });
      if (!res.ok) {
        toast.show({ message: t('carts.basket_other', { name: res.current.name }), tone: 'warning', action: { label: t('carts.basket_replace'), onPress: () => toBasket(true) } });
        return;
      }
    }
    router.push('/cart');
  };

  return (
    <Screen
      testID="food-cart"
      padded={false}
      edges={['bottom']}
      footer={
        card.open ? (
          <OrderBar way={way} total={total} count={lines.length} busy={place.status === 'pending'} onPress={order} />
        ) : undefined
      }
    >
      {/* Hero: the cart's photo, fading into the page, with back and the bell over it. */}
      <View style={{ height: HERO, backgroundColor: theme.colors.surfaceSunken }}>
        <CartPhoto card={{ ...card, open: true }} size={HERO} wide />
        <View style={{ position: 'absolute', top: insets.top + theme.space[2], start: theme.space[4], end: theme.space[4], flexDirection: 'row', justifyContent: 'space-between' }}>
          <IconButton icon="arrow-back" variant="outline" size={44} accessibilityLabel={t('action.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/food-carts'))} testID="header-back" />
          <CartBell card={card} returnTo={`/food-carts/${card.id}`} testID="cart-page-bell" />
        </View>
      </View>

      <View style={{ paddingHorizontal: theme.space[5], marginTop: -theme.space[6], gap: theme.space[4] }}>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="display" face="display" accessibilityRole="header" style={{ textShadowColor: theme.colors.bg, textShadowRadius: 12 }}>
            {card.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Icon name="map-pin" size={18} color={pal.fill} />
            <Text variant="body" color="textMuted" style={{ flex: 1 }} tabular>
              {card.open
                ? where && since
                  ? t('carts.standing_since', { place: where, time: since })
                  : t('carts.open_now')
                : where
                  ? t('carts.last_here', { place: where })
                  : cartStatus(t, card, locale)}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            <InfoChip dot={card.open ? pal.fill : theme.colors.borderStrong} label={cartStatus(t, card, locale)} color={card.open ? pal.text : theme.colors.textMuted} />
            {card.open ? <InfoChip label={t('carts.ready_in', { min: formatMinuteCount(card.readyMin, { locale }) })} /> : null}
            {card.walkMin !== null ? <InfoChip walk label={t('carts.walk_min', { n: card.walkMin })} /> : null}
          </View>
        </View>

        <View testID="cart-menu">
          {card.dishes.map((d, i) => (
            <DishRow key={d.itemId} dish={d} first={i === 0} qty={qty[d.itemId] ?? 0} open={card.open} onQty={(n) => setQty((q) => ({ ...q, [d.itemId]: n }))} />
          ))}
        </View>

        {card.open ? (
          <View style={{ flexDirection: 'row', gap: theme.space[3] }} accessibilityRole="radiogroup">
            <WayCard testID="cart-way-walk" on={way === 'walk'} title={t('carts.way_walk')} body={t('carts.way_walk_body', { min: formatMinuteCount(card.readyMin, { locale }) })} glyph={<Icon name="walk" size={26} color={pal.text} />} onPress={() => setWay('walk')} />
            <WayCard
              testID="cart-way-delivery"
              on={way === 'delivery'}
              disabled={!card.delivery}
              title={t('carts.way_delivery')}
              body={t('carts.way_delivery_body')}
              glyph={<Icon name="bike" size={26} color={pal.text} />}
              onPress={() => setWay('delivery')}
            />
          </View>
        ) : (
          <Text variant="footnote" color="textMuted" testID="cart-closed-note">
            {t('carts.closed_follow_note', { name: card.name })}
          </Text>
        )}
        <View style={{ height: theme.space[4] }} />
      </View>
    </Screen>
  );
}

function InfoChip({ label, dot, color, walk }: { label: string; dot?: string; color?: string; walk?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 32, borderRadius: 16, backgroundColor: theme.colors.surfaceSunken }}>
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
      {walk ? <Icon name="walk" size={16} color={theme.colors.text} /> : null}
      <Text variant="footnote" weight={600} compact tabular color={color ?? 'text'}>
        {label}
      </Text>
    </View>
  );
}

function DishRow({ dish, qty, open, first, onQty }: { dish: CartDish; qty: number; open: boolean; first: boolean; onQty: (n: number) => void }) {
  const theme = useTheme();
  const t = useT();
  const off = !dish.available;
  return (
    <View
      testID={`cart-dish-${dish.itemId}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 72, paddingVertical: theme.space[3], borderTopWidth: first ? 1 : 0, borderBottomWidth: 1, borderColor: theme.colors.border }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyStrong" numberOfLines={2} color={off ? 'textMuted' : 'text'}>
          {dish.nameAr}
        </Text>
        <Text variant="footnote" color="textMuted" tabular>
          {off ? t('carts.dish_off') : t('carts.price', { amount: amountParam(dish.priceIqd) })}
        </Text>
      </View>
      {open && !off ? (
        qty === 0 ? (
          <IconButton icon="plus" variant="outline" size={44} accessibilityLabel={t('carts.add_a11y', { dish: dish.nameAr })} onPress={() => onQty(1)} testID="cart-dish-add" />
        ) : (
          <Stepper value={qty} onChange={onQty} min={0} max={20} size="sm" accessibilityLabel={dish.nameAr} />
        )
      ) : null}
    </View>
  );
}

function WayCard({ on, title, body, glyph, onPress, disabled, testID }: { on: boolean; title: string; body: string; glyph: React.ReactNode; onPress: () => void; disabled?: boolean; testID: string }) {
  const theme = useTheme();
  const pal = cartPalette(theme);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: on, disabled: !!disabled }}
      accessibilityLabel={`${title}، ${body}`}
      disabled={disabled}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={{
        flex: 1,
        minHeight: 132,
        padding: theme.space[4],
        gap: theme.space[1],
        borderRadius: theme.radius.xl,
        borderWidth: 2,
        borderColor: on ? pal.fill : theme.colors.border,
        backgroundColor: theme.colors.surface,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        {glyph}
        <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? pal.fill : 'transparent', borderWidth: on ? 0 : 2, borderColor: theme.colors.borderStrong }}>
          {on ? <Icon name="check" size={16} color={pal.on} /> : null}
        </View>
      </View>
      <Text variant="title" face="display">
        {title}
      </Text>
      <Text variant="footnote" color="textMuted">
        {body}
      </Text>
    </Pressable>
  );
}

function OrderBar({ way, total, count, busy, onPress }: { way: Way; total: number; count: number; busy: boolean; onPress: () => void }) {
  const theme = useTheme();
  const pal = cartPalette(theme);
  const t = useT();
  const empty = count === 0;
  const label = empty ? t('carts.pick_first') : way === 'walk' ? t('carts.order_walk', { amount: amountParam(total) }) : t('carts.order_delivery', { amount: amountParam(total) });
  return (
    <Pressable
      testID="cart-order"
      accessibilityRole="button"
      accessibilityState={{ disabled: empty || busy, busy }}
      disabled={empty || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 60,
        borderRadius: 30,
        paddingHorizontal: theme.space[5],
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: empty ? theme.colors.surfaceSunken : pal.fill,
        transform: [{ scale: pressed && !theme.reduceMotion ? 0.98 : 1 }],
      })}
    >
      <Text variant="title" face="display" tabular color={empty ? 'textMuted' : pal.on}>
        {label}
      </Text>
      {empty ? null : (
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: pal.on, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="arrow-forward" size={20} color={pal.fill} />
        </View>
      )}
    </Pressable>
  );
}
