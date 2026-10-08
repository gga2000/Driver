import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Card,
  Icon,
  SearchField,
  stageOf,
  Text,
  useLoadTimeout,
  useNow,
  useTheme,
} from '@driver/ui';
import { Screen } from '@/components/Screen';
import { hourWords } from '@/features/doors/cravings';
import { bestThree, doorShops } from '@/features/doors/doors';
import { FoodArt, kitchenLook, motifForKitchen } from '@/features/food/FoodArt';
import { DoorPhotos } from '@/features/food-landing/DoorPhotos';
import { AheadCard, AllShops, KitchenCards } from '@/features/food-landing/Kitchens';
import { streetOf } from '@/features/food-landing/landing';
import { Showcase } from '@/features/food-landing/Showcase';
import { heroHeight, StreetHero } from '@/features/food-landing/StreetHero';
import { usePicks, useRestaurants } from '@/features/home/queries';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { appNow } from '@/lib/dev-clock';
import { useT } from '@/lib/i18n';

/**
 * الأكل, behind the home food tile: «سوق الليل» (Ali 2026-10-08, A + B + C). A night photo of an
 * Aziziyah food street fills the top, each shop tagged with what is open behind it now; under it, on
 * a cream sheet, search, the four doors as photo tiles in the order the hour wants them (d4), one big
 * showcase of real dishes for this hour (C), «محلاتك», the open kitchens with one honest reason each,
 * and the way to every place. With nothing open the street sleeps and the first kitchen to open takes
 * an order for later. Public, like home.
 */
export default function FoodHome() {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const restaurants = useRestaurants();
  const tick = useNow(true, 60_000);
  const now = useMemo(() => appNow(tick), [tick]);
  const [width, setWidth] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [slow, restartSlow] = useLoadTimeout(restaurants.isPending);
  const picks = usePicks(hourWords(now), 3).data ?? [];
  const list = restaurants.data;
  const failed = (restaurants.isError || slow) && !list;
  const street = useMemo(() => streetOf(list ?? [], now), [list, now]);
  const mine = useMemo(
    () => (list ?? []).filter((r) => r.favourite).sort((a, b) => Number(b.open) - Number(a.open)),
    [list],
  );
  const open = useMemo(() => (list ?? []).filter((r) => r.open), [list]);
  const kitchens = useMemo(() => bestThree(open, 3), [open]);
  // The street asleep: the first meal kitchen to open takes tonight's order for the morning.
  const ahead = street.asleep && list ? (doorShops(list, 'meal').closed.find((r) => r.opensAt) ?? null) : null;
  const inner = Math.max(0, width - theme.space[5] * 2);
  const retry = () => {
    restartSlow();
    void restaurants.refetch();
  };
  const refresh = async () => {
    setRefreshing(true);
    await restaurants.refetch();
    setRefreshing(false);
  };

  return (
    <Screen
      testID="food-home"
      padded={false}
      edges={[]}
      contentStyle={{ paddingTop: 0, paddingBottom: 0, gap: 0 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
    >
      <StatusBar style="light" />
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <StreetHero street={street} width={width} height={heroHeight(width, screenH) + insets.top} top={insets.top} loading={!list} />
        ) : null}

        {/* The cream sheet rides up over the street's foot. */}
        <View
          style={{
            marginTop: -theme.space[6],
            borderTopStartRadius: theme.radius['2xl'],
            borderTopEndRadius: theme.radius['2xl'],
            backgroundColor: theme.colors.bg,
            paddingHorizontal: theme.space[5],
            paddingTop: theme.space[3],
            paddingBottom: theme.space[8],
            gap: theme.space[6],
          }}
        >
          <View style={{ gap: theme.space[3] }}>
            <View aria-hidden accessible={false} style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.border }} />
            <SearchField
              testID="food-search"
              floating
              placeholder={t('search.placeholder')}
              accessibilityLabel={t('search.a11y_open')}
              onPress={() => router.push('/search')}
            />
          </View>

          {failed ? (
            <Card lift padding={4}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                <Icon name="x" size={20} color="dangerText" />
                <Text variant="label" style={{ flex: 1 }}>
                  {t('home.load_failed')}
                </Text>
                <Button size="sm" variant="secondary" label={t('action.retry')} onPress={retry} />
              </View>
            </Card>
          ) : null}

          {ahead ? <AheadCard shop={ahead} /> : null}

          {inner > 0 ? (
            <View style={{ gap: theme.space[3] }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <Text variant="title" weight={700} accessibilityRole="header">
                  {t('food.landing.choose')}
                </Text>
                <Text variant="label" color="textMuted">
                  {t('food.landing.choose_hint')}
                </Text>
              </View>
              <DoorPhotos order={street.order} facts={list ? street.facts : null} width={inner} />
            </View>
          ) : null}

          {inner > 0 && !street.asleep ? <Showcase dishes={picks} moment={street.moment} kitchens={list ?? []} width={inner} /> : null}

          {mine.length > 0 ? (
            <View style={{ gap: theme.space[3] }} testID="food-yours">
              <Text variant="title" weight={700} accessibilityRole="header">
                {t('food.yours')}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -theme.space[5] }}
                contentContainerStyle={{ paddingHorizontal: theme.space[5], gap: theme.space[3] }}
              >
                {mine.map((r) => (
                  <YourPlace key={r.id} r={r} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          <KitchenCards picks={kitchens} />

          {list && list.length > 0 ? <AllShops /> : null}
        </View>
      </View>
    </Screen>
  );
}

/** One of «محلاتك»: its picture in a saffron ring, the name, and open or when it opens. */
function YourPlace({ r }: { r: RestaurantSummary }) {
  const theme = useTheme();
  const t = useT();
  const state = r.open
    ? t('food.open_now')
    : r.opensAt
      ? t('food.fact_opens', { time: r.opensAt })
      : t('food.fact_closed');
  return (
    <Pressable
      testID={`food-yours-${r.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${r.name}، ${state}`}
      onPress={() => router.push({ pathname: '/restaurant/[id]', params: { id: r.id } })}
      style={({ pressed }) => ({
        width: 84,
        alignItems: 'center',
        gap: theme.space[1],
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View
        style={{
          width: 68,
          height: 68,
          borderRadius: 34,
          padding: 3,
          borderWidth: 2,
          borderColor: r.open ? theme.colors.accent : theme.colors.border,
          opacity: r.open ? 1 : 0.6,
        }}
      >
        <View style={{ flex: 1, borderRadius: 31, overflow: 'hidden' }}>
          <FoodArt
            motif={motifForKitchen(r.tags, r.cuisine)}
            look={kitchenLook(r.id)}
            stage={stageOf(r.id, theme.decor.stages)}
          />
        </View>
      </View>
      <Text variant="caption" weight={700} align="center" numberOfLines={2}>
        {r.name}
      </Text>
      <Text
        variant="caption"
        color={r.open ? 'accentText' : 'textMuted'}
        align="center"
        numberOfLines={1}
      >
        {state}
      </Text>
    </Pressable>
  );
}
