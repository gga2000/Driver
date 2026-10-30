import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip, EmptyState, IconButton, Text, useLiteMode, useNetwork, useNow, useTheme } from '@driver/ui';
import { useCatalogRestaurants, useDeliverTo } from '@/features/food/queries';
import { Brief } from '@/features/restaurant-map/Brief';
import { LIVE_MAP, LiveMap } from '@/features/livemap/LiveMap';
import { bubbleIds, fastest, filterPins, headline, homeOf, KIND_CHIPS, livePins, MINUTES_CHIP, TOUR_SEEN_KEY, tourPlan, type KindChip } from '@/features/livemap/logic';
import { FastRail, NothingHere, OrderCard, TourCard } from '@/features/livemap/Panels';
import { useTownNow } from '@/features/livemap/queries';
import { useOrderOnMap } from '@/features/livemap/useOrderOnMap';
import { useT } from '@/lib/i18n';
import { countKey } from '@/lib/plural';
import { useSignedIn } from '@/lib/session';
import { storage } from '@/lib/storage';

const TOP = 112;

/**
 * «العزيزية هسة», the customer's live map (Ali, 2026-10-28: A + the 25-minute chip + the shop tour
 * once). The Golden hour town around their place: kitchens cooking now and the soonest ones carry their
 * name and minutes to the door, the rest are quiet dots; chips for food / tea and coffee / bakeries and
 * «خلال 25 د»; under it the fastest kitchens as photo tiles. With a food order on its way the map shows
 * that order only, with their own courier on the street route. The first time it opens, five shop
 * fronts play as a short tour, then never again by themselves. Phones without the map, and a map that
 * fails, get the restaurant list.
 */
export default function LiveScreen() {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  const lite = useLiteMode();
  const net = useNetwork();
  const signedIn = useSignedIn();
  const now = useNow(true, 30_000);
  const { place, dropoff } = useDeliverTo();
  const { at: homeAt, isHome } = homeOf(dropoff?.pin);
  const query = useCatalogRestaurants();
  const town = useTownNow(homeAt, net.online);
  const { onMap, pending: orderPending } = useOrderOnMap(now);
  const [kind, setKind] = useState<KindChip>('all');
  const [fast, setFast] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [bottomH, setBottomH] = useState(240);
  const [tour, setTour] = useState<{ ids: string[]; i: number } | null>(null);
  const [tourChecked, setTourChecked] = useState(false);

  const all = useMemo(() => livePins(query.data ?? [], town.data), [query.data, town.data]);
  const pins = useMemo(() => filterPins(all, kind, fast), [all, kind, fast]);
  const bubbles = useMemo(() => bubbleIds(pins), [pins]);
  const rail = useMemo(() => fastest(pins), [pins]);
  const top = headline(all, town.data);
  const order = onMap?.order ?? null;

  // C, once: the first time the map opens with kitchens to show (never over an order).
  useEffect(() => {
    if (tourChecked || !query.data || orderPending || order) return;
    setTourChecked(true);
    void storage
      .getItem(TOUR_SEEN_KEY)
      .catch(() => '1')
      .then((seen) => {
        const plan = tourPlan(all);
        if (seen || plan.length < 2) return;
        setTour({ ids: plan.map((p) => p.id), i: 0 });
        setSelectedId(plan[0]!.id);
      });
  }, [tourChecked, query.data, orderPending, order, all]);

  const endTour = () => {
    setTour(null);
    setSelectedId(null);
    void storage.setItem(TOUR_SEEN_KEY, '1').catch(() => undefined);
  };
  const tourNext = () => {
    if (!tour) return;
    if (tour.i + 1 >= tour.ids.length) return endTour();
    setTour({ ...tour, i: tour.i + 1 });
    setSelectedId(tour.ids[tour.i + 1]!);
  };
  const openMenu = (id: string) => {
    if (tour) endTour();
    router.push({ pathname: '/restaurant/[id]', params: { id } });
  };
  const toList = () => router.replace('/restaurants');

  const shown = order ? null : (all.find((p) => p.id === selectedId) ?? null);
  const tourPin = tour ? (all.find((p) => p.id === tour.ids[tour.i]) ?? null) : null;
  const homeLabel = isHome ? (place?.label === 'home' ? t('live_map.home') : t('live_map.your_place')) : null;

  const fallback = (title: string, body?: string) => (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg, paddingTop: insets.top + TOP, justifyContent: 'center' }}>
      <EmptyState icon="map-pin" title={title} {...(body ? { body } : {})} action={{ label: t('restaurant_map.see_list'), onPress: toList }} />
    </View>
  );

  // The top line: what is cooking near them and how many drivers are around; offline, the last picture.
  let line: string;
  if (!net.online) line = t('live_map.offline');
  else if (signedIn && town.data && !town.isError) {
    const parts = [top.cooking ? t(countKey('live_map.cooking', top.cooking), { n: top.cooking }) : t('live_map.quiet')];
    if (top.drivers) parts.push(t(countKey('live_map.drivers', top.drivers), { n: top.drivers }));
    line = parts.join(' · ');
  } else {
    const open = all.filter((p) => p.card.open).length;
    line = t(countKey('live_map.open_now', open), { n: open });
  }

  let bottom: React.ReactNode = null;
  if (onMap) {
    bottom = <OrderCard kitchen={onMap.order.kitchen?.name ?? null} step={onMap.step} minutes={onMap.minutes} onOpen={() => router.push({ pathname: '/order/[id]', params: { id: onMap.order.id } })} />;
  } else if (tour && tourPin) {
    bottom = <TourCard pin={tourPin} index={tour.i} total={tour.ids.length} onMenu={() => openMenu(tourPin.id)} onNext={tourNext} onSkip={endTour} />;
  } else if (shown) {
    const i = Math.max(0, pins.findIndex((p) => p.id === shown.id));
    const step = (d: 1 | -1) => (pins.length ? setSelectedId(pins[(i + d + pins.length) % pins.length]!.id) : undefined);
    bottom = <Brief shop={shown} index={i} total={Math.max(pins.length, 1)} onMenu={() => openMenu(shown.id)} onNext={() => step(1)} onPrev={() => step(-1)} />;
  } else if (query.data && !rail.length) {
    bottom = <NothingHere text={fast ? t('live_map.none_fast', { n: MINUTES_CHIP }) : t('live_map.none_kind')} onAll={() => (setKind('all'), setFast(false))} />;
  } else {
    bottom = <FastRail pins={rail} loading={query.isLoading} onPick={setSelectedId} onAll={toList} />;
  }

  let body: React.ReactNode;
  if (!LIVE_MAP) body = fallback(t('live_map.title'), t('restaurant_map.phone_soon'));
  else if (failed) body = fallback(t('restaurant_map.error'));
  else if (query.isError && !query.data) {
    body = (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, justifyContent: 'center' }}>
        <EmptyState icon="refresh" title={t('restaurant_map.error')} action={{ label: t('restaurant_map.retry'), onPress: () => void query.refetch() }} />
      </View>
    );
  } else {
    body = (
      <>
        <LiveMap
          pins={pins}
          bubbles={bubbles}
          home={order?.door ?? [homeAt.lng, homeAt.lat]}
          homeLabel={order?.door ? t('live_map.door') : homeLabel}
          selectedId={order ? null : selectedId}
          onSelect={(id) => {
            if (tour) endTour();
            setSelectedId(id);
          }}
          order={order}
          topInset={insets.top + TOP}
          bottomInset={bottomH + insets.bottom}
          lite={lite}
          onFail={() => setFailed(true)}
        />
        <View
          pointerEvents="box-none"
          onLayout={(e) => setBottomH(Math.round(e.nativeEvent.layout.height))}
          style={[styles.bottom, { paddingBottom: insets.bottom + theme.space[3], paddingHorizontal: theme.space[3] }]}
        >
          {bottom}
        </View>
      </>
    );
  }

  const chipsShown = LIVE_MAP && !failed && !order && !tour;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      {body}
      <View pointerEvents="box-none" style={[styles.top, { paddingTop: insets.top + theme.space[2], gap: theme.space[2] }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[3] }}>
          <View style={{ borderRadius: 22, backgroundColor: theme.colors.surface, boxShadow: '0 2px 8px rgba(40,24,8,0.18)' }}>
            <IconButton
              icon="arrow-back"
              variant="plain"
              accessibilityLabel={shown && !tour ? t('restaurant_map.back_to_map') : t('action.back')}
              onPress={() => (shown && !tour ? setSelectedId(null) : router.canGoBack() ? router.back() : router.replace('/'))}
              testID="header-back"
            />
          </View>
          <View style={{ flexShrink: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: theme.space[4], paddingVertical: 4, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface, boxShadow: '0 2px 8px rgba(40,24,8,0.18)' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {/* The live dot: cinnamon while the picture is fresh, grey offline. */}
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: net.online ? theme.colors.live : theme.colors.borderStrong }} />
              <Text variant="bodyStrong" weight={700}>
                {t('live_map.title')}
              </Text>
            </View>
            <Text variant="caption" color="textMuted" tabular numberOfLines={1} testID="live-headline">
              {line}
            </Text>
          </View>
        </View>
        {chipsShown ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2], paddingHorizontal: theme.space[3] }}>
            <Chip label={t('live_map.chip_fast', { n: MINUTES_CHIP })} icon="clock" selected={fast} onPress={() => setFast(!fast)} testID="live-chip-fast" />
            {KIND_CHIPS.map((k) => (
              <Chip key={k} label={t(`live_map.chip_${k}`)} role="radio" selected={kind === k} onPress={() => setKind(k)} testID={`live-chip-${k}`} />
            ))}
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
