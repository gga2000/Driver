import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import type { LaunchService } from '@driver/contracts';
import { Button, Card, Icon, SearchField, StaleNote, Text, useLoadTimeout, useNow, useTheme } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { Screen } from '@/components/Screen';
import { RestaurantRow, RestaurantRowSkeleton } from '@/features/food/RestaurantRow';
import { ActiveOrderPill } from '@/features/home/ActiveOrderPill';
import { ComingSoonSheet } from '@/features/home/ComingSoonSheet';
import { homeContext } from '@/features/home/context';
import { nightHome } from '@/features/home/night';
import { HomeHeader } from '@/features/home/HomeHeader';
import { useActiveOrder, useBookedRide, usePicks, useRestaurants } from '@/features/home/queries';
import { BookedRideCard, DinnerCard } from '@/features/ride-habits/Cards';
import { useDinnerChance } from '@/features/ride-habits/queries';
import { bandTitleKey, bandWords, daypart, kitchenRank, orderForDaypart } from '@/features/home/daypart';
import { DaypartBand } from '@/features/home/DaypartBand';
import { useUsuals } from '@/features/home/habit-queries';
import { fridayAhead, usualNow } from '@/features/home/habits';
import { PotsStrip } from '@/features/home/PotsStrip';
import { FridayCard, UsualCard } from '@/features/home/UsualCard';
import { WelcomeHome } from '@/features/home/WelcomeHome';
import { RajaaCard } from '@/features/home/RajaaCard';
import { SeasonCard } from '@/features/season/SeasonCard';
import { ReorderCard } from '@/features/home/ReorderCard';
import { RestaurantRail } from '@/features/home/RestaurantRail';
import { ComingSoonStrip, ServicesRow, type ServiceId } from '@/features/home/ServicesRow';
import { CuisineCircles } from '@/features/home/CuisineCircles';
import { lastReorderable } from '@/features/orders/history';
import { REORDER_LAST_PARAM } from '@/features/shortcuts/shortcuts';
import { useMyPersonId, useOrderHistory } from '@/features/orders/queries';
import { useReorderFlow } from '@/features/orders/ReorderSheet';
import { useActiveBooking } from '@/features/rajaa/queries';
import { startRide } from '@/features/ride/WhereToBar';
import { popularTerms } from '@/features/search/logic';
import { appNow } from '@/lib/dev-clock';
import { useLocale, useT } from '@/lib/i18n';
import { profile, selectedPlace, useProfile } from '@/lib/profile';
import { useSeason } from '@/lib/use-season';

/** Restaurants listed on home before "شوف الكل". */
const HOME_LIST = 5;

/**
 * Home (spec §1, audit C-09): food-led and calm. A one-line header (greeting + deliver-to, bell),
 * the search bar (opens /search), ONE service grid (أكل، تكسي، تكتك، الرجعة; the coming-soon ones in
 * «جاي بالطريق» at the end), the contextual card (what is in progress — order, ride, booked الرجعة seat — else
 * ONE of "اطلبه مرة ثانية" for the last meal or the الرجعة board), then food: round dish pictures per cuisine and the kitchens open now — the
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
  const cards = homeContext({ active: Boolean(active.data), rajaaTrip: Boolean(rajaaTrip.data), reorder: Boolean(last), friday: Boolean(friday), usual: Boolean(usual) });

  const onService = (id: ServiceId) => {
    if (id === 'food') scrollRef.current?.scrollTo({ y: foodY.current, animated: true });
    else if (id === 'rajaa') router.push('/rajaa');
    else if (id === 'taxi' || id === 'tuktuk') startRide(id);
    else setSoon(id);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([restaurants.refetch(), active.refetch(), history.refetch(), usuals.refetch()]);
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
        <HomeHeader daypart={dp} quiet={quiet} />
        {/* No mic until voice search exists (audit C-01). */}
        <SearchField testID="home-search" placeholder={t('search.placeholder')} accessibilityLabel={t('search.a11y_open')} onPress={() => router.push('/search')} />
      </View>

      <ServicesRow onPress={onService} />

      {cards.includes('active') && active.data ? <ActiveOrderPill order={active.data} /> : null}
      {dinner.data ? <DinnerCard chance={dinner.data} now={now} testID="home-dinner" /> : null}
      {booked.data ? <BookedRideCard order={booked.data} now={now} /> : null}
      {cards.includes('rajaa_trip') || cards.includes('rajaa') ? <RajaaCard hour={dp.hour} /> : null}
      {cards.includes('friday') && friday ? <FridayCard ahead={friday} busy={reorder.busyOrderId === friday.usual.row.order.id} onBook={() => void reorder.start(friday.usual.row, { scheduledFor: friday.slot.at })} /> : null}
      {cards.includes('usual') && usual ? <UsualCard usual={usual} busy={reorder.busyOrderId === usual.row.order.id} onOrder={() => void reorder.start(usual.row)} /> : null}
      {cards.includes('reorder') && last ? <ReorderCard row={last} now={now} busy={reorder.busyOrderId === last.order.id} onReorder={() => void reorder.start(last)} /> : null}
      {/* J6, under what is in progress: Ramadan countdown, Eid greeting or a special Friday line; nothing on an ordinary day. */}
      <SeasonCard />

      {/* «العزيزية اليوم» (joy h2): what the town's kitchens cook today; hidden when none is open with one. */}
      <PotsStrip now={now} />

      {/* «وقت العزيزية»: real dishes for the hour from kitchens open now (hidden below two). */}
      {open.length > 0 ? <DaypartBand title={t(bandTitleKey(dp, quiet))} dishes={picks.data} /> : null}

      <View testID="home-food" onLayout={(e) => (foodY.current = e.nativeEvent.layout.y)} style={{ gap: theme.space[3] }}>
        <SectionHeader voice title={night.night ? t('home.rail_opening') : t('home.rail_open_now')} action={open.length > 0 ? { label: t('action.see_all'), onPress: () => router.push({ pathname: '/restaurants', params: { preset: 'open' } }) } : undefined} />
        {/* Offline: what's below is the last copy we had, and says so. */}
        <StaleNote updatedAt={restaurants.dataUpdatedAt} locale={locale} testID="home-stale" />
        {cuisines.length > 1 ? <CuisineCircles cuisines={cuisines} onPick={(c) => router.push({ pathname: '/search', params: { q: c } })} /> : null}
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
        ) : open.length === 0 && night.first ? (
          <Card elevation={0} padding={4} testID="home-night">
            <View style={{ gap: theme.space[3] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <Icon name="clock" size={20} color="accentText" />
                <Text variant="title" style={{ flex: 1 }}>
                  {t('home.night_title')}
                </Text>
              </View>
              <Text variant="body" color="textMuted">
                {t('home.night_first', { name: night.first.name, time: night.first.opensAt ?? '' })}
              </Text>
              <Button
                variant="secondary"
                label={t('home.night_menu')}
                onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: night.first!.id } })}
                testID="home-night-menu"
              />
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

      {/* «جاي بالطريق» (discovery §6): what isn't open yet, quiet at the end, after the food. */}
      <ComingSoonStrip onPress={onService} />

      <ComingSoonSheet service={soon} onClose={() => setSoon(null)} />
      {prof.welcomeHomeDue && !prof.welcomedHome ? (
        <WelcomeHome name={prof.name} zoneId={selectedPlace(prof)?.zoneId ?? null} kitchens={list} onDone={() => void profile.setWelcomedHome()} />
      ) : null}
      {reorder.sheet}
    </Screen>
  );
}
