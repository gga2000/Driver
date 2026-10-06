import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { CatalogSearchDish } from '@driver/contracts';
import { Button, Card, Chip, Icon, ListRow, SearchField, StatusPill, Text, useTheme } from '@driver/ui';
import { countKey } from '@/lib/plural';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { FoodArt, artOf } from '@/features/food/FoodArt';
import { HeaderBack } from '@/features/food/HeaderBack';
import { useCatalogSearch } from '@/features/food/queries';
import { RestaurantRow, RestaurantRowSkeleton } from '@/features/food/RestaurantRow';
import { useRestaurants } from '@/features/home/queries';
import { toSummary } from '@/features/home/restaurant-summary';
import { popularTerms, SEARCH_DEBOUNCE_MS } from '@/features/search/logic';
import { searchRecents, useSearchRecents } from '@/features/search/recents';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * دوّر (audit C-01): the home bar opens this full screen. Empty: recent searches and what the town's
 * kitchens actually serve. Typing: kitchens and dishes from `catalog.search` (Arabic-folded on the
 * server: ة/ه, أ/ا/إ, ى/ي, گ/ك, "ال", Eastern digits). Closed kitchens are listed and marked, still
 * openable. Nothing found says so and offers the full list. Public, like home.
 */
export default function Search() {
  const theme = useTheme();
  const t = useT();
  // Home's cuisine chips open this screen with the term already in (`/search?q=كباب`).
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(typeof q === 'string' ? q : '');
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const results = useCatalogSearch(debounced);
  const recents = useSearchRecents();
  const restaurants = useRestaurants();
  const popular = useMemo(() => popularTerms((restaurants.data ?? []).map((r) => r.cuisine)), [restaurants.data]);
  const typed = query.trim().length > 0;
  const data = typed ? results.data : undefined;
  const settling = typed && (debounced.trim() !== query.trim() || results.isFetching);

  const remember = () => {
    if (query.trim()) searchRecents.add(query);
  };
  const openDish = (d: CatalogSearchDish) => {
    remember();
    router.push({ pathname: '/restaurant/[id]', params: { id: d.restaurantId, item: d.id } });
  };

  const chips = (terms: readonly string[], testPrefix: string, centered = false) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2], justifyContent: centered ? 'center' : 'flex-start' }}>
      {terms.map((term) => (
        <Chip key={term} testID={`${testPrefix}-${term}`} role="button" label={term} onPress={() => setQuery(term)} />
      ))}
    </View>
  );

  return (
    <Screen testID="search">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1], marginStart: -theme.space[2] }}>
        <HeaderBack />
        <SearchField
          testID="search-input"
          autoFocus
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          onSubmitEditing={remember}
          placeholder={t('search.screen_placeholder')}
          accessibilityLabel={t('search.title')}
          style={{ flex: 1 }}
        />
      </View>

      {!typed ? (
        <View style={{ gap: theme.space[6] }} testID="search-start">
          {recents.length ? (
            <View style={{ gap: theme.space[2] }} testID="search-recents">
              <SectionHeader title={t('search.recent')} action={{ label: t('search.recent_clear'), onPress: () => searchRecents.clear() }} />
              <Card elevation={0} padding={0}>
                {recents.map((r, i) => (
                  <ListRow key={r} testID={`recent-${i}`} leading="clock" title={r} onPress={() => setQuery(r)} divider={i < recents.length - 1} />
                ))}
              </Card>
            </View>
          ) : (
            <View style={{ gap: theme.space[1], paddingTop: theme.space[2] }}>
              <Text variant="title">{t('search.start_title')}</Text>
              <Text variant="body" color="textMuted">
                {t('search.start_hint')}
              </Text>
            </View>
          )}
          {popular.length ? (
            <View style={{ gap: theme.space[3] }} testID="search-popular">
              <Text variant="title">{t('search.popular')}</Text>
              {chips(popular, 'popular')}
            </View>
          ) : null}
        </View>
      ) : !data && results.isError ? (
        <Card elevation={0} padding={4} testID="search-error">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Icon name="x" size={20} color="dangerText" />
            <Text variant="label" style={{ flex: 1 }}>
              {t('search.failed')}
            </Text>
            <Button size="sm" variant="secondary" label={t('action.retry')} onPress={() => void results.refetch()} />
          </View>
        </Card>
      ) : !data ? (
        <View style={{ gap: theme.space[3] }} accessibilityLabel={t('status.loading')}>
          <RestaurantRowSkeleton />
          <RestaurantRowSkeleton />
        </View>
      ) : data.restaurants.length === 0 && data.dishes.length === 0 ? (
        settling ? (
          <View style={{ gap: theme.space[3] }} accessibilityLabel={t('status.loading')}>
            <RestaurantRowSkeleton />
          </View>
        ) : (
          <View style={{ gap: theme.space[5], alignItems: 'center', paddingTop: theme.space[6] }} testID="search-empty">
            <View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="search" size={32} color="accentText" />
            </View>
            <View style={{ gap: theme.space[2], alignItems: 'center' }}>
              <Text variant="title" align="center">
                {t('search.no_results', { query: query.trim() })}
              </Text>
              <Text variant="body" color="textMuted" align="center" style={{ maxWidth: 320 }}>
                {t('search.no_results_hint')}
              </Text>
            </View>
            <Button testID="search-see-all" variant="secondary" icon="bag" label={t('search.see_all_restaurants')} onPress={() => router.push('/restaurants')} style={{ alignSelf: 'center' }} />
            {popular.length ? <View style={{ alignSelf: 'stretch', alignItems: 'center' }}>{chips(popular.slice(0, 6), 'try', true)}</View> : null}
          </View>
        )
      ) : (
        <View style={{ gap: theme.space[6], opacity: settling ? 0.6 : 1 }} testID="search-results" accessibilityLiveRegion="polite">
          <Text variant="label" color="textMuted" tabular>
            {t(countKey('search.results_count', data.restaurants.length + data.dishes.length), { n: data.restaurants.length + data.dishes.length })}
          </Text>
          {data.restaurants.length ? (
            <View style={{ gap: theme.space[3] }} testID="search-restaurants">
              <SectionHeader title={t('search.section_restaurants')} />
              {data.restaurants.map((c) => (
                <RestaurantRow key={c.id} r={toSummary(c, false)} testID={`search-restaurant-${c.id}`} onOpen={remember} />
              ))}
            </View>
          ) : null}
          {data.dishes.length ? (
            <View style={{ gap: theme.space[3] }} testID="search-dishes">
              <SectionHeader title={t('search.section_dishes')} />
              <Card elevation={0} padding={0}>
                {data.dishes.map((d, i) => (
                  <DishResult key={d.id} d={d} divider={i < data.dishes.length - 1} onPress={() => openDish(d)} />
                ))}
              </Card>
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function DishResult({ d, divider, onPress }: { d: CatalogSearchDish; divider: boolean; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const muted = !d.restaurantOpen || !d.available;
  const price = iqd(d.priceIqd, { locale });
  const closedLabel = d.restaurantOpensAt ? t('list.closed_opens_at', { time: d.restaurantOpensAt }) : t('list.closed');
  return (
    <Pressable
      testID={`search-dish-${d.id}`}
      accessibilityRole="button"
      accessibilityLabel={[d.name, t('search.dish_at', { restaurant: d.restaurantName }), price, !d.restaurantOpen ? closedLabel : !d.available ? t('search.sold_out') : null].filter(Boolean).join('، ')}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingVertical: theme.space[3],
        paddingHorizontal: theme.space[4],
        backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
        borderBottomWidth: divider ? 1 : 0,
        borderBottomColor: theme.colors.border,
      })}
    >
      <View style={{ width: 64, height: 64, borderRadius: theme.radius.md, overflow: 'hidden', opacity: muted ? 0.55 : 1 }}>
        <FoodArt {...artOf(d)} photoUrl={d.photoUrl} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {d.name}
        </Text>
        <Text variant="footnote" color="textMuted" numberOfLines={1}>
          {t('search.dish_at', { restaurant: d.restaurantName })}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space[2], marginTop: 2 }}>
          <Text variant="label" weight={600} tabular color={muted ? 'textMuted' : 'text'}>
            {price}
          </Text>
          {!d.restaurantOpen ? (
            <StatusPill size="sm" tone="neutral" icon="clock" label={closedLabel} />
          ) : !d.available ? (
            <StatusPill size="sm" tone="neutral" label={t('search.sold_out')} />
          ) : null}
        </View>
      </View>
      <Icon name="chevron-forward" size={18} color="textMuted" />
    </Pressable>
  );
}
