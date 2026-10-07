import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import type { MessageKey as Key } from '@driver/i18n';
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
import { cravingPicks, cravingRow, doorCravings, usualOrder } from '@/features/doors/cravings';
import { CravingRow } from '@/features/doors/CravingRow';
import { DoorActionCard } from '@/features/doors/DoorActionCard';
import { useDoorFactText } from '@/features/doors/DoorTile';
import { useCravings } from '@/features/doors/queries';
import { TraySheet, type TrayMode } from '@/features/doors/TraySheet';
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
import { itemsSummary } from '@/features/orders/reorder';
import { useReorderFlow } from '@/features/orders/ReorderSheet';
import { useMyPersonId, useOrderHistory } from '@/features/orders/queries';
import { UnmetAsk } from '@/features/search/UnmetAsk';
import { appNow } from '@/lib/dev-clock';
import { useT } from '@/lib/i18n';
import { useSeason } from '@/lib/use-season';

const ART = 112;

/**
 * Behind one food door (ideas d2, k1–k6, i1, p1): the door's colour washing the top, its drawing, name,
 * what it serves and its live fact. Then, calmly: «أحسن 3 هسة» with reasons and «قارن بيناتهم» when there
 * are more than three to choose from (else just the open ones, plainly); «الباقي»; ice cream shops too
 * far to arrive frozen named in one line (melt guard); closed shops behind their shutters with when they
 * open. Sorting and the one question only appear once a door has more than 8 open (k6).
 *
 * Step 3 (2026-10-07): «شنو بخاطرك؟» pictures of the things behind the door (d5, k9, s6, j2) — pick one
 * and the three best shops for it show with that dish and its price; «قهوتك المعتادة» on the coffee
 * door (q1); «اختارلي» on the meals door (k10) and «ضيوف جايين؟» on the sweets door (s2); the cold
 * door says «توصل باردة» (j3); an empty door asks whether to tell the shops (d3, f2).
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
  const [craving, setCraving] = useState<string | null>(null);
  const [tray, setTray] = useState<TrayMode | null>(null);
  const season = useSeason();
  const kinds = useMemo(() => doorCravings(door, appNow(), season), [door, season]);
  const cravings = useCravings(kinds);
  const history = useOrderHistory();
  const me = useMyPersonId();
  const reorder = useReorderFlow();
  const list = restaurants.data;
  const shops = useMemo(() => doorShops(list ?? [], door), [list, door]);
  const tools = showTools(shops.open.length);
  const open = useMemo(
    () => (tools && cuisine ? shops.open.filter((r) => r.tags.includes(cuisine)) : shops.open),
    [shops.open, tools, cuisine],
  );
  const row = useMemo(() => cravingRow(kinds, cravings.data ?? [], list ?? [], door), [kinds, cravings.data, list, door]);
  const chosen = row.find((c) => c.kind.key === craving) ?? null;
  const dishPicks = useMemo(() => (chosen ? cravingPicks(chosen, shops.open) : []), [chosen, shops.open]);
  const picks = useMemo(() => (chosen ? dishPicks : showBest(open.length) ? bestThree(open) : []), [chosen, dishPicks, open]);
  const rest = open.filter((r) => !picks.some((p) => p.shop.id === r.id));
  const usual = door === 'cafe' ? usualOrder(history.data ?? [], list ?? [], door, me) : null;
  const cold = door === 'cold';
  const chosenName = chosen ? t(`food.craving.${chosen.kind.key}` as Key) : '';
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
        <View style={{ gap: theme.space[4] }}>
          <EmptyState icon="bag" title={t('food.empty_door')} body={t('food.empty_door_hint')} />
          <UnmetAsk query={name} />
        </View>
      ) : (
        <>
          {usual ? (
            <DoorActionCard
              testID="door-usual"
              art={DOOR_ART[door]}
              swatch={s}
              title={t('food.usual_title')}
              body={t('food.usual_from', { items: itemsSummary(usual.items, 2), shop: usual.merchantName ?? '' })}
              action={
                <Button
                  testID="door-usual-again"
                  size="sm"
                  label={t('food.usual_again')}
                  loading={reorder.busyOrderId === usual.order.id}
                  onPress={() => void reorder.start(usual)}
                />
              }
            />
          ) : null}

          {door === 'meal' && shops.open.length > 0 ? (
            <DoorActionCard testID="door-pick-for-me" art="tray" swatch={s} title={t('tray.title_meal')} body={t('food.pick_for_me_hint')} onPress={() => setTray('meal')} />
          ) : null}

          <CravingRow row={row} selected={chosen?.kind.key ?? null} onSelect={setCraving} swatch={s} />

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

          {chosen ? (
            <BestThree
              picks={dishPicks}
              title={dishPicks.length >= 3 ? t('food.craving_best', { name: chosenName }) : t('food.craving_where', { name: chosenName })}
              action={{ label: t('food.craving_clear'), onPress: () => setCraving(null) }}
              testID="craving-best"
              cold={cold}
            />
          ) : picks.length > 0 ? (
            <BestThree picks={picks} cold={cold} />
          ) : null}

          {door === 'sweet' && shops.open.length > 0 ? (
            <DoorActionCard testID="door-guests" art="baklava" swatch={s} title={t('food.guests_title')} body={t('food.guests_hint')} onPress={() => setTray('guests')} />
          ) : null}

          {rest.length > 0 ? (
            <View style={{ gap: theme.space[3] }} testID="door-open">
              <SectionHeader big title={picks.length > 0 ? t('food.rest') : t('food.open_now')} />
              {rest.map((r) => (
                <RestaurantRow key={r.id} r={r} cold={cold} />
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
      {tray ? <TraySheet mode={tray} shops={shops.open} visible onClose={() => setTray(null)} /> : null}
      {reorder.sheet}
    </Screen>
  );
}
