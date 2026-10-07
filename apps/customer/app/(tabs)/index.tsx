import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { CatalogSearchDish, LaunchService } from '@driver/contracts';
import { agoText, Button, Card, Icon, MAX_CONTENT_WIDTH, SearchField, SkyBackdrop, Text, useLoadTimeout, useNetwork, useNow, useTheme } from '@driver/ui';
import { secondsSince } from '@driver/contracts/net-client';
import { SectionHeader } from '@/components/SectionHeader';
import { Screen } from '@/components/Screen';
import { cartMerchantOf, itemCount, itemsTotal, ME } from '@/features/food/cart';
import { cartStore, useCart } from '@/features/food/cart-store';
import { CartBar } from '@/features/food/CartBar';
import { artOf } from '@/features/food/FoodArt';
import { stackThumbs } from '@/features/food/fly';
import { FlyToCart, type FlyHandle } from '@/features/food/FlyToCart';
import { RestaurantRow, RestaurantRowSkeleton } from '@/features/food/RestaurantRow';
import { ActiveOrderPill } from '@/features/home/ActiveOrderPill';
import { CollapsedBar } from '@/features/home/CollapsedBar';
import { ComingSoonSheet } from '@/features/home/ComingSoonSheet';
import { homeContext } from '@/features/home/context';
import { nightHome } from '@/features/home/night';
import { NightTwinkle } from '@/features/home/NightTwinkle';
import { QUIET_PICTURE, QuietCard } from '@/features/home/QuietCard';
import { HomeHeader } from '@/features/home/HomeHeader';
import { useActiveOrder, useBookedRide, usePicks, useRestaurants } from '@/features/home/queries';
import { BookedRideCard, DinnerCard } from '@/features/ride-habits/Cards';
import { useDinnerChance } from '@/features/ride-habits/queries';
import { bandTitleKey, bandWords, daypart, kitchenRank, orderForDaypart } from '@/features/home/daypart';
import { DaypartBand, type BandBasket } from '@/features/home/DaypartBand';
import { useHomeIntro } from '@/features/home/intro';
import { useUsuals } from '@/features/home/habit-queries';
import { fridayAhead, usualNow } from '@/features/home/habits';
import { PotsStrip } from '@/features/home/PotsStrip';
import { FridayCard, UsualCard } from '@/features/home/UsualCard';
import { WelcomeHome } from '@/features/home/WelcomeHome';
import { RajaaCard } from '@/features/home/RajaaCard';
import { SeasonCard } from '@/features/season/SeasonCard';
import { SimpleHomeRedirect } from '@/features/simple/SimpleHome';
import { ReorderCard } from '@/features/home/ReorderCard';
import { RestaurantRail } from '@/features/home/RestaurantRail';
import { foodFact } from '@/features/home/service-facts';
import { ComingSoonStrip, ServicesRow, type ServiceId } from '@/features/home/ServicesRow';
import { CuisineCircles } from '@/features/home/CuisineCircles';
import { TeaPullScroll } from '@/features/home/TeaPull';
import { lastReorderable } from '@/features/orders/history';
import { REORDER_LAST_PARAM } from '@/features/shortcuts/shortcuts';
import { useMyPersonId, useOrderHistory } from '@/features/orders/queries';
import { useReorderFlow } from '@/features/orders/ReorderSheet';
import { PRIMARY_CORRIDOR } from '@/features/rajaa/logic';
import { useActiveBooking } from '@/features/rajaa/queries';
import { BaghdadModeCard } from '@/features/ride/BaghdadModeCard';
import { RideHomeCard } from '@/features/ride/RideHomeCard';
import { startRide } from '@/features/ride/WhereToBar';
import { popularTerms } from '@/features/search/logic';
import { appNow } from '@/lib/dev-clock';
import { useT } from '@/lib/i18n';
import { profile, selectedPlace, useProfile } from '@/lib/profile';
import { useSeason } from '@/lib/use-season';

/** Restaurants listed on home before "شوف الكل". */
const HOME_LIST = 5;

/**
 * Home (spec §1, audit C-09) in Date & Saffron (Ali, 2026-10-06; v3 artifact), food-led: the hour's sky
 * behind a header (where we deliver, the points chip, the hand-lettered greeting) and the floating
 * search (opens /search); the services as a bento (أكل، تكسي، تكتك، بغداد والكوت، الرجعة), each with a
 * live fact; what is in progress (order, ride, booked seat) else ONE of the usual/reorder cards; the
 * town's pots and the hour's dishes; «شنو بخاطرك؟» food types; the kitchens open now; and «جاي بالطريق»
 * at the end. Offline, one date-brown line says the page is the last copy. Guests browse it all (C-18).
 *
 * How it feels (step 2, Ali's Yes votes 2026-10-07): it builds itself in when the app opens; as it
 * scrolls the greeting fades and a slim bar with the search and the services slides down; the food
 * drawing floats; pulling down fills a glass of tea; the band's + adds a dish into a basket bar that
 * floats over the page.
 */
export default function Home() {
  const theme = useTheme();
  const t = useT();
  const [soon, setSoon] = useState<LaunchService | null>(null);
  const scrollRef = useRef<Animated.ScrollView>(null);
  const scrollY = useSharedValue(0);
  const foodY = useRef(0);
  // Where the search's bottom edge sits in the page: past it, the slim bar takes over.
  const [barAt, setBarAt] = useState(0);
  const [headH, setHeadH] = useState(0);
  const rise = useHomeIntro();
  const active = useActiveOrder();
  const restaurants = useRestaurants();
  const rajaaTrip = useActiveBooking();
  // Joy J7d: a ride booked for later (its own card), and «عشاك يوصل وياك» while a ride home is on.
  const booked = useBookedRide();
  const dinner = useDinnerChance(Boolean(active.data?.type === 'ride' || rajaaTrip.data));
  const history = useOrderHistory();
  const me = useMyPersonId();
  const reorder = useReorderFlow();
  const tick = useNow(true, 60_000);
  // The hour in town (joy h1). A dev build may shift it for screenshots (`?now=07:30`).
  const now = useMemo(() => appNow(tick), [tick]);
  const dp = useMemo(() => daypart(now), [now]);
  const quiet = useSeason().quiet;
  // h7: the welcome-home moment, once, right after setup.
  const prof = useProfile();
  const picks = usePicks(bandWords(dp));
  const [refreshing, setRefreshing] = useState(false);

  const list = restaurants.data;
  // Offline with nothing cached the query just waits: after 8 s the skeleton becomes the retry card.
  const [slow, restartSlow] = useLoadTimeout(restaurants.isPending);
  const loading = restaurants.isPending && !slow;
  const failed = restaurants.isError || slow;
  const retry = () => {
    restartSlow();
    void restaurants.refetch();
  };
  const net = useNetwork();
  // Open kitchens: the ones this person already ordered from first, then the ones that suit the hour.
  const open = useMemo(
    () => (list ?? []).filter((r) => r.open).sort((a, b) => Number(b.favourite) - Number(a.favourite) || kitchenRank(a.tags, dp.key) - kitchenRank(b.tags, dp.key)),
    [list, dp.key],
  );
  // f12: at night (no kitchen open) the chips come from every kitchen, and the first to open is named.
  const night = useMemo(() => nightHome(list ?? []), [list]);
  const cuisines = useMemo(() => orderForDaypart(popularTerms((open.length > 0 ? open : (list ?? [])).map((r) => r.cuisine), 8), dp.key), [open, list, dp.key]);
  const last = useMemo(() => lastReorderable(history.data ?? [], now, me), [history.data, now, me]);
  // Joy t1: «اطلب نفس الطلب» from the app icon lands here with `?reorder=last` — the reorder sheet opens once.
  const { reorder: reorderParam } = useLocalSearchParams<{ reorder?: string }>();
  const startedReorder = useRef(false);
  useEffect(() => {
    if (reorderParam !== REORDER_LAST_PARAM || !last || startedReorder.current) return;
    startedReorder.current = true;
    router.setParams({ reorder: undefined });
    void reorder.start(last);
  }, [reorderParam, last, reorder]);
  // Joy s3: the usual for this hour, and Thursday evening / Friday morning the Friday booking.
  const usuals = useUsuals();
  const usual = useMemo(() => usualNow(usuals.data ?? [], now), [usuals.data, now]);
  const friday = useMemo(
    () =>
      fridayAhead(usuals.data ?? [], now, (id) => {
        const k = (list ?? []).find((r) => r.id === id);
        return k ? { hours: k.hours ?? [], pauses: k.pauses ?? [] } : null;
      }),
    [usuals.data, now, list],
  );
  // The food tile's fact: kitchens open now, else when the first one opens; quiet when all are closed.
  const food = foodFact({ loading, openCount: open.length, firstOpensAt: night.first?.opensAt ?? null });
  const foodOff = !loading && !!list && open.length === 0;
  const cards = homeContext({ active: Boolean(active.data), rajaaTrip: Boolean(rajaaTrip.data), reorder: Boolean(last), friday: Boolean(friday), usual: Boolean(usual) });

  // The basket on home (Ali's Yes, "addfly"): the band's + drops a dish in and it flies to the bar.
  const cart = useCart();
  const flyRef = useRef<FlyHandle>(null);
  const bubbleRef = useRef<View>(null);
  const [landings, setLandings] = useState(0);
  const land = () => {
    setLandings((n) => n + 1);
    // The second tick of the double tick: the dish has landed.
    theme.haptic('selection');
  };
  const openDish = (d: CatalogSearchDish) => router.push({ pathname: '/restaurant/[id]', params: { id: d.restaurantId, item: d.id } });
  const basket: BandBasket = {
    countOf: (d) => (cart.merchant?.id === d.restaurantId ? cart.lines.filter((l) => l.itemId === d.id).reduce((n, l) => n + l.qty, 0) : 0),
    add: (d, from) => {
      const kitchen = (list ?? []).find((r) => r.id === d.restaurantId);
      // Another kitchen's basket (or a kitchen not in the list): its menu asks before starting a new one.
      const res = kitchen ? cartStore.add(cartMerchantOf(kitchen), { itemId: d.id, name: d.name, basePriceIqd: d.priceIqd, modifiers: [], qty: 1, note: null, personId: ME }) : null;
      if (!res?.ok) {
        openDish(d);
        return;
      }
      theme.haptic('light');
      if (from && flyRef.current) flyRef.current.fly(from, { ...artOf(d), photoUrl: d.photoUrl });
      else land();
    },
    remove: (d) => {
      const line = [...cart.lines].reverse().find((l) => l.itemId === d.id);
      if (line) cartStore.setQty(line.key, line.qty - 1);
    },
  };
  const thumbs = useMemo(() => stackThumbs(cart).map((l) => ({ ...artOf({ id: l.itemId, name: l.name }), photoUrl: null })), [cart]);
  const basketShown = cart.lines.length > 0;

  // The greeting fades and drifts as it scrolls away, slower than the page.
  const fade = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, Math.max(1, headH * 0.8)], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(scrollY.value, [0, Math.max(1, headH)], [0, headH * 0.35], Extrapolation.CLAMP) }],
  }));

  const onService = (id: ServiceId) => {
    // The food section lands just under the slim bar that takes over the top once the search scrolls away.
    if (id === 'food') scrollRef.current?.scrollTo({ y: Math.max(0, foodY.current - BAR_ROOM), animated: true });
    else if (id === 'trips' || id === 'rajaa') router.push({ pathname: '/rajaa', params: { corridor: PRIMARY_CORRIDOR, direction: id === 'trips' ? 'from_aziziyah' : 'to_aziziyah' } });
    else if (id === 'taxi' || id === 'tuktuk') startRide(id);
    else setSoon(id);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    // The full glass steams for a moment even when the answer comes back at once, so the pull reads.
    await Promise.allSettled([restaurants.refetch(), active.refetch(), history.refetch(), usuals.refetch(), picks.refetch(), theme.reduceMotion ? null : new Promise((r) => setTimeout(r, TEA_MIN_MS))]);
    setRefreshing(false);
  };

  return (
    <Screen testID="home" scroll={false} padded={false} backdrop={<SkyBackdrop hour={dp.hour} />}>
      {/* «الوضع البسيط» on: home hands over to /simple (ride idea v2). */}
      <SimpleHomeRedirect />
      <TeaPullScroll
        scrollRef={scrollRef}
        scrollY={scrollY}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
        contentStyle={{ paddingHorizontal: theme.space[5], paddingTop: theme.space[3], paddingBottom: theme.space[10] + (basketShown ? BASKET_ROOM : 0), gap: theme.space[6] }}
      >
        <View style={{ gap: theme.space[4] }} onLayout={(e) => setBarAt(e.nativeEvent.layout.y + e.nativeEvent.layout.height - theme.space[2])}>
          <Animated.View entering={rise(0)}>
            <Animated.View style={fade} onLayout={(e) => setHeadH(e.nativeEvent.layout.height)}>
              <HomeHeader daypart={dp} quiet={quiet} closed={night.night} />
            </Animated.View>
          </Animated.View>
          {/* Offline: one line says what's below is the last copy we had, and offers to try again. */}
          {!net.online && restaurants.dataUpdatedAt ? <OfflineLine updatedAt={restaurants.dataUpdatedAt} onRetry={retry} /> : null}
          {/* No mic until voice search exists (audit C-01). */}
          <Animated.View entering={rise(1)}>
            <SearchField testID="home-search" floating placeholder={t('search.placeholder')} accessibilityLabel={t('search.a11y_open')} onPress={() => router.push('/search')} />
          </Animated.View>
        </View>

        <Animated.View entering={rise(2)}>
          <ServicesRow onPress={onService} foodFact={food} foodOff={foodOff} scrollY={scrollY} />
        </Animated.View>

        {/* No place picked yet: where we deliver decides the fee and the time, so it comes first. */}
        {!selectedPlace(prof) ? (
          <Animated.View entering={rise(3)}>
            <QuietCard
              testID="home-place-needed"
              art="location"
              title={t('home.places_title')}
              body={t('home.place_body')}
              action={{ label: t('home.place_pick'), onPress: () => router.push('/places'), testID: 'home-place-needed-pick' }}
            />
          </Animated.View>
        ) : null}

        {cards.includes('active') && active.data ? (
          <Animated.View entering={rise(3)}>
            <ActiveOrderPill order={active.data} />
          </Animated.View>
        ) : null}
        {/* In Baghdad or Kut: the next car back to Aziziyah (ride idea n9); nothing anywhere else. */}
        <BaghdadModeCard testID="home-baghdad-mode" />
        {dinner.data ? <DinnerCard chance={dinner.data} now={now} testID="home-dinner" /> : null}
        {booked.data ? <BookedRideCard order={booked.data} now={now} /> : null}
        {/* «رجعني للبيت», or the way back from where the last ride went (ride ideas w3, a4): itself decides. */}
        <RideHomeCard />
        {cards.includes('rajaa_trip') ? <RajaaCard hour={dp.hour} /> : null}
        {cards.includes('friday') && friday ? <FridayCard ahead={friday} busy={reorder.busyOrderId === friday.usual.row.order.id} onBook={() => void reorder.start(friday.usual.row, { scheduledFor: friday.slot.at })} /> : null}
        {cards.includes('usual') && usual ? <UsualCard usual={usual} busy={reorder.busyOrderId === usual.row.order.id} onOrder={() => void reorder.start(usual.row)} /> : null}
        {cards.includes('reorder') && last ? (
          <Animated.View entering={rise(3)}>
            <ReorderCard row={last} now={now} busy={reorder.busyOrderId === last.order.id} onReorder={() => void reorder.start(last)} />
          </Animated.View>
        ) : null}
        {/* J6, under what is in progress: Ramadan countdown, Eid greeting or a special Friday line; nothing on an ordinary day. */}
        <SeasonCard />

        {/* «العزيزية اليوم» (joy h2): what the town's kitchens cook today; hidden when none is open with one. */}
        <PotsStrip now={now} />

        {/* «وقت العزيزية»: real dishes for the hour from kitchens open now (hidden below two). */}
        {open.length > 0 ? <DaypartBand title={t(bandTitleKey(dp, quiet))} dishes={picks.data} basket={basket} /> : null}

        <View testID="home-food" onLayout={(e) => (foodY.current = e.nativeEvent.layout.y)} style={{ gap: theme.space[6] }}>
          {/* «شنو بخاطرك؟»: food types as round dish pictures, each opens search for the word. */}
          {cuisines.length > 1 ? (
            <View style={{ gap: theme.space[3] }}>
              <SectionHeader big title={t('home.cravings')} />
              <CuisineCircles cuisines={cuisines} onPick={(c) => router.push({ pathname: '/search', params: { q: c } })} />
            </View>
          ) : null}
          <View style={{ gap: theme.space[3] }}>
            <SectionHeader big title={night.night ? t('home.rail_opening') : t('home.rail_open_now')} action={open.length > 0 ? { label: t('action.see_all'), onPress: () => router.push({ pathname: '/restaurants', params: { preset: 'open' } }) } : undefined} />
            {loading ? (
              <View accessibilityLabel={t('status.loading')} style={{ gap: theme.space[3] }}>
                <RestaurantRowSkeleton />
                <RestaurantRowSkeleton />
              </View>
            ) : failed && !list && !net.online ? (
              // No internet and nothing cached: the phone picture, and home loads itself when the net is back.
              <QuietCard
                testID="home-offline-empty"
                art="offline"
                title={t('home.offline_title')}
                body={t('home.offline_body')}
                action={{ label: t('action.retry'), variant: 'secondary', onPress: retry, testID: 'home-offline-empty-retry' }}
              />
            ) : failed && !list ? (
              <Card lift padding={4}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                  <Icon name="x" size={20} color="dangerText" />
                  <Text variant="label" style={{ flex: 1 }}>
                    {t('home.load_failed')}
                  </Text>
                  <Button size="sm" variant="secondary" label={t('action.retry')} onPress={retry} />
                </View>
              </Card>
            ) : open.length === 0 && night.first ? (
              <QuietCard
                testID="home-night"
                art="closed-night"
                overlay={<NightTwinkle size={QUIET_PICTURE} />}
                title={t('home.night_title')}
                body={t('home.night_first', { name: night.first.name, time: night.first.opensAt ?? '' })}
                action={{ label: t('home.night_menu'), onPress: () => router.push({ pathname: '/restaurant/[id]', params: { id: night.first!.id } }), testID: 'home-night-menu' }}
              />
            ) : open.length === 0 ? (
              <QuietCard
                testID="home-rail-empty"
                art="no-results"
                title={t('home.rail_empty')}
                action={{ label: t('action.see_all'), variant: 'secondary', onPress: () => router.push('/restaurants') }}
              />
            ) : (
              <View style={{ gap: theme.space[3] }} testID="rail-open">
                {open.slice(0, HOME_LIST).map((r) => (
                  <RestaurantRow key={r.id} r={r} testID={`restaurant-${r.id}`} />
                ))}
                {open.length > HOME_LIST ? <Button variant="ghost" label={t('action.see_all')} onPress={() => router.push({ pathname: '/restaurants', params: { preset: 'open' } })} /> : null}
              </View>
            )}
          </View>
        </View>

        {/* No promotions resolve yet (the API's NoPromotions): the deals rail appears once one does. */}
        {list?.some((r) => !!r.deal) ? (
          <RestaurantRail testID="rail-deals" title={t('home.deals_today')} restaurants={list.filter((r) => !!r.deal)} showDeal seeAll="deals" loading={false} error={false} onRetry={retry} />
        ) : null}

        {/* «جاي بالطريق» (discovery §6): what isn't open yet, quiet at the end, after the food. */}
        <ComingSoonStrip onPress={onService} />

      </TeaPullScroll>

      <CollapsedBar scrollY={scrollY} showAt={barAt} onService={onService} foodOff={foodOff} />

      {basketShown ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', bottom: theme.space[4], start: 0, end: 0, alignItems: 'center', paddingHorizontal: theme.space[5] }}>
          <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH - 40 }}>
            <CartBar count={itemCount(cart)} totalIqd={itemsTotal(cart)} thumbs={thumbs} bubbleRef={bubbleRef} pulseKey={landings} onPress={() => router.push('/cart')} />
          </View>
        </View>
      ) : null}
      <FlyToCart ref={flyRef} targetRef={bubbleRef} onLanded={land} />

      <ComingSoonSheet service={soon} onClose={() => setSoon(null)} />
      {prof.welcomeHomeDue && !prof.welcomedHome ? (
        <WelcomeHome name={prof.name} zoneId={selectedPlace(prof)?.zoneId ?? null} kitchens={list} onDone={() => void profile.setWelcomedHome()} />
      ) : null}
      {reorder.sheet}
    </Screen>
  );
}

/** The slim bar's height and a breath under it (`CollapsedBar`). */
const BAR_ROOM = 104;

/** The shortest a pull-to-refresh shows its steaming glass. */
const TEA_MIN_MS = 1100;

/** Room under the page for the floating basket bar (its height and the gap under it). */
const BASKET_ROOM = 58 + 16;

/**
 * Offline (Date & Saffron): one date-brown line at the top, «معروض من آخر مرة · قبل 7 دقايق», and
 * «جرّب هسة» to ask again. The ride tiles below go grey on their own.
 */
function OfflineLine({ updatedAt, onRetry }: { updatedAt: number; onRetry: () => void }) {
  const theme = useTheme();
  const t = useT();
  const now = useNow(true, 15_000);
  return (
    <View
      testID="home-offline"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], minHeight: theme.hitTarget, paddingStart: theme.space[3], paddingEnd: theme.space[1], borderRadius: theme.radius.lg, backgroundColor: theme.colors.inverse }}
    >
      <Icon name="wifi-off" size={18} color="onInverseCaution" strokeWidth={2} />
      <Text variant="footnote" weight={600} color="onInverse" numberOfLines={1} style={{ flex: 1 }}>
        {t('net.cached', { ago: agoText(secondsSince(updatedAt, now), t) })}
      </Text>
      <Pressable
        testID="home-offline-retry"
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => ({ minHeight: theme.hitTarget, justifyContent: 'center', paddingHorizontal: theme.space[3], opacity: pressed ? 0.7 : 1 })}
      >
        <Text variant="footnote" weight={700} color="onInverseAccent">
          {t('net.retry_now')}
        </Text>
      </Pressable>
    </View>
  );
}
