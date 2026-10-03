import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SearchField, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { ActiveOrderPill } from '@/features/home/ActiveOrderPill';
import { CommunityDealCard } from '@/features/home/CommunityDealCard';
import { HomeHeader } from '@/features/home/HomeHeader';
import { useActiveOrder, useRestaurants } from '@/features/home/queries';
import { RajaaCard } from '@/features/home/RajaaCard';
import { RestaurantRail } from '@/features/home/RestaurantRail';
import { ServicesRow, type ServiceId } from '@/features/home/ServicesRow';
import { useT } from '@/lib/i18n';
import { useProfile } from '@/lib/profile';

/**
 * Home (spec §1): food-led feed. Header with the deliver-to picker, one search bar, the pinned
 * active order, the compact services row, الرجعة second, then food rails and a community deal.
 */
export default function Home() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const { name } = useProfile();
  const [query, setQuery] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const railsY = useRef(0);
  const active = useActiveOrder();
  const restaurants = useRestaurants();
  const [refreshing, setRefreshing] = useState(false);

  const list = restaurants.data;
  const rail = {
    loading: restaurants.isPending,
    error: restaurants.isError,
    onRetry: () => void restaurants.refetch(),
  };

  const onService = (id: ServiceId) => {
    if (id === 'food') scrollRef.current?.scrollTo({ y: railsY.current, animated: true });
    else if (id === 'rajaa') router.push('/rajaa');
    else toast.show({ message: t('shell.stub_title'), icon: 'clock' });
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
        <SearchField
          testID="home-search"
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          onVoice={() => toast.show({ message: t('shell.stub_title'), icon: 'mic' })}
          placeholder={t('search.placeholder')}
        />
      </View>

      {active.data ? <ActiveOrderPill order={active.data} /> : null}

      <ServicesRow onPress={onService} />

      <RajaaCard />

      <View onLayout={(e) => (railsY.current = e.nativeEvent.layout.y)} style={{ gap: theme.space[6] }}>
        <RestaurantRail testID="rail-favourites" title={t('home.rail_favourites')} restaurants={list?.filter((r) => r.favourite)} {...rail} />
        <RestaurantRail testID="rail-open" title={t('home.rail_open_now')} restaurants={list?.filter((r) => r.open)} {...rail} />
        <CommunityDealCard />
        <RestaurantRail testID="rail-deals" title={t('home.deals_today')} restaurants={list?.filter((r) => !!r.deal)} showDeal {...rail} />
      </View>
    </Screen>
  );
}
