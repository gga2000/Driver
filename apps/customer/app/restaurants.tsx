import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import type { MessageKey } from '@driver/i18n';
import { Button, Card, Chip, EmptyState, Icon, SearchField, SegmentedControl, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { HeaderBack } from '@/features/food/HeaderBack';
import { activeFilterCount, applyList, cuisineOptions, hasFreeDelivery, hasRatings, type ListFilters, type ListSort } from '@/features/food/list';
import { RestaurantRow, RestaurantRowSkeleton } from '@/features/food/RestaurantRow';
import { useRestaurants } from '@/features/home/queries';
import { showTools } from '@/features/doors/doors';
import { DinnerBanner } from '@/features/ride-habits/Cards';
import { useT } from '@/lib/i18n';
import { countKey } from '@/lib/plural';

/** Rail presets "شوف الكل" opens with (`?preset=`). */
const PRESETS: Record<string, ListFilters> = { open: { openNow: true }, deals: { deals: true }, all: {} };

/**
 * كل المحلات (audit C-02): every shop in town, sorted (الأقرب، الأسرع، الأعلى تقييماً once ratings
 * exist) and filtered once more than 8 are open (food doors k6: a short list needs no tools) (مفتوح هسة، توصيل مجاني and عروض when some kitchen has them, cuisine). Closed
 * kitchens stay reachable in their own section with when they open. Public, like home.
 */
export default function Restaurants() {
  const theme = useTheme();
  const t = useT();
  const params = useLocalSearchParams<{ preset?: string }>();
  const restaurants = useRestaurants();
  const [sort, setSort] = useState<ListSort>('nearest');
  const [filters, setFilters] = useState<ListFilters>(() => PRESETS[params.preset ?? 'all'] ?? {});
  const [refreshing, setRefreshing] = useState(false);
  const list = useMemo(() => restaurants.data ?? [], [restaurants.data]);
  const out = useMemo(() => applyList(list, sort, filters), [list, sort, filters]);
  const cuisines = useMemo(() => cuisineOptions(list), [list]);
  const total = out.open.length + out.closed.length;
  // k6: sorting and filters only once there is a crowd to sort (more than 8 open); a short list is just read.
  const crowded = showTools(list.filter((r) => r.open).length);

  const sorts: { value: ListSort; label: string }[] = [
    { value: 'nearest', label: t('list.sort_nearest') },
    { value: 'fastest', label: t('list.sort_fastest') },
    ...(hasRatings(list) ? [{ value: 'rating' as const, label: t('list.sort_rating') }] : []),
  ];
  const toggle = (key: 'openNow' | 'freeDelivery' | 'deals') => setFilters((f) => ({ ...f, [key]: !f[key] }));
  const refresh = async () => {
    setRefreshing(true);
    await restaurants.refetch();
    setRefreshing(false);
  };

  return (
    <Screen testID="restaurants" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], marginStart: -theme.space[2] }}>
          <HeaderBack />
          <View style={{ flex: 1 }}>
            <Text variant="heading" accessibilityRole="header">
              {t('list.title')}
            </Text>
          </View>
          {restaurants.data && total > 0 ? (
            <Text variant="label" color="textMuted" tabular testID="restaurants-count">
              {t(countKey('list.count', total), { n: total })}
            </Text>
          ) : null}
        </View>
        <SearchField testID="restaurants-search" placeholder={t('search.placeholder')} onPress={() => router.push('/search')} accessibilityLabel={t('search.a11y_open')} />
        {/* Joy r6: choosing dinner for the ride home — checkout times it with the arrival. */}
        <DinnerBanner />
      </View>

      {crowded ? (
        <View style={{ gap: theme.space[3] }}>
          <SegmentedControl options={sorts} value={sort} onChange={setSort} accessibilityLabel={t('list.sort_label')} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginHorizontal: -theme.space[5] }}
          contentContainerStyle={{ paddingHorizontal: theme.space[5], paddingVertical: theme.space[1], gap: theme.space[2] }}
          testID="restaurants-filters"
        >
          <Chip testID="filter-open" icon="clock" label={t('list.filter_open')} selected={!!filters.openNow} onPress={() => toggle('openNow')} />
          {hasFreeDelivery(list) || filters.freeDelivery ? (
            <Chip testID="filter-free" icon="bike" label={t('list.filter_free')} selected={!!filters.freeDelivery} onPress={() => toggle('freeDelivery')} />
          ) : null}
          {list.some((r) => r.dealCount > 0) || filters.deals ? (
            <Chip testID="filter-deals" icon="gift" label={t('list.filter_deals')} selected={!!filters.deals} onPress={() => toggle('deals')} />
          ) : null}
          {cuisines.map((tag) => (
            <Chip
              key={tag}
              testID={`filter-cuisine-${tag}`}
              role="radio"
              label={t(`cuisine.${tag}` as MessageKey)}
              selected={filters.cuisine === tag}
              onPress={() => setFilters((f) => ({ ...f, cuisine: f.cuisine === tag ? null : tag }))}
            />
          ))}
        </ScrollView>
        </View>
      ) : null}

      {restaurants.isPending ? (
        <View style={{ gap: theme.space[3] }} accessibilityLabel={t('status.loading')}>
          {[0, 1, 2, 3].map((i) => (
            <RestaurantRowSkeleton key={i} />
          ))}
        </View>
      ) : restaurants.isError && !restaurants.data ? (
        <Card elevation={0} padding={4}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Icon name="x" size={20} color="dangerText" />
            <Text variant="label" style={{ flex: 1 }}>
              {t('home.load_failed')}
            </Text>
            <Button size="sm" variant="secondary" label={t('action.retry')} onPress={() => void restaurants.refetch()} />
          </View>
        </Card>
      ) : total === 0 ? (
        <EmptyState
          icon="filter"
          title={t('list.empty')}
          body={t('list.empty_hint')}
          action={activeFilterCount(filters) > 0 ? { label: t('list.clear_filters'), onPress: () => setFilters({}) } : undefined}
        />
      ) : (
        <View style={{ gap: theme.space[6] }}>
          {out.open.length ? (
            <View style={{ gap: theme.space[3] }} testID="restaurants-open">
              {out.open.map((r) => (
                <RestaurantRow key={r.id} r={r} />
              ))}
            </View>
          ) : null}
          {out.closed.length ? (
            <View style={{ gap: theme.space[3] }} testID="restaurants-closed">
              <View style={{ gap: 2 }}>
                <SectionHeader title={t('list.closed_section')} />
                <Text variant="footnote" color="textMuted">
                  {t('list.closed_browse')}
                </Text>
              </View>
              {out.closed.map((r) => (
                <RestaurantRow key={r.id} r={r} />
              ))}
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
