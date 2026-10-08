import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { doorOf, type MenuItem, type RestaurantCard } from '@driver/contracts';
import { formatRange } from '@driver/i18n';
import { Card, Chip, Icon, IconButton, RetryState, retryKindFor, SketchScene, Skeleton, StatusPill, Text, useLoadTimeout, useNetwork, useTheme } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { tasteStore, useTaste, withTaste } from '@/features/doors/taste';
import { roleOf } from '@/features/doors/tray';
import { cartMerchantOf, ME, type CartModifier } from '@/features/food/cart';
import { closedArt } from '@/features/food/closed-art';
import { DealBadges } from '@/features/food/DealBadge';
import { cartStore, useCartSelect } from '@/features/food/cart-store';
import { CartButton, LiveCartBar, LiveDishCard, LiveDrinkGrid, type MenuActions } from '@/features/food/menu-live';
import { WhatsLeft } from '@/features/food/WhatsLeft';
import { leftToday, onlyLeft, WHATS_LEFT_FROM } from '@/features/food/whats-left';
import { AfterMeal } from '@/features/doors/AfterMeal';
import { FoodArt, artOf, dishArt, motifForKitchen, type DishArt } from '@/features/food/FoodArt';
import { temperatureOf, type Temperature } from '@/features/food/food-art';
import { canQuickAdd, chosenModifiers, defaultSelection } from '@/features/food/modifiers';
import { FlyToCart, type FlyHandle, type Rect } from '@/features/food/FlyToCart';
import { ItemSheet } from '@/features/food/ItemSheet';
import { KitchenStory, PotBanner } from '@/features/food/KitchenHabits';
import { useMenu } from '@/features/food/queries';
import { useMyOrders } from '@/features/home/queries';
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
  // t1: the screen reads only whether this kitchen's bar shows; rows and the bar read their own numbers.
  const barVisible = useCartSelect((st) => st.cart.merchant?.id === id && st.cart.lines.length > 0);
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
  // o8: a heart on a kitchen the person has really ordered from (the home rail's favourite rule).
  const myOrders = useMyOrders();
  const favourite = Boolean(myOrders.data?.some((o) => o.merchantOrgId === id));
  // «شنو باقي اليوم؟»: once 4+ dishes are sold out today, the menu can show only what is left.
  const soldToday = useMemo(() => leftToday(categories), [categories]);
  const offerLeft = soldToday.soldOut >= WHATS_LEFT_FROM;
  const [onlyNow, setOnlyNow] = useState(false);
  const leftOnly = offerLeft && onlyNow;
  const shown = useMemo(() => (leftOnly ? onlyLeft(categories) : categories), [leftOnly, categories]);
  const popular = useMemo(() => {
    const byId = new Map(categories.flatMap((c) => c.items).map((i) => [i.id, i]));
    return (menu.data?.popular ?? []).map((pid) => byId.get(pid)).filter((i): i is MenuItem => i !== undefined && (!leftOnly || i.available));
  }, [menu.data, categories, leftOnly]);
  // b3: a drawing per dish, in menu order, never the same one twice in a row.
  const artById = useMemo(() => {
    const rows = categories.flatMap((c) => c.items.map((i) => ({ id: i.id, name: i.name, category: c.name })));
    const art = dishArt(rows);
    return new Map<string, DishArt>(rows.map((r, i) => [r.id, art[i]!]));
  }, [categories]);
  // h2: today's pot (when its dish is on this menu); h5: the owner's story, «معروف بـ» the most ordered dish.
  const potItem = useMemo(() => {
    const pid = menu.data?.pot?.itemId;
    return pid ? (categories.flatMap((c) => c.items).find((i) => i.id === pid) ?? null) : null;
  }, [menu.data, categories]);
  const story = menu.data?.story ?? null;
  const merchant = restaurant ? cartMerchantOf(restaurant) : null;
  const closed = restaurant ? !restaurant.open : false;
  // q2: the person's usual sugar and cardamom, filled into one-tap adds too.
  const taste = useTaste();
  // m5: «ساخن» / «بارد» only on a menu that has both (a kebab place's بيبسي needs no label), and only on
  // the fewer kind: a café marks its two cold drinks, not its ten hot ones.
  const temps = useMemo(() => {
    const m = new Map<string, Temperature>();
    for (const c of categories) for (const i of c.items) {
      const tp = temperatureOf(i.name, c.name);
      if (tp) m.set(i.id, tp);
    }
    const hot = [...m.values()].filter((v) => v === 'hot').length;
    const cold = m.size - hot;
    if (hot === 0 || cold === 0) return new Map<string, Temperature>();
    const mark: Temperature = cold <= hot ? 'cold' : 'hot';
    return new Map([...m].filter(([, v]) => v === mark));
  }, [categories]);
  // m1: a café or juice bar opens on its drinks as pictures.
  const drinkShop = restaurant ? doorOf(restaurant.tags) === 'cafe' || doorOf(restaurant.tags) === 'cold' : false;
  const gridItems = useMemo(() => {
    if (!drinkShop) return [];
    const all = categories.flatMap((c) => c.items).filter((i) => i.available);
    const first = popular.length >= 3 ? popular : all;
    return first.slice(0, 6);
  }, [drinkShop, categories, popular]);
  // s7: after a meal goes in, one quiet «وياها كنافة؟» when this same kitchen makes a sweet.
  const sweet = useMemo(() => {
    for (const c of categories) for (const i of c.items) if (roleOf(i, c.name) === 'sweet' && i.available && canQuickAdd(i)) return i;
    return null;
  }, [categories]);
  const mainIds = useMemo(() => new Set(categories.flatMap((c) => c.items.filter((i) => roleOf(i, c.name) === 'main').map((i) => i.id))), [categories]);
  const [afterMeal, setAfterMeal] = useState<MenuItem | null>(null);
  const offeredSweet = useRef(false);
  const maybeOfferSweet = (added: MenuItem) => {
    if (offeredSweet.current || !sweet || doorOf(restaurant?.tags ?? []) !== 'meal' || !mainIds.has(added.id)) return;
    if (cartStore.getSnapshot().cart.lines.some((l) => l.itemId === sweet.id)) return;
    offeredSweet.current = true;
    setAfterMeal(sweet);
  };
  const openedFromSearch = useRef(false);
  useEffect(() => {
    if (!itemParam || openedFromSearch.current || categories.length === 0) return;
    const found = categories.flatMap((c) => c.items).find((i) => i.id === itemParam);
    openedFromSearch.current = true;
    if (found) setOpen(found);
  }, [itemParam, categories]);

  const photoById = useMemo(() => new Map(categories.flatMap((c) => c.items).map((i) => [i.id, i.photoUrl])), [categories]);
  const land = () => {
    setLandings((n) => n + 1);
    theme.haptic('selection');
  };

  const onAdded = () => {
    if (open) maybeOfferSweet(open);
    setOpen(null);
    theme.haptic('light');
    // The living bar answers the add (o1, F-03): no toast over it; it announces the add to screen readers.
    land();
  };

  const quickAdd = (item: MenuItem, from: Rect | null, chosen?: CartModifier[]) => {
    if (!merchant) return;
    // A one-tap tea or coffee comes the way this person takes it (q2); a picked weight comes as picked (s1).
    const usual = withTaste(item, defaultSelection(item), taste).selection;
    const modifiers = chosen ?? chosenModifiers(item, usual);
    const res = cartStore.add(merchant, { itemId: item.id, name: item.name, basePriceIqd: item.priceIqd, modifiers, qty: 1, note: null, personId: ME });
    if (!res.ok) {
      // Another kitchen's cart: the sheet asks before starting a new one.
      setOpen(item);
      return;
    }
    theme.haptic('light');
    if (!chosen) tasteStore.learn(item, usual);
    maybeOfferSweet(item);
    if (from && flyRef.current) flyRef.current.fly(from, { ...(artById.get(item.id) ?? artOf(item)), photoUrl: item.photoUrl });
    else land();
  };

  const removeOne = (item: MenuItem) => {
    const line = [...cartStore.getSnapshot().cart.lines].reverse().find((l) => l.itemId === item.id);
    if (line) cartStore.setQty(line.key, line.qty - 1);
  };
  // Made once and always calling the latest handlers, so the memoised rows never redraw for a new prop.
  const latest = useRef({ quickAdd, removeOne });
  latest.current = { quickAdd, removeOne };
  const actions = useMemo<MenuActions>(
    () => ({
      open: (item) => setOpen(item),
      quickAdd: (item, from, chosen) => latest.current.quickAdd(item, from, chosen),
      removeOne: (item) => latest.current.removeOne(item),
    }),
    [],
  );

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
            {restaurant ? <FoodArt variant="hero" motif={motifForKitchen(restaurant.tags, restaurant.cuisine)} photoUrl={restaurant.photoUrl} /> : <Skeleton height={HERO_H + insets.top} radius={0} />}
            <View style={{ position: 'absolute', top: insets.top + theme.space[2], start: theme.space[4], end: theme.space[4], flexDirection: 'row', justifyContent: 'space-between' }}>
              <IconButton
                icon="arrow-back"
                variant="outline"
                accessibilityLabel={t('action.back')}
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
                testID="restaurant-back"
              />
              <View style={{ flex: 1 }} />
              {favourite ? (
                <View
                  testID="restaurant-favourite"
                  accessible
                  accessibilityLabel={t('restaurant.favourite')}
                  style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, marginEnd: theme.space[2] }}
                >
                  <Icon name="heart" size={20} color="danger" fillColor="danger" filled />
                </View>
              ) : null}
              <CartButton />
            </View>
          </View>
          <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingHorizontal: theme.space[5], marginTop: -40 }}>
            <Card elevation={2} padding={4} testID="restaurant-facts">
              {restaurant ? <Facts r={restaurant} knownFor={story ? null : (popular[0]?.name ?? null)} /> : <FactsSkeleton />}
            </Card>
            {story ? <KitchenStory story={story} knownFor={popular[0]?.name ?? null} /> : null}
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
            {shown.map((c, i) => (
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
                  <Text variant="footnote" color="textMuted" testID="restaurant-preorder">
                    {restaurant.opensAt ? t('restaurant.preorder_note', { time: restaurant.opensAt }) : t('restaurant.closed_browse')}
                  </Text>
                </View>
              </View>
            </Card>
          ) : null}
          {menu.data?.pot && potItem && restaurant ? (
            <PotBanner pot={menu.data.pot} item={potItem} art={artById.get(potItem.id)} restaurant={restaurant.name} merchantOrgId={restaurant.id} onOpen={() => setOpen(potItem)} />
          ) : null}
          {offerLeft ? (
            <WhatsLeft
              soldOut={soldToday.soldOut}
              left={soldToday.left}
              only={onlyNow}
              onChange={(only) => {
                sectionY.current = [];
                setActive(0);
                setOnlyNow(only);
              }}
            />
          ) : null}
          {gridItems.length > 0 ? (
            <LiveDrinkGrid
              merchantId={id}
              title={popular.length >= 3 ? t('restaurant.popular_title') : t('restaurant.top_drinks')}
              items={gridItems}
              art={(i) => artById.get(i.id)}
              actions={actions}
            />
          ) : popular.length > 0 ? (
            <View style={{ paddingTop: theme.space[5] }} testID="section-popular">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <Icon name="star" size={18} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
                <Text variant="title" accessibilityRole="header">
                  {t('restaurant.popular_title')}
                </Text>
              </View>
              {popular.map((item) => (
                <LiveDishCard key={`popular-${item.id}`} merchantId={id} item={item} art={artById.get(item.id)} temperature={temps.get(item.id) ?? null} actions={actions} />
              ))}
            </View>
          ) : null}
          {menu.isPending
            ? [0, 1, 2, 3].map((i) => <DishSkeleton key={i} />)
            : shown.map((c, i) => (
                <View key={c.id} onLayout={(e) => (sectionY.current[i] = e.nativeEvent.layout.y)} style={{ paddingTop: theme.space[5] }} testID={`section-${i}`}>
                  <Text variant="title" accessibilityRole="header">
                    {c.name}
                  </Text>
                  {c.items.map((item) => (
                    <LiveDishCard key={item.id} merchantId={id} item={item} art={artById.get(item.id)} temperature={temps.get(item.id) ?? null} actions={actions} />
                  ))}
                </View>
              ))}
        </View>
      </ScrollView>

      {barVisible ? (
        <View style={{ position: 'absolute', bottom: insets.bottom + theme.space[4], start: 0, end: 0, alignItems: 'center', paddingHorizontal: theme.space[5] }} pointerEvents="box-none">
          <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH - 40, gap: theme.space[2] }}>
            {afterMeal ? (
              <AfterMeal
                item={afterMeal}
                art={artById.get(afterMeal.id)}
                onAdd={() => {
                  quickAdd(afterMeal, null);
                  setAfterMeal(null);
                }}
                onDismiss={() => setAfterMeal(null)}
              />
            ) : null}
            <LiveCartBar artById={artById} photoById={photoById} bubbleRef={bubbleRef} pulseKey={landings} />
          </View>
        </View>
      ) : null}

      <FlyToCart ref={flyRef} targetRef={bubbleRef} onLanded={land} />

      {open && merchant ? <ItemSheet item={open} merchant={merchant} followable={(menu.data?.potDishes ?? []).includes(open.id)} onClose={() => setOpen(null)} onAdded={onAdded} /> : null}
    </View>
  );
}

/**
 * The facts card (m3): the name, then one line — what the kitchen is known for when the town's orders
 * say it, else its cuisine — the rating and the door time, and delivery and the minimum together on one
 * «التفاصيل» line instead of a row of chips. Deals and busy mode as before.
 */
function Facts({ r, knownFor }: { r: RestaurantCard; knownFor: string | null }) {
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
          <Text variant="footnote" color={knownFor ? 'accentText' : 'textMuted'} weight={knownFor ? 600 : 400} testID="restaurant-known-for">
            {knownFor ? t('restaurant.known_for', { dish: knownFor }) : r.cuisine}
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
      {/* m3: delivery and the minimum on one line (J-D6: the small-order fee still said up front). */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }} testID="restaurant-details">
        <Icon name="bike" size={16} color={r.deliveryFeeIqd === 0 ? 'successText' : 'textMuted'} />
        <Text variant="footnote" color="textMuted" tabular style={{ flex: 1 }}>
          <Text variant="footnote" weight={600} color={r.deliveryFeeIqd === 0 ? 'successText' : 'text'} testID="restaurant-fee">
            {fee}
          </Text>
          {' · '}
          <Text variant="footnote" color="textMuted" testID="restaurant-min">
            {r.minOrderIqd > 0 && (r.smallOrderFeeIqd ?? 0) > 0
              ? t('restaurant.small_order_note', { amount: amountParam(r.minOrderIqd), fee: amountParam(r.smallOrderFeeIqd ?? 0) })
              : t('restaurant.min_order', { amount: amountParam(r.minOrderIqd) })}
          </Text>
        </Text>
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

