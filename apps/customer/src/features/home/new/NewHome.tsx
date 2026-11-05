import { router } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Icon, MAX_CONTENT_WIDTH, SearchField, Text, useNetwork, useNow, useTheme } from '@driver/ui';
import {
  CompactDish,
  DishPair,
  DishPairSkeleton,
  HomeChips,
  HomeMapCard,
  HomeMapCardSkeleton,
  HomePress,
  LiveBoard,
  LiveBoardSkeleton,
  OrderPanel,
  CalmPanel,
  PointsPill,
  RestaurantCard,
  RestaurantRowSkeleton,
  homeSize,
  type BoardService,
  type HomeDish,
} from '@driver/ui/home';
import type { Order } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Screen } from '@/components/Screen';
import { useWalletBalance } from '@/features/account/queries';
import { cartMerchantOf, itemCount, itemsTotal, ME } from '@/features/food/cart';
import { cartStore, useCart } from '@/features/food/cart-store';
import { CartBar } from '@/features/food/CartBar';
import { useCarts } from '@/features/food-carts/queries';
import { placeLabelKey } from '@/features/places/PlaceForm';
import { PRIMARY_CORRIDOR } from '@/features/rajaa/logic';
import { useBoard } from '@/features/rajaa/queries';
import { useNearestMinutes } from '@/features/ride/queries';
import { startRide } from '@/features/ride/WhereToBar';
import { liveEta } from '@/features/track/eta';
import { useTracking } from '@/features/track/queries';
import { appNow } from '@/lib/dev-clock';
import { useT } from '@/lib/i18n';
import { selectedPlace, useProfile } from '@/lib/profile';
import { useSignedIn } from '@/lib/session';
import { useSeason } from '@/lib/use-season';
import { bandTitleKey, bandWords, daypart, greetingKey } from '../daypart';
import { useUsuals } from '../habit-queries';
import { usualNow } from '../habits';
import { stageTitleKey, liveStage } from '../live-card';
import { mapBoxNight } from '../map-box';
import { pointsChip } from '../points-chip';
import { useActiveOrder, usePicks, useRestaurants } from '../queries';
import { useReorderFlow } from '@/features/orders/ReorderSheet';
import { TILE_PICTURES } from '../tile-pictures';
import { HomeTownMap } from './HomeTownMap';
import { boardDepartures, cashToHand, fastestDish, homeDishes, kitchenChips, kitchenMinutes, lateNotice, minutesTo, orderStage, personOf, usualOrder } from './logic';

const PICTURES = { food: TILE_PICTURES.food.source, taxi: TILE_PICTURES.taxi.source, tuktuk: TILE_PICTURES.tuktuk.source, intercity: TILE_PICTURES.intercity.source };
/** How many of the hour's dishes are asked for (two side by side, one compact during an order, the fastest on the panel). */
const PICKS = 4;
/** Room under the page for the floating basket bar. */
const BASKET_ROOM = 58 + 16;

/**
 * The new customer home (docs/specs/2026-11-01-home-redesign.md §12.2, step 4), built from the
 * `@driver/ui/home` pieces: header and search, the headline, the map card with its panel (the order
 * running, else the usual or the fastest dish), «شنو تحتاج؟», the hour's dishes and «مفتوح هسة».
 * Shown only when the new-home switch is on (`NEW_HOME`); the old home stays the default.
 */
export function NewHome() {
  const theme = useTheme();
  const t = useT();
  const net = useNetwork();
  const signedIn = useSignedIn();
  const prof = useProfile();
  const season = useSeason();
  const tick = useNow(true, 60_000);
  const now = useMemo(() => appNow(tick), [tick]);
  const dp = useMemo(() => daypart(now), [now]);
  const words = useMemo(() => bandWords(dp, null), [dp]);

  const restaurants = useRestaurants();
  const kitchens = useMemo(() => restaurants.data ?? [], [restaurants.data]);
  const open = useMemo(() => kitchens.filter((k) => k.open).sort((a, b) => Number(b.favourite) - Number(a.favourite)), [kitchens]);
  const picks = usePicks(words, PICKS);
  const dishes = useMemo(() => homeDishes(picks.data ?? [], kitchens), [picks.data, kitchens]);
  const active = useActiveOrder();
  const usuals = useUsuals();
  const usual = useMemo(() => {
    const u = usualNow(usuals.data ?? [], now);
    return u ? usualOrder(u, kitchens, dp.friday) : null;
  }, [usuals.data, now, kitchens, dp.friday]);
  const reorder = useReorderFlow();

  // The board's live facts.
  const place = selectedPlace(prof);
  const pin = place?.pin ?? null;
  const taxi = useNearestMinutes(net.online ? pin : null, 'taxi');
  const tuktuk = useNearestMinutes(net.online ? pin : null, 'tuktuk');
  const near = [taxi.minutes, tuktuk.minutes].filter((m): m is number => m !== null);
  const rideMinutes = near.length > 0 ? Math.min(...near) : null;
  const board = useBoard({ corridorId: PRIMARY_CORRIDOR, direction: 'from_aziziyah' }, { poll: false });
  const departures = useMemo(() => boardDepartures(board.data?.departures ?? [], now, t), [board.data, now, t]);
  const carts = useCarts(pin);
  const balance = useWalletBalance();
  const chip = pointsChip(signedIn, balance.data);

  const [mapAt, setMapAt] = useState<number | undefined>(undefined);
  const [kind, setKind] = useState<string | null>(null);
  const chips = useMemo(() => kitchenChips(open), [open]);
  const shown = useMemo(() => (kind ? open.filter((k) => k.cuisine === kind) : open).slice(0, 10), [open, kind]);

  // The basket: «ضيفه للسلة» drops a dish in; another kitchen's basket opens the dish to ask first.
  const cart = useCart();
  const openDish = useCallback((id: string) => {
    const d = (picks.data ?? []).find((p) => p.id === id);
    if (d) router.push({ pathname: '/restaurant/[id]', params: { id: d.restaurantId, item: d.id } });
  }, [picks.data]);
  const add = useCallback(
    (id: string) => {
      const d = (picks.data ?? []).find((p) => p.id === id);
      const k = d ? kitchens.find((r) => r.id === d.restaurantId) : undefined;
      if (!d || !k) return;
      const res = cartStore.add(cartMerchantOf(k), { itemId: d.id, name: d.name, basePriceIqd: d.priceIqd, modifiers: [], qty: 1, note: null, personId: ME });
      if (!res.ok) openDish(id);
    },
    [picks.data, kitchens, openDish],
  );
  const bubbleRef = useRef<View>(null);
  const basketShown = cart.lines.length > 0;

  const onBoard = (s: BoardService) => {
    if (s === 'food') router.push('/food');
    else if (s === 'ride') startRide('taxi');
    else if (s === 'gov') router.push({ pathname: '/rajaa', params: { corridor: PRIMARY_CORRIDOR, direction: 'from_aziziyah' } });
    else if (s === 'parcel') router.push('/parcel');
    else router.push('/food-carts');
  };

  const order = active.data ?? null;
  const loading = restaurants.isPending;
  const named = !!prof.name;
  const headline = order ? t('home.order_headline') : t(greetingKey(dp, { quiet: season.quiet, named }), named ? { name: prof.name! } : undefined);
  const placeText = place ? (place.title ?? t(placeLabelKey(place.label))) : t('home.deliver_to_none');
  const pair = dishes.slice(0, 2);
  const fastest = fastestDish(dishes);

  return (
    <Screen testID="home" scroll={false} padded={false}>
      <ScrollView
        contentContainerStyle={{ alignSelf: 'center', width: '100%', maxWidth: MAX_CONTENT_WIDTH, paddingHorizontal: theme.space[4], paddingTop: theme.space[3], paddingBottom: theme.space[10] + (basketShown ? BASKET_ROOM : 0), gap: theme.space[6] }}
      >
        {/* Header and search (search at the top, Ali 2026-11-05). */}
        <View style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Text variant="heading" face="display">
              {t('app.customer')}
            </Text>
            <HomePress
              testID="home-place"
              accessibilityLabel={`${t('checkout.deliver_to')} ${placeText}`}
              onPress={() => router.push('/places')}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space[1], minHeight: theme.hitTarget }}
            >
              <Text variant="label" color="textMuted" compact>
                {t('home.deliver_to_short')}
              </Text>
              <Text variant="label" weight={700} compact numberOfLines={1} style={{ flexShrink: 1 }}>
                {placeText}
              </Text>
              <Icon name="chevron-down" size={homeSize.iconChip} color="textMuted" />
            </HomePress>
            {chip ? <PointsPill points={chip.points} onPress={() => router.push('/(tabs)/wallet')} testID="home-points" /> : null}
          </View>
          <SearchField testID="home-search" floating placeholder={t('search.placeholder')} accessibilityLabel={t('search.a11y_open')} onPress={() => router.push('/search')} />
        </View>

        <View style={{ gap: theme.space[3] }}>
          <Text variant="heading" face="display" accessibilityRole="header">
            {headline}
          </Text>
          {loading ? (
            <HomeMapCardSkeleton mapHeight={order ? homeSize.mapOrder : homeSize.mapIdle} />
          ) : order ? (
            <OrderCard order={order} town={t('rajaa.city_aziziyah')} night={mapBoxNight(dp.hour)} offline={!net.online} />
          ) : (
            <HomeMapCard map={<HomeTownMap night={mapBoxNight(dp.hour)} onUpdated={setMapAt} />} town={t('rajaa.city_aziziyah')} updatedAt={mapAt} offline={!net.online} testID="home-map">
              {usual ? (
                <CalmPanel usual={usual} onReorder={() => { const u = usualNow(usuals.data ?? [], now); if (u) void reorder.start(u.row); }} testID="home-panel" />
              ) : fastest ? (
                <CalmPanel dish={fastest} onDish={openDish} testID="home-panel" />
              ) : null}
            </HomeMapCard>
          )}
        </View>

        <View style={{ gap: theme.space[3] }}>
          <Text variant="title" face="display" accessibilityRole="header">
            {t('home.board.title')}
          </Text>
          {loading ? (
            <LiveBoardSkeleton />
          ) : (
            <LiveBoard town={t('rajaa.city_aziziyah')} open={open.length} rideMinutes={rideMinutes} departures={departures} carts={carts.data?.open.length ?? 0} pictures={PICTURES} offline={!net.online} onPress={onBoard} testID="home-board" />
          )}
        </View>

        {picks.isPending ? (
          <DishPairSkeleton />
        ) : pair.length > 0 ? (
          <View style={{ gap: theme.space[3] }}>
            <Text variant="title" face="display" accessibilityRole="header">
              {t(bandTitleKey(dp, season.quiet))}
            </Text>
            {order || pair.length < 2 ? <CompactDish dish={pair[0]!} onAdd={add} testID="home-dish" /> : <DishPair dishes={pair as [HomeDish, HomeDish]} onAdd={add} testID="home-pair" />}
          </View>
        ) : null}

        <View style={{ gap: theme.space[3] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text variant="title" face="display" accessibilityRole="header">
              {t('home.rail_open_now')}
            </Text>
            <HomePress testID="home-all" accessibilityLabel={t('action.see_all')} onPress={() => router.push('/restaurants')} style={{ flexDirection: 'row', alignItems: 'center', gap: homeSize.gapHair, minHeight: theme.hitTarget }}>
              <Text variant="label" weight={600} color="accentText" compact>
                {t('action.see_all')}
              </Text>
              <Icon name="chevron-forward" size={homeSize.iconChip} color="accentText" />
            </HomePress>
          </View>
          {chips.length > 1 ? <HomeChips chips={chips} selected={kind} onSelect={setKind} testID="home-chips" /> : null}
          {loading ? (
            <RestaurantRowSkeleton />
          ) : shown.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -theme.space[4] }} contentContainerStyle={{ gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: homeSize.gapTight }}>
              {shown.map((k) => (
                <RestaurantCard
                  key={k.id}
                  id={k.id}
                  name={k.name}
                  rating={k.rating ?? 0}
                  minutes={kitchenMinutes(k)}
                  fee={k.deliveryFeeIqd}
                  {...(k.photoUrl ? { picture: { uri: k.photoUrl } } : {})}
                  onPress={(id) => router.push({ pathname: '/restaurant/[id]', params: { id } })}
                  testID={`home-rest-${k.id}`}
                />
              ))}
            </ScrollView>
          ) : (
            <Text variant="body" color="textMuted">
              {t('home.board.food_closed')}
            </Text>
          )}
        </View>
      </ScrollView>

      {basketShown ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', bottom: theme.space[4], start: 0, end: 0, alignItems: 'center', paddingHorizontal: theme.space[5] }}>
          <View style={{ width: '100%', maxWidth: MAX_CONTENT_WIDTH - 40 }}>
            <CartBar count={itemCount(cart)} totalIqd={itemsTotal(cart)} bubbleRef={bubbleRef} onPress={() => router.push('/cart')} />
          </View>
        </View>
      ) : null}
      {reorder.sheet}
    </Screen>
  );
}

/** The map card while an order runs: the tracker panel under the town with their order on it. */
function OrderCard({ order, town, night, offline }: { order: Order; town: string; night: boolean; offline: boolean }) {
  const t = useT();
  const track = useTracking(order.id);
  const now = useNow(true, 30_000);
  const [mapAt, setMapAt] = useState<number | undefined>(undefined);
  const v = track.data?.order.id === order.id ? track.data : null;
  const o = v?.order ?? order;
  const stage = orderStage(o);
  const eta = v ? (liveEta(v, null, new Date(now)) ?? v.promisedAt) : null;
  const from = v?.merchant?.name ?? t(o.type === 'ride' ? 'home.active_trip' : 'home.active_order');
  const title = t(stageTitleKey(liveStage(o)));
  const route = v?.merchant?.name ? { from: v.merchant.name, to: t('live_map.home') } : undefined;
  const open = () => router.push({ pathname: '/order/[id]', params: { id: o.id } });
  const late = lateNotice(v, t);
  const panel =
    stage === 'cancelled' ? (
      <OrderPanel from={from} title={title} stage="cancelled" notice={{ tone: 'ended', title: t(`order.status.${o.state}` as MessageKey) }} actions={{ primary: { label: t('home.panel.cancel_browse'), onPress: () => router.push('/restaurants') }, secondary: { label: t('home.panel.cancel_help'), onPress: () => router.push('/help') } }} testID="home-order" />
    ) : (
      <OrderPanel
        from={from}
        title={title}
        stage={stage}
        {...(minutesTo(eta, now) !== null ? { minutes: minutesTo(eta, now)! } : {})}
        {...(late ? { notice: late } : {})}
        offline={offline}
        {...(cashToHand(o) !== undefined ? { cash: cashToHand(o)! } : {})}
        {...(personOf(v, o) ? { person: personOf(v, o)! } : {})}
        onMessage={() => router.push({ pathname: '/chat/[orderId]', params: { orderId: o.id } })}
        testID="home-order"
      />
    );
  // The map opens the order's own screen (the live map with the courier, the receipt, help).
  return (
    <HomeMapCard map={<HomeTownMap night={night} onUpdated={setMapAt} onPress={open} />} town={town} updatedAt={mapAt} offline={offline} frozen={stage === 'cancelled'} {...(route ? { route } : {})} testID="home-map">
      {panel}
    </HomeMapCard>
  );
}
