import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MenuItem, RestaurantCard } from '@driver/contracts';
import { formatRange } from '@driver/i18n';
import { Card, Chip, Icon, IconButton, RetryState, retryKindFor, SketchScene, Skeleton, StatusPill, Text, useLoadTimeout, useNetwork, useTheme } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { cartMerchantOf, itemCount, itemsTotal, ME } from '@/features/food/cart';
import { CartBar } from '@/features/food/CartBar';
import { closedArt } from '@/features/food/closed-art';
import { DealBadges } from '@/features/food/DealBadge';
import { cartStore, useCart } from '@/features/food/cart-store';
import { DishCard } from '@/features/food/DishCard';
import { FoodArt, artOf, dishArt, motifForKitchen, type DishArt } from '@/features/food/FoodArt';
import { stackThumbs } from '@/features/food/fly';
import { FlyToCart, type FlyHandle, type Rect } from '@/features/food/FlyToCart';
import { ItemSheet } from '@/features/food/ItemSheet';
import { useMenu } from '@/features/food/queries';
import { useRememberViewed } from '@/features/search/viewed';
import { HeaderBack } from '@/features/food/HeaderBack';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

const HERO_H = 210;
/** Width of the night-market drawing in the closed card (joy J4). */
const NIGHT_THUMB = 88;

/**
 * Restaurant page (spec §3): hero (photo or illustrated placeholder), the card facts up front —
 * real ETA from prep + distance, delivery fee and minimum, rating with count — a sticky section bar,
 * dish cards with one-tap add, the item sheet, and the floating cart bar.
 */
export default function RestaurantScreen() {
  // `item`: a dish picked in search opens its sheet straight away (audit C-01).
  const { id, item: itemParam } = useLocalSearchParams<{ id: string; item?: string }>();
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const menu = useMenu(id);
  const locale = useLocale();
  const net = useNetwork();
  // Skeletons don't wait forever (C-17): after 8 s with no menu they turn into a retry.
  const [slow, restartSlow] = useLoadTimeout(menu.isPending);
  const cart = useCart();
  const [open, setOpen] = useState<MenuItem | null>(null);
  const [active, setActive] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const barRef = useRef<ScrollView>(null);
  const sectionY = useRef<number[]>([]);
  const menuTop = useRef(0);
  // o1: the cart bar's count bubble (where a dish lands), the one flight overlay, and the landing tick.
  const bubbleRef = useRef<View>(null);
  const flyRef = useRef<FlyHandle>(null);
  const [landings, setLandings] = useState(0);

  const restaurant = menu.data?.restaurant;
  // «فتحتها قبل» on the search start screen (D-24).
  useRememberViewed(restaurant?.id, restaurant?.name);
  const categories = useMemo(() => menu.data?.categories ?? [], [menu.data]);
  // b3: a drawing per dish, in menu order, never the same one twice in a row.
  const artById = useMemo(() => {
    const rows = categories.flatMap((c) => c.items.map((i) => ({ id: i.id, name: i.name, category: c.name })));
    const art = dishArt(rows);
    return new Map<string, DishArt>(rows.map((r, i) => [r.id, art[i]!]));
  }, [categories]);
  const merchant = restaurant ? cartMerchantOf(restaurant) : null;
  const mine = cart.merchant?.id === id;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    if (mine) for (const l of cart.lines) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty);
    return m;
  }, [cart, mine]);
  const closed = restaurant ? !restaurant.open : false;
  const openedFromSearch = useRef(false);
  useEffect(() => {
    if (!itemParam || openedFromSearch.current || categories.length === 0) return;
    const found = categories.flatMap((c) => c.items).find((i) => i.id === itemParam);
    openedFromSearch.current = true;
    if (found) setOpen(found);
  }, [itemParam, categories]);

  const photoById = useMemo(() => new Map(categories.flatMap((c) => c.items).map((i) => [i.id, i.photoUrl])), [categories]);
  const thumbs = useMemo(
    () => (mine ? stackThumbs(cart).map((l) => ({ ...(artById.get(l.itemId) ?? artOf({ id: l.itemId, name: l.name })), photoUrl: photoById.get(l.itemId) ?? null })) : []),
    [cart, mine, artById, photoById],
  );
  const barVisible = mine && cart.lines.length > 0;
  const land = () => {
    setLandings((n) => n + 1);
    theme.haptic('selection');
  };

  const onAdded = () => {
    setOpen(null);
    theme.haptic('light');
    // The living bar answers the add (o1, F-03): no toast over it; it announces the add to screen readers.
    land();
  };

  const quickAdd = (item: MenuItem, from: Rect | null) => {
    if (!merchant) return;
    const res = cartStore.add(merchant, { itemId: item.id, name: item.name, basePriceIqd: item.priceIqd, modifiers: [], qty: 1, note: null, personId: ME });
    if (!res.ok) {
      // Another kitchen's cart: the sheet asks before starting a new one.
      setOpen(item);
      return;
    }
    theme.haptic('light');
    if (from && flyRef.current) flyRef.current.fly(from, { ...(artById.get(item.id) ?? artOf(item)), photoUrl: item.photoUrl });
    else land();
  };

  const removeOne = (item: MenuItem) => {
    const line = [...cart.lines].reverse().find((l) => l.itemId === item.id);
    if (line) cartStore.setQty(line.key, line.qty - 1);
  };

  const jumpTo = (i: number) => {
    setActive(i);
    const y = sectionY.current[i];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: menuTop.current + y - 4, animated: true });
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y - menuTop.current + 60;
    let current = 0;
    sectionY.current.forEach((top, i) => {
      if (y >= top) current = i;
    });
    if (current !== active) {
      setActive(current);
      barRef.current?.scrollTo({ x: Math.max(0, current * 90 - 40), animated: true });
    }
  };

  if ((menu.isError || slow) && !menu.data) {
    const kind = retryKindFor({ net, error: menu.error, slow });
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }} testID="restaurant-error">
        <Stack.Screen options={{ headerShown: true, title: '', headerLeft: () => <HeaderBack /> }} />
        <RetryState
          kind={kind}
          locale={locale}
          art={kind === 'offline' || kind === 'unreachable' ? <SketchScene name="offline" /> : undefined}
          {...(kind === 'slow' ? { title: t('food.menu_slow') } : kind === 'server' ? { title: t('restaurant.load_failed') } : {})}
          onRetry={() => {
            restartSlow();
            void menu.refetch();
          }}
        />
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }} testID="restaurant">
      <Stack.Screen options={{ headerShown: false, title: restaurant?.name ?? '' }} />
      <ScrollView
        ref={scrollRef}
        stickyHeaderIndices={[1]}
        onScroll={onScroll}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* 0: hero + facts */}
        <View>
          <View style={{ height: HERO_H + insets.top }}>
            {restaurant ? <FoodArt variant="hero" motif={motifForKitchen(restaurant.tags)} photoUrl={restaurant.photoUrl} /> : <Skeleton height={HERO_H + insets.top} radius={0} />}
            <View style={{ position: 'absolute', top: insets.top + theme.space[2], start: theme.space[4], end: theme.space[4], flexDirection: 'row', justifyContent: 'space-between' }}>
              <IconButton
                icon="arrow-back"
                variant="outline"
                accessibilityLabel={t('action.back')}
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
                testID="restaurant-back"
              />
              {cart.lines.length > 0 ? <IconButton icon="cart" variant="outline" badge={itemCount(cart)} accessibilityLabel={t('cart.title')} onPress={() => router.push('/cart')} /> : null}
            </View>
          </View>
          <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingHorizontal: theme.space[5], marginTop: -40 }}>
            <Card elevation={2} padding={4} testID="restaurant-facts">
              {restaurant ? <Facts r={restaurant} /> : <FactsSkeleton />}
            </Card>
          </View>
        </View>

        {/* 1: sticky section bar */}
        <View style={{ backgroundColor: theme.colors.bg, paddingTop: theme.space[4], paddingBottom: theme.space[2] }}>
          <ScrollView
            ref={barRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: theme.space[5], gap: theme.space[2] }}
            accessibilityLabel={t('restaurant.menu_categories')}
            testID="category-bar"
          >
            {categories.map((c, i) => (
              <Chip key={c.id} testID={`category-${i}`} label={c.name} role="radio" selected={i === active} onPress={() => jumpTo(i)} />
            ))}
          </ScrollView>
        </View>

        {/* 2: menu */}
        <View
          onLayout={(e: LayoutChangeEvent) => (menuTop.current = e.nativeEvent.layout.y)}
          style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingHorizontal: theme.space[5] }}
        >
          {closed && restaurant ? (
            <Card elevation={0} tone="sunken" padding={3} style={{ marginTop: theme.space[2] }} testID="restaurant-closed">
              <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
                {/* Joy J4: closed at night shows the crescent over the market; by day or paused, the clock. */}
                {closedArt(restaurant.closedReason, new Date()) === 'clock' ? (
                  <Icon name="clock" size={20} color="warningText" />
                ) : (
                  <View style={{ width: NIGHT_THUMB }} testID="restaurant-closed-night">
                    <SketchScene name="night" />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text variant="label" weight={600}>
                    {restaurant.closedReason === 'paused'
                      ? t('restaurant.paused_until', { time: restaurant.opensAt ?? '' })
                      : t('error.merchant_closed', { time: restaurant.opensAt ?? '' })}
                  </Text>
                  <Text variant="footnote" color="textMuted">
                    {t('restaurant.closed_browse')}
                  </Text>
                </View>
              </View>
            </Card>
          ) : null}
          {menu.isPending
            ? [0, 1, 2, 3].map((i) => <DishSkeleton key={i} />)
            : categories.map((c, i) => (
                <View key={c.id} onLayout={(e) => (sectionY.current[i] = e.nativeEvent.layout.y)} style={{ paddingTop: theme.space[5] }} testID={`section-${i}`}>
                  <Text variant="title" accessibilityRole="header">
                    {c.name}
                  </Text>
                  {c.items.map((item) => (
                    <DishCard
                      key={item.id}
                      item={item}
                      art={artById.get(item.id)}
                      inCart={counts.get(item.id) ?? 0}
                      disabled={closed}
                      onOpen={() => setOpen(item)}
                      onQuickAdd={(from) => quickAdd(item, from)}
                      onDecrement={() => removeOne(item)}
                    />
                  ))}
                </View>
              ))}
        </View>
      </ScrollView>

      {barVisible ? (
        <View style={{ position: 'absolute', bottom: insets.bottom + theme.space[4], start: 0, end: 0, alignItems: 'center', paddingHorizontal: theme.space[5] }} pointerEvents="box-none">
          <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH - 40 }}>
            <CartBar count={itemCount(cart)} totalIqd={itemsTotal(cart)} thumbs={thumbs} bubbleRef={bubbleRef} pulseKey={landings} onPress={() => router.push('/cart')} />
          </View>
        </View>
      ) : null}

      <FlyToCart ref={flyRef} targetRef={bubbleRef} onLanded={land} />

      {open && merchant ? <ItemSheet item={open} merchant={merchant} disabled={closed} onClose={() => setOpen(null)} onAdded={onAdded} /> : null}
    </View>
  );
}

function Facts({ r }: { r: RestaurantCard }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const fee = r.deliveryFeeIqd === null ? t('cart.pick_place') : r.deliveryFeeIqd <= 0 ? t('search.filter_free_delivery') : t('restaurant.delivery_fee', { amount: amountParam(r.deliveryFeeIqd) });
  const eta = r.etaMinMinutes !== null && r.etaMaxMinutes !== null ? t('restaurant.eta', { range: formatRange(r.etaMinMinutes, r.etaMaxMinutes, locale) }) : t('restaurant.prep_time', { minutes: formatRange(r.prepMinMinutes, r.prepMaxMinutes, locale) });
  return (
    <View style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
        <View style={{ flex: 1 }}>
          <Text variant="heading" accessibilityRole="header" numberOfLines={2}>
            {r.name}
          </Text>
          <Text variant="footnote" color="textMuted">
            {r.cuisine}
          </Text>
        </View>
        <StatusPill size="sm" dot tone={r.open ? 'success' : 'neutral'} label={r.open ? t('restaurant.open') : t('restaurant.closed')} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="star" size={16} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
          <Text variant="label" weight={600} tabular>
            {r.rating ? t('restaurant.rating', { rating: r.rating.avg.toFixed(1), count: r.rating.count }) : t('restaurant.rating_new')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="clock" size={16} color="textMuted" />
          <Text variant="label" color="textMuted" tabular>
            {eta}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[2], flexWrap: 'wrap' }}>
        <Fact icon="bike" label={fee} highlight={r.deliveryFeeIqd === 0} testID="restaurant-fee" />
        {/* J-D6: below the minimum is a choice with the server's small-order fee, said up front. */}
        <Fact
          icon="bag"
          label={
            r.minOrderIqd > 0 && (r.smallOrderFeeIqd ?? 0) > 0
              ? t('restaurant.small_order_note', { amount: amountParam(r.minOrderIqd), fee: amountParam(r.smallOrderFeeIqd ?? 0) })
              : t('restaurant.min_order', { amount: amountParam(r.minOrderIqd) })
          }
          testID="restaurant-min"
        />
      </View>
      {/* The restaurant's live deals; the best one is applied by the server at checkout. */}
      <DealBadges deals={r.deals ?? []} testID="restaurant-deals" />
      {(r.deals?.length ?? 0) > 1 ? (
        <Text variant="footnote" color="textMuted" testID="restaurant-deals-one">
          {t('restaurant.deals_one_applies')}
        </Text>
      ) : null}
      {r.busy ? (
        <Text variant="footnote" color="warningText">
          {t('restaurant.busy')}
        </Text>
      ) : null}
    </View>
  );
}

function Fact({ icon, label, highlight, testID }: { icon: 'bike' | 'bag'; label: string; highlight?: boolean; testID?: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: theme.space[3],
        paddingVertical: 6,
        borderRadius: theme.radius.pill,
        backgroundColor: highlight ? theme.colors.successTint : theme.colors.surfaceSunken,
      }}
    >
      <Icon name={icon} size={16} color={highlight ? 'successText' : 'text'} />
      <Text variant="caption" weight={600} color={highlight ? 'successText' : 'text'} tabular>
        {label}
      </Text>
    </View>
  );
}

function FactsSkeleton() {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Skeleton height={26} width="60%" />
      <Skeleton height={14} width="40%" />
      <Skeleton height={14} width="80%" />
    </View>
  );
}

function DishSkeleton() {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[3], paddingVertical: theme.space[4] }}>
      <View style={{ flex: 1, gap: theme.space[2] }}>
        <Skeleton height={16} width="50%" />
        <Skeleton height={12} width="80%" />
        <Skeleton height={14} width="30%" />
      </View>
      <Skeleton height={96} width={96} radius={14} />
    </View>
  );
}

