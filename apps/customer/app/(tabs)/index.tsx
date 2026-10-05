import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import type { LaunchService } from '@driver/contracts';
import { Button, Card, Chip, Icon, SearchField, StaleNote, Text, useLoadTimeout, useNow, useTheme } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { Screen } from '@/components/Screen';
import { RestaurantRow, RestaurantRowSkeleton } from '@/features/food/RestaurantRow';
import { ActiveOrderPill } from '@/features/home/ActiveOrderPill';
import { ComingSoonSheet } from '@/features/home/ComingSoonSheet';
import { homeContext } from '@/features/home/context';
import { HomeHeader } from '@/features/home/HomeHeader';
import { useActiveOrder, useRestaurants } from '@/features/home/queries';
import { RajaaCard } from '@/features/home/RajaaCard';
import { ReorderCard } from '@/features/home/ReorderCard';
import { RestaurantRail } from '@/features/home/RestaurantRail';
import { ServicesRow, type ServiceId } from '@/features/home/ServicesRow';
import { lastReorderable } from '@/features/orders/history';
import { useMyPersonId, useOrderHistory } from '@/features/orders/queries';
import { useReorderFlow } from '@/features/orders/ReorderSheet';
import { useRajaaHome } from '@/features/rajaa/queries';
import { startRide } from '@/features/ride/WhereToBar';
import { popularTerms } from '@/features/search/logic';
import { useLocale, useT } from '@/lib/i18n';

/** Restaurants listed on home before "شوف الكل". */
const HOME_LIST = 5;

/**
 * Home (spec §1, audit C-09): food-led and calm. A one-line header (greeting + deliver-to, bell),
 * the search bar (opens /search), ONE service grid (أكل، تكسي، تكتك، الرجعة; the coming-soon ones in
 * a quiet strip), the contextual card (what is in progress — order, ride, booked الرجعة seat — else
 * ONE of "اطلبه مرة ثانية" for the last meal or the الرجعة board), then food: cuisine chips and the kitchens open now — the
 * first of them inside the first screen on a 360×740 phone. Guests browse it all (C-18).
 */
export default function Home() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const [soon, setSoon] = useState<LaunchService | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const foodY = useRef(0);
  const active = useActiveOrder();
  const restaurants = useRestaurants();
  const rajaa = useRajaaHome();
  const history = useOrderHistory();
  const me = useMyPersonId();
  const reorder = useReorderFlow();
  const tick = useNow(true, 60_000);
  const now = useMemo(() => new Date(tick), [tick]);
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
  // Open kitchens, the ones this person already ordered from first.
  const open = useMemo(() => (list ?? []).filter((r) => r.open).sort((a, b) => Number(b.favourite) - Number(a.favourite)), [list]);
  const cuisines = useMemo(() => popularTerms(open.map((r) => r.cuisine), 8), [open]);
  const last = useMemo(() => lastReorderable(history.data ?? [], now, me), [history.data, now, me]);
  const cards = homeContext({ active: Boolean(active.data), rajaaTrip: Boolean(rajaa.trip), reorder: Boolean(last) });

  const onService = (id: ServiceId) => {
    if (id === 'food') scrollRef.current?.scrollTo({ y: foodY.current, animated: true });
    else if (id === 'rajaa') router.push('/rajaa');
    else if (id === 'taxi' || id === 'tuktuk') startRide(id);
    else setSoon(id);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([restaurants.refetch(), active.refetch(), history.refetch()]);
    setRefreshing(false);
  };

  return (
    <Screen
      scrollRef={scrollRef}
      testID="home"
      contentStyle={{ gap: theme.space[5] }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
    >
      <View style={{ gap: theme.space[3] }}>
        <HomeHeader />
        {/* No mic until voice search exists (audit C-01). */}
        <SearchField testID="home-search" placeholder={t('search.placeholder')} accessibilityLabel={t('search.a11y_open')} onPress={() => router.push('/search')} />
      </View>

      <ServicesRow onPress={onService} />

      {cards.includes('active') && active.data ? <ActiveOrderPill order={active.data} /> : null}
      {cards.includes('rajaa_trip') || cards.includes('rajaa') ? <RajaaCard /> : null}
      {cards.includes('reorder') && last ? <ReorderCard row={last} now={now} busy={reorder.busyOrderId === last.order.id} onReorder={() => void reorder.start(last)} /> : null}

      <View testID="home-food" onLayout={(e) => (foodY.current = e.nativeEvent.layout.y)} style={{ gap: theme.space[3] }}>
        <SectionHeader title={t('home.rail_open_now')} action={open.length > 0 ? { label: t('action.see_all'), onPress: () => router.push({ pathname: '/restaurants', params: { preset: 'open' } }) } : undefined} />
        {/* Offline: what's below is the last copy we had, and says so. */}
        <StaleNote updatedAt={restaurants.dataUpdatedAt} locale={locale} testID="home-stale" />
        {cuisines.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -theme.space[5] }}
            contentContainerStyle={{ paddingHorizontal: theme.space[5], gap: theme.space[2] }}
            testID="home-cuisines"
          >
            {cuisines.map((c) => (
              <Chip key={c} testID={`cuisine-${c}`} role="button" label={c} onPress={() => router.push({ pathname: '/search', params: { q: c } })} />
            ))}
          </ScrollView>
        ) : null}
        {loading ? (
          <View accessibilityLabel={t('status.loading')} style={{ gap: theme.space[3] }}>
            <RestaurantRowSkeleton />
            <RestaurantRowSkeleton />
          </View>
        ) : failed && !list ? (
          <Card elevation={0} padding={4}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <Icon name="x" size={20} color="dangerText" />
              <Text variant="label" style={{ flex: 1 }}>
                {t('home.load_failed')}
              </Text>
              <Button size="sm" variant="secondary" label={t('action.retry')} onPress={retry} />
            </View>
          </Card>
        ) : open.length === 0 ? (
          <Card elevation={0} tone="sunken" padding={4}>
            <View style={{ gap: theme.space[3], alignItems: 'center' }}>
              <Text variant="label" color="textMuted" align="center">
                {t('home.rail_empty')}
              </Text>
              <Button size="sm" variant="secondary" label={t('action.see_all')} onPress={() => router.push('/restaurants')} />
            </View>
          </Card>
        ) : (
          <View style={{ gap: theme.space[3] }} testID="rail-open">
            {open.slice(0, HOME_LIST).map((r) => (
              <RestaurantRow key={r.id} r={r} testID={`restaurant-${r.id}`} />
            ))}
            {open.length > HOME_LIST ? <Button variant="ghost" label={t('action.see_all')} onPress={() => router.push({ pathname: '/restaurants', params: { preset: 'open' } })} /> : null}
          </View>
        )}
      </View>

      {/* No promotions resolve yet (the API's NoPromotions): the deals rail appears once one does. */}
      {list?.some((r) => !!r.deal) ? (
        <RestaurantRail testID="rail-deals" title={t('home.deals_today')} restaurants={list.filter((r) => !!r.deal)} showDeal seeAll="deals" loading={false} error={false} onRetry={retry} />
      ) : null}

      <ComingSoonSheet service={soon} onClose={() => setSoon(null)} />
      {reorder.sheet}
    </Screen>
  );
}
