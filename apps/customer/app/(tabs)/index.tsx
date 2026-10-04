import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import type { LaunchService } from '@driver/contracts';
import { SearchField, StaleNote, Text, useLoadTimeout, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { ActiveOrderPill } from '@/features/home/ActiveOrderPill';
import { ComingSoonSheet } from '@/features/home/ComingSoonSheet';
import { HomeHeader } from '@/features/home/HomeHeader';
import { useActiveOrder, useRestaurants } from '@/features/home/queries';
import { RajaaCard } from '@/features/home/RajaaCard';
import { RestaurantRail } from '@/features/home/RestaurantRail';
import { ServicesRow, type ServiceId } from '@/features/home/ServicesRow';
import { startRide, WhereToBar } from '@/features/ride/WhereToBar';
import { useLocale, useT } from '@/lib/i18n';
import { useProfile } from '@/lib/profile';

/**
 * Home (spec §1): food-led feed. Header with the deliver-to picker, one search bar (opens /search),
 * the pinned active order, the compact services row (coming-soon tiles open a "خبرني" sheet),
 * "وين رايح؟" (taxi / tuktuk), الرجعة second, then food rails, each with "شوف الكل" → /restaurants.
 * Guests browse it all (audit C-18). Favourites only from real orders; no sample deals (C-16).
 */
export default function Home() {
  const theme = useTheme();
  const t = useT();
  const { name } = useProfile();
  const [soon, setSoon] = useState<LaunchService | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const railsY = useRef(0);
  const active = useActiveOrder();
  const restaurants = useRestaurants();
  const [refreshing, setRefreshing] = useState(false);

  const locale = useLocale();
  const list = restaurants.data;
  // Offline with nothing cached the query just waits: after 8 s the skeleton becomes the retry card.
  const [slow, restartSlow] = useLoadTimeout(restaurants.isPending);
  const rail = {
    loading: restaurants.isPending && !slow,
    error: restaurants.isError || slow,
    onRetry: () => {
      restartSlow();
      void restaurants.refetch();
    },
  };

  const onService = (id: ServiceId) => {
    if (id === 'food') scrollRef.current?.scrollTo({ y: railsY.current, animated: true });
    else if (id === 'rajaa') router.push('/rajaa');
    else if (id === 'taxi') startRide('taxi');
    else setSoon(id);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([restaurants.refetch(), active.refetch()]);
    setRefreshing(false);
  };

  return (
    <Screen scrollRef={scrollRef} testID="home" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}>
      <View style={{ gap: theme.space[4] }}>
        <HomeHeader />
        <Text variant="heading" accessibilityRole="header">
          {name ? t('home.greeting', { name }) : t('home.greeting_anon')}
        </Text>
        {/* No mic until voice search exists (audit C-01). */}
        <SearchField testID="home-search" placeholder={t('search.placeholder')} accessibilityLabel={t('search.a11y_open')} onPress={() => router.push('/search')} />
      </View>

      {active.data ? <ActiveOrderPill order={active.data} /> : null}

      <ServicesRow onPress={onService} />

      <WhereToBar />

      <RajaaCard />

      <View onLayout={(e) => (railsY.current = e.nativeEvent.layout.y)} style={{ gap: theme.space[6] }}>
        {/* Offline: what's below is the last copy we had, and says so. */}
        <StaleNote updatedAt={restaurants.dataUpdatedAt} locale={locale} testID="home-stale" style={{ marginBottom: -theme.space[3] }} />
        {/* Only kitchens this person really ordered from: no rail at all for a new account or a guest. */}
        {list?.some((r) => r.favourite) ? (
          <RestaurantRail testID="rail-favourites" title={t('home.rail_favourites')} restaurants={list.filter((r) => r.favourite)} seeAll="all" {...rail} />
        ) : null}
        <RestaurantRail testID="rail-open" title={t('home.rail_open_now')} restaurants={list?.filter((r) => r.open)} seeAll="open" {...rail} />
        {/* No promotions resolve yet (the API's NoPromotions): the deals rail appears once one does. */}
        {!list || list.some((r) => !!r.deal) ? (
          <RestaurantRail testID="rail-deals" title={t('home.deals_today')} restaurants={list?.filter((r) => !!r.deal)} showDeal seeAll="deals" {...rail} />
        ) : null}
      </View>
      <ComingSoonSheet service={soon} onClose={() => setSoon(null)} />
    </Screen>
  );
}
