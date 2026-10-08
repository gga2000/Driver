import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import type { MessageKey as Key } from '@driver/i18n';
import { StatusBar } from 'expo-status-bar';
import { RefreshControl, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MessageKey } from '@driver/i18n';
import {
  Button,
  Chip,
  EmptyState,
  Icon,
  QueryBoundary,
  Text,
  useTheme,
} from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { BestThree } from '@/features/doors/BestThree';
import { cravingPicks, cravingRow, doorCravings, usualOrder } from '@/features/doors/cravings';
import { CravingRow } from '@/features/doors/CravingRow';
import { DoorActionCard } from '@/features/doors/DoorActionCard';
import { DoorHero, doorHeroHeight } from '@/features/doors/DoorHero';
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
import { motifForKitchen } from '@/features/food/food-art';
import { distinctPhotos } from '@/features/food-landing/photos';
import { cuisineOptions } from '@/features/food/list';
import { RestaurantRow, RestaurantRowSkeleton } from '@/features/food/RestaurantRow';
import { useRestaurants } from '@/features/home/queries';
import { itemsSummary } from '@/features/orders/reorder';
import { useReorderFlow } from '@/features/orders/ReorderSheet';
import { useMyPersonId, useOrderHistory } from '@/features/orders/queries';
import { UnmetAsk } from '@/features/search/UnmetAsk';
import { appNow } from '@/lib/dev-clock';
import { useLocale, useT } from '@/lib/i18n';
import { useSeason } from '@/lib/use-season';

/**
 * Behind one food door (ideas d2, k1–k6, i1, p1): the door's own photo at the top under a date-brown
 * shade with its name, what it serves and its live fact (Ali 2026-10-08, concept A «واجهة المحل»). Then, calmly: «أحسن 3 هسة» with reasons and «قارن بيناتهم» when there
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
  const locale = useLocale();
  const say = useDoorFactText();
  const params = useLocalSearchParams<{ door?: string }>();
  const door = isFoodDoor(params.door) ? params.door : 'meal';
  const insets = useSafeAreaInsets();
  const { width, height: screenH } = useWindowDimensions();
  const restaurants = useRestaurants();
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
  // The pictures row and «قهوتك المعتادة» are extras: a failed read hides them (react-query retries on its
  // own); the shops below are the way to choose and carry their own retry.
  const row = useMemo(() => cravingRow(kinds, cravings.isError ? [] : (cravings.data ?? []), list ?? [], door), [kinds, cravings.isError, cravings.data, list, door]);
  const chosen = row.find((c) => c.kind.key === craving) ?? null;
  const dishPicks = useMemo(() => (chosen ? cravingPicks(chosen, shops.open) : []), [chosen, shops.open]);
  const picks = useMemo(() => (chosen ? dishPicks : showBest(open.length) ? bestThree(open) : []), [chosen, dishPicks, open]);
  const rest = open.filter((r) => !picks.some((p) => p.shop.id === r.id));
  const restPhotos = useMemo(() => distinctPhotos(rest.map((r) => motifForKitchen(r.tags, r.cuisine))), [rest]);
  const closedPhotos = useMemo(() => distinctPhotos(shops.closed.map((r) => motifForKitchen(r.tags, r.cuisine))), [shops.closed]);
  const usual = door === 'cafe' && !history.isError ? usualOrder(history.data ?? [], list ?? [], door, me) : null;
  const cold = door === 'cold';
  const chosenName = chosen ? t(`food.craving.${chosen.kind.key}` as Key) : '';
  const fact = list ? say(doorFact(list, door)) : null;
  const name = t(`food.door.${door}`);
  const refresh = async () => {
    setRefreshing(true);
    await restaurants.refetch();
    setRefreshing(false);
  };

  return (
    <Screen
      testID={`door-${door}-screen`}
      padded={false}
      edges={[]}
      contentStyle={{ paddingTop: 0, paddingBottom: 0, gap: 0 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
    >
      <StatusBar style="light" />
      <DoorHero door={door} fact={fact} open={shops.open.length > 0} height={doorHeroHeight(width, screenH) + insets.top} top={insets.top} />

      {/* The cream sheet rides up over the photo's foot, as on /food. */}
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
      <View aria-hidden accessible={false} style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: theme.colors.border, marginBottom: -theme.space[3] }} />
      {/* W8: no network, a slow answer or a server failure each say so in plain words with a retry; a list
          already on the phone stays, with a line saying when it was fetched. */}
      <QueryBoundary
        query={restaurants}
        size="inline"
        locale={locale}
        testID="door-shops-state"
        style={{ gap: theme.space[6] }}
        skeleton={
          <View style={{ gap: theme.space[3] }}>
            <RestaurantRowSkeleton />
            <RestaurantRowSkeleton />
            <RestaurantRowSkeleton />
          </View>
        }
      >
        {() => (shops.open.length + shops.closed.length + shops.melted.length === 0 ? (
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
            <DoorActionCard testID="door-pick-for-me" art="tray" title={t('tray.title_meal')} body={t('food.pick_for_me_hint')} onPress={() => setTray('meal')} />
          ) : null}

          <CravingRow row={row} selected={chosen?.kind.key ?? null} onSelect={setCraving} />

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
              look="photo"
            />
          ) : picks.length > 0 ? (
            <BestThree picks={picks} cold={cold} look="photo" />
          ) : null}

          {door === 'sweet' && shops.open.length > 0 ? (
            <DoorActionCard testID="door-guests" art="baklava" title={t('food.guests_title')} body={t('food.guests_hint')} onPress={() => setTray('guests')} />
          ) : null}

          {rest.length > 0 ? (
            <View style={{ gap: theme.space[3] }} testID="door-open">
              <SectionHeader big title={picks.length > 0 ? t('food.rest') : t('food.open_now')} />
              {rest.map((r, i) => (
                <RestaurantRow key={r.id} r={r} cold={cold} {...(restPhotos[i] !== undefined ? { photo: restPhotos[i] } : {})} />
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
              {shops.closed.map((r, i) => (
                <RestaurantRow key={r.id} r={r} {...(closedPhotos[i] !== undefined ? { photo: closedPhotos[i] } : {})} />
              ))}
            </View>
          ) : null}
        </>
      ))}
      </QueryBoundary>
      </View>
      {tray ? <TraySheet mode={tray} shops={shops.open} visible onClose={() => setTray(null)} /> : null}
      {reorder.sheet}
    </Screen>
  );
}
