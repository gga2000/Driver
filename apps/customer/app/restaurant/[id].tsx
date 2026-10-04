import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MenuItem, RestaurantCard } from '@driver/contracts';
import { Card, Chip, EmptyState, Icon, IconButton, Skeleton, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { cartMerchantOf, itemCount, itemsTotal, ME } from '@/features/food/cart';
import { CartBar } from '@/features/food/CartBar';
import { DealBadges } from '@/features/food/DealBadge';
import { cartStore, useCart } from '@/features/food/cart-store';
import { DishCard } from '@/features/food/DishCard';
import { FoodArt, motifForKitchen } from '@/features/food/FoodArt';
import { ItemSheet } from '@/features/food/ItemSheet';
import { useMenu } from '@/features/food/queries';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

const HERO_H = 210;

/** "30–40" kept left-to-right inside Arabic text. */
function range(min: number, max: number): string {
  return `⁦${min}–${max}⁩`;
}

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
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const menu = useMenu(id);
  const cart = useCart();
  const [open, setOpen] = useState<MenuItem | null>(null);
  const [active, setActive] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const barRef = useRef<ScrollView>(null);
  const sectionY = useRef<number[]>([]);
  const menuTop = useRef(0);

  const restaurant = menu.data?.restaurant;
  const categories = useMemo(() => menu.data?.categories ?? [], [menu.data]);
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

  const onAdded = (name: string) => {
    setOpen(null);
    toast.show({ message: t('restaurant.added', { name }), tone: 'success', icon: 'cart' });
  };

  const quickAdd = (item: MenuItem) => {
    if (!merchant) return;
    const res = cartStore.add(merchant, { itemId: item.id, name: item.name, basePriceIqd: item.priceIqd, modifiers: [], qty: 1, note: null, personId: ME });
    if (!res.ok) {
      // Another kitchen's cart: the sheet asks before starting a new one.
      setOpen(item);
      return;
    }
    theme.haptic('success');
    toast.show({ message: t('restaurant.added', { name: item.name }), tone: 'success', icon: 'cart' });
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

  if (menu.isError && !menu.data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <Stack.Screen options={{ headerShown: true, title: '' }} />
        <EmptyState icon="bag" title={t('restaurant.load_failed')} action={{ label: t('action.retry'), onPress: () => void menu.refetch() }} />
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
              <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center' }}>
                <Icon name="clock" size={20} color="warningText" />
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
                    <DishCard key={item.id} item={item} inCart={counts.get(item.id) ?? 0} disabled={closed} onOpen={() => setOpen(item)} onQuickAdd={() => quickAdd(item)} />
                  ))}
                </View>
              ))}
        </View>
      </ScrollView>

      {mine && cart.lines.length > 0 ? (
        <View style={{ position: 'absolute', bottom: insets.bottom + theme.space[4], start: 0, end: 0, alignItems: 'center', paddingHorizontal: theme.space[5] }} pointerEvents="box-none">
          <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH - 40 }}>
            <CartBar count={itemCount(cart)} totalIqd={itemsTotal(cart)} onPress={() => router.push('/cart')} />
          </View>
        </View>
      ) : null}

      {open && merchant ? <ItemSheet item={open} merchant={merchant} disabled={closed} onClose={() => setOpen(null)} onAdded={onAdded} /> : null}
    </View>
  );
}

function Facts({ r }: { r: RestaurantCard }) {
  const theme = useTheme();
  const t = useT();
  const fee = r.deliveryFeeIqd === null ? t('cart.pick_place') : r.deliveryFeeIqd <= 0 ? t('search.filter_free_delivery') : t('restaurant.delivery_fee', { amount: amountParam(r.deliveryFeeIqd) });
  const eta = r.etaMinMinutes !== null && r.etaMaxMinutes !== null ? t('restaurant.eta', { range: range(r.etaMinMinutes, r.etaMaxMinutes) }) : t('restaurant.prep_time', { minutes: range(r.prepMinMinutes, r.prepMaxMinutes) });
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
          <Icon name="star" size={16} color="accent" filled />
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
        <Fact icon="bag" label={t('restaurant.min_order', { amount: amountParam(r.minOrderIqd) })} testID="restaurant-min" />
      </View>
      {/* The restaurant's live deals; the best one is applied by the server at checkout. */}
      <DealBadges deals={r.deals ?? []} testID="restaurant-deals" />
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

