import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { doorOrder, type CatalogSearchDish, type LaunchService } from '@driver/contracts';
import { Button, Card, Icon, ListRow, SearchField, Text, useTheme } from '@driver/ui';
import { countKey } from '@/lib/plural';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { HeaderBack } from '@/features/food/HeaderBack';
import { useCatalogSearch } from '@/features/food/queries';
import { RestaurantRow, RestaurantRowSkeleton } from '@/features/food/RestaurantRow';
import { ComingSoonSheet } from '@/features/home/ComingSoonSheet';
import { usePicks, useRestaurants } from '@/features/home/queries';
import { toSummary } from '@/features/home/restaurant-summary';
import { BestThree } from '@/features/doors/BestThree';
import { DoorChips } from '@/features/doors/DoorChips';
import { bestThree } from '@/features/doors/doors';
import { DishResult } from '@/features/search/DishResult';
import { doorResultShops, DoorResults } from '@/features/search/DoorResults';
import { searchIntents } from '@/features/search/intents';
import { kitchensForMeal, MealResults } from '@/features/search/MealResults';
import { SEARCH_DEBOUNCE_MS } from '@/features/search/logic';
import { searchRecents, useSearchRecents } from '@/features/search/recents';
import { ServiceResults } from '@/features/search/ServiceResults';
import { UnmetAsk } from '@/features/search/UnmetAsk';
import { appNow } from '@/lib/dev-clock';
import { useT } from '@/lib/i18n';

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

const NO_WORDS: readonly string[] = [];
/** Dishes listed before «كل الأكلات (n)» opens the rest (f4: the shops come first). */
const DISHES_SHOWN = 4;
/** Shops listed by name before «شوف باقي المحلات». */
const SHOPS_SHOWN = 3;

/**
 * دوّر (audit C-01, joy h4 «one box for the whole town»): the home bar opens this full screen. Empty
 * (f3, calm): what you searched before and the four food doors, nothing else. Typing: first what the
 * words mean beyond food («بغداد» → الرجعة, «تكسي للسوق» → a ride there, «سوق» → coming soon;
 * `intents.ts`), then a door word's best shops («قهوة», «حلويات», «آيس كريم»; f1), a meal word's dishes
 * («فطور»), then `catalog.search` (Arabic-folded on the server): when a dish is served by several shops,
 * «أحسن 3» of them with their reasons first (f4), then the shops by name and the dishes, both short with
 * a way to the rest. Nothing at all → it says so plainly, offers the full list and asks whether to tell
 * the shops (`search.unmet`; f2: no unrelated suggestions). Public, like home.
 */
export default function Search() {
  const theme = useTheme();
  const t = useT();
  // Home's cuisine chips open this screen with the term already in (`/search?q=كباب`).
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(typeof q === 'string' ? q : '');
  const [soon, setSoon] = useState<LaunchService | null>(null);
  const [allDishes, setAllDishes] = useState(false);
  const [allShops, setAllShops] = useState(false);
  const debounced = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const results = useCatalogSearch(debounced);
  const recents = useSearchRecents();
  const restaurants = useRestaurants();
  const order = useMemo(() => doorOrder(appNow()), []);
  const typed = query.trim().length > 0;
  const data = typed ? results.data : undefined;
  const settling = typed && (debounced.trim() !== query.trim() || results.isFetching);
  useEffect(() => {
    setAllDishes(false);
    setAllShops(false);
  }, [debounced]);

  // What the words mean beyond food, from the folded text alone (no request).
  const intents = useMemo(() => (typed ? searchIntents(debounced) : []), [typed, debounced]);
  const meal = intents.find((i) => i.kind === 'meal');
  const doors = useMemo(() => intents.flatMap((i) => (i.kind === 'door' ? [i] : [])), [intents]);
  const mealPicks = usePicks(meal?.kind === 'meal' ? meal.words : NO_WORDS, 6);
  const mealKitchens = useMemo(() => (meal?.kind === 'meal' ? kitchensForMeal(restaurants.data ?? [], meal.tags) : []), [meal, restaurants.data]);
  const mealDishes = meal ? (mealPicks.data ?? []) : [];
  const answeredBeyondFood = intents.some((i) => i.kind !== 'meal') || mealDishes.length > 0 || mealKitchens.length > 0;

  // f4: a dish served by more than one open shop → the best three of those shops, each with its reason.
  const dishPicks = useMemo(() => {
    if (!data || doors.length > 0) return [];
    const ids = new Set(data.dishes.filter((d) => d.restaurantOpen).map((d) => d.restaurantId));
    if (ids.size < 2) return [];
    return bestThree((restaurants.data ?? []).filter((r) => r.open && ids.has(r.id)));
  }, [data, doors.length, restaurants.data]);
  // Shops already shown under a door or in the three are not listed again by name.
  const shown = new Set([...dishPicks.map((p) => p.shop.id), ...doors.flatMap((i) => bestThree(doorResultShops(restaurants.data ?? [], i.door, i.iceCream).open).map((p) => p.shop.id))]);
  const shops = (data?.restaurants ?? []).filter((c) => !shown.has(c.id));

  const remember = () => {
    if (query.trim()) searchRecents.add(query);
  };
  const openDish = (d: CatalogSearchDish) => {
    remember();
    router.push({ pathname: '/restaurant/[id]', params: { id: d.restaurantId, item: d.id } });
  };

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
      </View>
    )
  ) : shops.length === 0 && data.dishes.length === 0 && dishPicks.length === 0 ? null : (
    <View style={{ gap: theme.space[6], opacity: settling ? 0.6 : 1 }} testID="search-results" accessibilityLiveRegion="polite">
      <Text variant="label" color="textMuted" tabular>
        {t(countKey('search.results_count', data.restaurants.length + data.dishes.length), { n: data.restaurants.length + data.dishes.length })}
      </Text>
      {dishPicks.length > 0 ? <BestThree picks={dishPicks} title={t('search.best_for', { query: debounced.trim() })} onOpen={remember} testID="search-best" /> : null}
      {shops.length ? (
        <View style={{ gap: theme.space[3] }} testID="search-restaurants">
          <SectionHeader title={t('search.section_restaurants')} />
          {(allShops ? shops : shops.slice(0, SHOPS_SHOWN)).map((c) => (
            <RestaurantRow key={c.id} r={toSummary(c, false)} testID={`search-restaurant-${c.id}`} onOpen={remember} />
          ))}
          {!allShops && shops.length > SHOPS_SHOWN ? (
            <Button testID="search-more-shops" variant="ghost" label={t('search.more_shops', { n: shops.length - SHOPS_SHOWN })} onPress={() => setAllShops(true)} style={{ alignSelf: 'center' }} />
          ) : null}
        </View>
      ) : null}
      {data.dishes.length ? (
        <View style={{ gap: theme.space[3] }} testID="search-dishes">
          <SectionHeader title={t('search.section_dishes')} />
          <Card elevation={0} padding={0}>
            {(allDishes ? data.dishes : data.dishes.slice(0, DISHES_SHOWN)).map((d, i, list) => (
              <DishResult key={d.id} d={d} divider={i < list.length - 1} onPress={() => openDish(d)} />
            ))}
          </Card>
          {!allDishes && data.dishes.length > DISHES_SHOWN ? (
            <Button testID="search-all-dishes" variant="ghost" label={t('search.all_dishes', { n: data.dishes.length })} onPress={() => setAllDishes(true)} style={{ alignSelf: 'center' }} />
          ) : null}
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
          <View style={{ gap: theme.space[3] }}>
            <SectionHeader big title={t('home.cravings')} />
            <DoorChips order={order} testID="search-doors" />
          </View>
        </View>
      ) : (
        <View style={{ gap: theme.space[6] }}>
          <ServiceResults intents={intents} onSoon={setSoon} onPick={remember} />
          {doors.map((i) => (
            <DoorResults key={i.door} door={i.door} iceCream={i.iceCream} all={restaurants.data ?? []} onOpen={remember} />
          ))}
          {meal?.kind === 'meal' ? <MealResults meal={meal.meal} dishes={mealDishes} kitchens={mealKitchens} onDish={openDish} onKitchen={remember} /> : null}
          {catalog}
        </View>
      )}
      <ComingSoonSheet service={soon} onClose={() => setSoon(null)} />
    </Screen>
  );
}
