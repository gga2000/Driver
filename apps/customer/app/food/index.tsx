import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { doorMoment, doorOrder } from '@driver/contracts';
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
import { SectionHeader } from '@/components/SectionHeader';
import { DoorTile } from '@/features/doors/DoorTile';
import { doorFact } from '@/features/doors/doors';
import { DoorWash } from '@/features/doors/DoorWash';
import { HeaderBack } from '@/features/food/HeaderBack';
import { FoodArt, kitchenLook, motifForKitchen } from '@/features/food/FoodArt';
import { useRestaurants } from '@/features/home/queries';
import type { RestaurantSummary } from '@/features/home/restaurant-summary';
import { appNow } from '@/lib/dev-clock';
import { useT } from '@/lib/i18n';

const GAP = 12;

/**
 * الأكل, the food home behind the home food tile (Ali's Yes ideas, 2026-10-07): instead of every kitchen
 * thrown at you, one line for this hour and four doors — مطاعم، قهوة وچاي، عصير وبارد، حلو وآيس كريم —
 * in the order the hour wants them (d4: lunch leads with meals, a summer afternoon with cold drinks, a
 * summer night with ice cream), each with its live fact. Then «محلاتك», only when you have ordered
 * somewhere (no fake favourites), and a quiet way to the full list. Public, like home.
 */
export default function FoodHome() {
  const theme = useTheme();
  const t = useT();
  const restaurants = useRestaurants();
  const tick = useNow(true, 60_000);
  const now = useMemo(() => appNow(tick), [tick]);
  const order = doorOrder(now);
  const moment = doorMoment(now);
  const [width, setWidth] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [slow, restartSlow] = useLoadTimeout(restaurants.isPending);
  const list = restaurants.data;
  const failed = (restaurants.isError || slow) && !list;
  const mine = useMemo(
    () => (list ?? []).filter((r) => r.favourite).sort((a, b) => Number(b.open) - Number(a.open)),
    [list],
  );
  const tileW = width > 0 ? (width - GAP) / 2 : 0;
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
      backdrop={<DoorWash color={theme.decor.stages[0] ?? theme.colors.accentTint} />}
      contentStyle={{ gap: theme.space[5] }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
    >
      <View style={{ gap: theme.space[3] }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[2],
            marginStart: -theme.space[2],
          }}
        >
          <HeaderBack />
          <Text variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
            {t('food.title')}
          </Text>
        </View>
        {/* This hour, in one line (d5): what people here want now. */}
        <Text variant="display" face="display" testID="food-moment">
          {t(`food.moment.${moment}`)}
        </Text>
        <SearchField
          testID="food-search"
          floating
          placeholder={t('search.placeholder')}
          accessibilityLabel={t('search.a11y_open')}
          onPress={() => router.push('/search')}
        />
      </View>

      <View
        testID="food-doors"
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}
      >
        {tileW > 0
          ? order.map((door) => (
              <DoorTile
                key={door}
                door={door}
                fact={list ? doorFact(list, door) : null}
                width={tileW}
                height={Math.round(tileW * 1.18)}
              />
            ))
          : null}
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

      {mine.length > 0 ? (
        <View style={{ gap: theme.space[3] }} testID="food-yours">
          <SectionHeader big title={t('food.yours')} />
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

      {list && list.length > 0 ? (
        <Button
          testID="food-all"
          variant="ghost"
          icon="bag"
          label={t('search.see_all_restaurants')}
          onPress={() => router.push('/restaurants')}
          style={{ alignSelf: 'center' }}
        />
      ) : null}
    </Screen>
  );
}

/** One of «محلاتك»: its picture on a plate, the name, and open or when it opens. */
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
        width: 104,
        alignItems: 'center',
        gap: theme.space[1],
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          overflow: 'hidden',
          opacity: r.open ? 1 : 0.6,
        }}
      >
        <FoodArt
          motif={motifForKitchen(r.tags, r.cuisine)}
          look={kitchenLook(r.id)}
          stage={stageOf(r.id, theme.decor.stages)}
        />
      </View>
      <Text variant="label" weight={700} align="center" numberOfLines={1}>
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
