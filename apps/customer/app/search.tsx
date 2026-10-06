import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import type { CatalogSearchDish, LaunchService } from '@driver/contracts';
import { Button, Card, Chip, Icon, ListRow, SearchField, Text, useTheme } from '@driver/ui';
import { countKey } from '@/lib/plural';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { HeaderBack } from '@/features/food/HeaderBack';
import { useCatalogSearch } from '@/features/food/queries';
import { RestaurantRow, RestaurantRowSkeleton } from '@/features/food/RestaurantRow';
import { ComingSoonSheet } from '@/features/home/ComingSoonSheet';
import { usePicks, useRestaurants } from '@/features/home/queries';
import { toSummary } from '@/features/home/restaurant-summary';
import { bandTitleKey, bandWords, daypart } from '@/features/home/daypart';
import { DaypartBand } from '@/features/home/DaypartBand';
import { FoodArt, motifForCuisine } from '@/features/food/FoodArt';
import { DishResult } from '@/features/search/DishResult';
import { searchIntents } from '@/features/search/intents';
import { kitchensForMeal, MealResults } from '@/features/search/MealResults';
import { popularTerms, SEARCH_DEBOUNCE_MS } from '@/features/search/logic';
import { searchRecents, useSearchRecents } from '@/features/search/recents';
import { ServiceResults } from '@/features/search/ServiceResults';
import { UnmetAsk } from '@/features/search/UnmetAsk';
import { useViewedRestaurants } from '@/features/search/viewed';
import { appNow } from '@/lib/dev-clock';
import { useT } from '@/lib/i18n';
import { useSeason } from '@/lib/use-season';

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const NO_WORDS: readonly string[] = [];

/**
 * دوّر (audit C-01, joy h4 «one box for the whole town»): the home bar opens this full screen. Empty:
 * recent searches and what the town's kitchens actually serve. Typing: first what the words mean
 * beyond food («بغداد» → الرجعة, «تكسي للسوق» → a ride there, «سوق» → coming soon; `intents.ts`), then
 * a meal word's dishes («فطور»), then kitchens and dishes from `catalog.search` (Arabic-folded on the
 * server). Closed kitchens are listed and marked, still openable. Nothing at all → it says so, offers
 * the full list and asks whether to tell the kitchens (`search.unmet`). Public, like home.
 */
export default function Search() {
  const theme = useTheme();
  const t = useT();
  // Home's cuisine chips open this screen with the term already in (`/search?q=كباب`).
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(typeof q === 'string' ? q : '');
  const [soon, setSoon] = useState<LaunchService | null>(null);
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const results = useCatalogSearch(debounced);
  const recents = useSearchRecents();
  const restaurants = useRestaurants();
  const popular = useMemo(() => popularTerms((restaurants.data ?? []).map((r) => r.cuisine)), [restaurants.data]);
  // The start screen (D-24): what I opened before, and dishes for this hour from kitchens open now.
  const viewed = useViewedRestaurants();
  const dp = useMemo(() => daypart(appNow()), []);
  const quiet = useSeason().quiet;
  const dayPicks = usePicks(bandWords(dp));
  const typed = query.trim().length > 0;
  const data = typed ? results.data : undefined;
  const settling = typed && (debounced.trim() !== query.trim() || results.isFetching);

  // What the words mean beyond food, from the folded text alone (no request).
  const intents = useMemo(() => (typed ? searchIntents(debounced) : []), [typed, debounced]);
  const meal = intents.find((i) => i.kind === 'meal');
  const mealPicks = usePicks(meal?.kind === 'meal' ? meal.words : NO_WORDS, 6);
  const mealKitchens = useMemo(() => (meal?.kind === 'meal' ? kitchensForMeal(restaurants.data ?? [], meal.tags) : []), [meal, restaurants.data]);
  const mealDishes = meal ? (mealPicks.data ?? []) : [];
  const answeredBeyondFood = intents.some((i) => i.kind !== 'meal') || mealDishes.length > 0 || mealKitchens.length > 0;

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

  const catalog = !data && results.isError ? (
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
    ) : answeredBeyondFood ? null : (
      <View style={{ gap: theme.space[5], alignItems: 'center', paddingTop: theme.space[4] }} testID="search-empty">
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
        <UnmetAsk key={debounced} query={debounced} />
        <Button testID="search-see-all" variant="ghost" icon="bag" label={t('search.see_all_restaurants')} onPress={() => router.push('/restaurants')} style={{ alignSelf: 'center' }} />
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
          placeholder={t('search.placeholder')}
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
          {viewed.length ? (
            <View style={{ gap: theme.space[2] }} testID="search-viewed">
              <SectionHeader title={t('search.viewed')} />
              <Card elevation={0} padding={0}>
                {viewed.map((r, i) => {
                  const now = restaurants.data?.find((x) => x.id === r.id);
                  return (
                    <ListRow
                      key={r.id}
                      testID={`viewed-${i}`}
                      leading={
                        <View style={{ width: 40, height: 40, borderRadius: theme.radius.md, overflow: 'hidden' }}>
                          <FoodArt motif={motifForCuisine(now?.cuisine ?? r.name)} />
                        </View>
                      }
                      title={r.name}
                      {...(now ? { subtitle: now.cuisine } : {})}
                      chevron
                      onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: r.id } })}
                      divider={i < viewed.length - 1}
                    />
                  );
                })}
              </Card>
            </View>
          ) : null}
          <DaypartBand title={t(bandTitleKey(dp, quiet))} dishes={dayPicks.data} testID="search-daypart" />
          {popular.length ? (
            <View style={{ gap: theme.space[3] }} testID="search-popular">
              <Text variant="title">{t('search.popular')}</Text>
              {chips(popular, 'popular')}
            </View>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: theme.space[6] }}>
          <ServiceResults intents={intents} onSoon={setSoon} onPick={remember} />
          {meal?.kind === 'meal' ? <MealResults meal={meal.meal} dishes={mealDishes} kitchens={mealKitchens} onDish={openDish} onKitchen={remember} /> : null}
          {catalog}
        </View>
      )}
      <ComingSoonSheet service={soon} onClose={() => setSoon(null)} />
    </Screen>
  );
}
