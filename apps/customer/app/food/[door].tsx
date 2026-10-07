import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import Svg, { G } from 'react-native-svg';
import type { MessageKey } from '@driver/i18n';
import {
  Button,
  Card,
  Chip,
  DishDrawing,
  EmptyState,
  Icon,
  Text,
  useLoadTimeout,
  useTheme,
} from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { BestThree } from '@/features/doors/BestThree';
import { useDoorFactText } from '@/features/doors/DoorTile';
import {
  bestThree,
  DOOR_ART,
  doorFact,
  doorShops,
  isFoodDoor,
  showBest,
  showTools,
} from '@/features/doors/doors';
import { doorSwatch } from '@/features/doors/palette';
import { DoorWash } from '@/features/doors/DoorWash';
import { HeaderBack } from '@/features/food/HeaderBack';
import { cuisineOptions } from '@/features/food/list';
import { RestaurantRow, RestaurantRowSkeleton } from '@/features/food/RestaurantRow';
import { useRestaurants } from '@/features/home/queries';
import { useT } from '@/lib/i18n';

const ART = 112;

/**
 * Behind one food door (ideas d2, k1–k6, i1, p1): the door's colour washing the top, its drawing, name,
 * what it serves and its live fact. Then, calmly: «أحسن 3 هسة» with reasons and «قارن بيناتهم» when there
 * are more than three to choose from (else just the open ones, plainly); «الباقي»; ice cream shops too
 * far to arrive frozen named in one line (melt guard); closed shops behind their shutters with when they
 * open. Sorting and the one question («شنو بخاطرك؟») only appear once a door has more than 8 open (k6).
 */
export default function DoorScreen() {
  const theme = useTheme();
  const t = useT();
  const say = useDoorFactText();
  const params = useLocalSearchParams<{ door?: string }>();
  const door = isFoodDoor(params.door) ? params.door : 'meal';
  const s = doorSwatch(theme, door);
  const restaurants = useRestaurants();
  const [slow, restartSlow] = useLoadTimeout(restaurants.isPending);
  const [refreshing, setRefreshing] = useState(false);
  const [cuisine, setCuisine] = useState<string | null>(null);
  const list = restaurants.data;
  const shops = useMemo(() => doorShops(list ?? [], door), [list, door]);
  const tools = showTools(shops.open.length);
  const open = useMemo(
    () => (tools && cuisine ? shops.open.filter((r) => r.tags.includes(cuisine)) : shops.open),
    [shops.open, tools, cuisine],
  );
  const picks = useMemo(() => (showBest(open.length) ? bestThree(open) : []), [open]);
  const rest = open.filter((r) => !picks.some((p) => p.shop.id === r.id));
  const fact = list ? say(doorFact(list, door)) : null;
  const name = t(`food.door.${door}`);
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
      testID={`door-${door}-screen`}
      backdrop={<DoorWash color={s.tint} />}
      contentStyle={{ gap: theme.space[6] }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
    >
      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginStart: -theme.space[2] }}>
          <HeaderBack fallback="/food" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text variant="display" face="display" accessibilityRole="header" numberOfLines={2}>
              {name}
            </Text>
            <Text variant="body" color="textMuted">
              {t(`food.door_hint.${door}`)}
            </Text>
            {fact ? (
              <View
                style={{
                  alignSelf: 'flex-start',
                  marginTop: theme.space[1],
                  paddingHorizontal: theme.space[3],
                  minHeight: 28,
                  justifyContent: 'center',
                  borderRadius: theme.radius.pill,
                  backgroundColor: s.fill,
                }}
              >
                <Text
                  variant="caption"
                  weight={700}
                  tabular
                  style={{ color: s.on }}
                  testID="door-fact"
                >
                  {fact}
                </Text>
              </View>
            ) : null}
          </View>
          <View
            style={{
              width: ART,
              height: ART,
              borderTopStartRadius: ART / 2,
              borderTopEndRadius: ART / 2,
              borderBottomStartRadius: theme.radius.tile,
              borderBottomEndRadius: theme.radius.tile,
              backgroundColor: s.fill,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-hidden
            accessible={false}
          >
            <Svg width={ART - 12} height={ART - 12} viewBox="0 0 200 200">
              <G transform="translate(8 6) scale(0.92)">
                <DishDrawing kind={DOOR_ART[door]} look={0} line={4.5} window={false} />
              </G>
            </Svg>
          </View>
        </View>
      </View>

      {restaurants.isPending && !slow ? (
        <View style={{ gap: theme.space[3] }} accessibilityLabel={t('status.loading')}>
          <RestaurantRowSkeleton />
          <RestaurantRowSkeleton />
          <RestaurantRowSkeleton />
        </View>
      ) : !list ? (
        <Card lift padding={4}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Icon name="x" size={20} color="dangerText" />
            <Text variant="label" style={{ flex: 1 }}>
              {t('home.load_failed')}
            </Text>
            <Button size="sm" variant="secondary" label={t('action.retry')} onPress={retry} />
          </View>
        </Card>
      ) : shops.open.length + shops.closed.length + shops.melted.length === 0 ? (
        <EmptyState icon="bag" title={t('food.empty_door')} body={t('food.empty_door_hint')} />
      ) : (
        <>
          {/* k5/k6: one question, only when there is a crowd to narrow. */}
          {tools ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginHorizontal: -theme.space[5] }}
              contentContainerStyle={{ paddingHorizontal: theme.space[5], gap: theme.space[2] }}
              testID="door-question"
            >
              {cuisineOptions(shops.open).map((tag) => (
                <Chip
                  key={tag}
                  role="radio"
                  label={t(`cuisine.${tag}` as MessageKey)}
                  selected={cuisine === tag}
                  onPress={() => setCuisine((c) => (c === tag ? null : tag))}
                />
              ))}
            </ScrollView>
          ) : null}

          {picks.length > 0 ? <BestThree picks={picks} /> : null}

          {rest.length > 0 ? (
            <View style={{ gap: theme.space[3] }} testID="door-open">
              <SectionHeader big title={picks.length > 0 ? t('food.rest') : t('food.open_now')} />
              {rest.map((r) => (
                <RestaurantRow key={r.id} r={r} />
              ))}
            </View>
          ) : null}

          {shops.melted.map((r) => (
            <View
              key={r.id}
              testID={`door-melted-${r.id}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space[2],
                padding: theme.space[3],
                borderRadius: theme.radius.lg,
                backgroundColor: theme.colors.surfaceSunken,
              }}
            >
              <Icon name="clock" size={18} color="textMuted" />
              <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
                {t('food.melted', { name: r.name })}
              </Text>
            </View>
          ))}

          {shops.open.length === 0 && shops.closed.length > 0 ? (
            <View style={{ gap: 2 }}>
              <Text variant="title">{t('food.closed_door')}</Text>
              <Text variant="footnote" color="textMuted">
                {t('food.closed_door_hint')}
              </Text>
            </View>
          ) : null}

          {shops.closed.length > 0 ? (
            <View style={{ gap: theme.space[3] }} testID="door-closed">
              {shops.open.length > 0 ? (
                <View style={{ gap: 2 }}>
                  <SectionHeader title={t('list.closed_section')} />
                  <Text variant="footnote" color="textMuted">
                    {t('list.closed_browse')}
                  </Text>
                </View>
              ) : null}
              {shops.closed.map((r) => (
                <RestaurantRow key={r.id} r={r} />
              ))}
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}
