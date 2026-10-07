import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import type { IntercityDirection } from '@driver/contracts';
import { Button, Card, EmptyState, Icon, Skeleton, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useFavourites } from '@/features/ride-habits/queries';
import { RideHabitsStrip } from '@/features/ride-habits/Strip';
import { SectionHeader } from '@/components/SectionHeader';
import { CorridorPicker, DemandBanner, TravellerAsk, TravellerChip, TripPill } from '@/features/rajaa/BoardParts';
import { foldBoard, seatFit } from '@/features/rajaa/fit';
import { baghdadMidnight, boardDays, dayCounts, filterBoard, partsAhead, wishWindow, type BoardDayId, type DayPartId } from '@/features/rajaa/board-filters';
import { CorridorCards, DayChart, DayStrip, dayName, PartChips, partName, WishCard } from '@/features/rajaa/BoardNarrow';
import { DepartureTile, FoldedDeparture } from '@/features/rajaa/DepartureTile';
import { lastKnownLocation } from '@/features/rajaa/location';
import { clockLabel, DEFAULT_DIRECTION, demandBanner, endpoints, flip, groupBoard, haversineM, PRIMARY_CORRIDOR, suggestDirection, publicPlaceName } from '@/features/rajaa/logic';
import { boardTitle, cityName, seatsCount } from '@/features/rajaa/labels';
import { garageName, useActiveBooking, useBoard, useCorridorBoards, useDriverCards, useNetwork, usePostDemand } from '@/features/rajaa/queries';
import { useNow } from '@/features/rajaa/useNow';
import { apiErrorMessage } from '@/lib/api';
import { presetWindow } from '@/features/rajaa/return-trip';
import { dayKey } from '@/features/orders/history';
import { dayLabel } from '@/features/orders/OrderRow';
import { useLocale, useT } from '@/lib/i18n';
import { countKey } from '@/lib/plural';
import { deliveryPointOf, profile, selectedPlace, useProfile } from '@/lib/profile';

/**
 * الرجعة board (customer spec §2). The point of this screen is calm: the rider sees every car that
 * will leave, how full it is, and that a seat booked here is theirs — no running between cars at
 * the garage. Polls every 5 s.
 */
export default function RajaaBoard() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const params = useLocalSearchParams<{ corridor?: string; direction?: string; at?: string }>();
  // «احجز رجعتك» (r2): the board opens on the same weekday and time, until the rider clears it.
  const [presetAt, setPresetAt] = useState<Date | null>(() => (params.at ? new Date(params.at) : null));
  const window = useMemo(() => presetWindow(presetAt), [presetAt]);
  const [corridorId, setCorridorId] = useState(params.corridor || PRIMARY_CORRIDOR);
  const [direction, setDirection] = useState<IntercityDirection>(
    params.direction === 'from_aziziyah' || params.direction === 'to_aziziyah' ? params.direction : DEFAULT_DIRECTION,
  );
  const [suggested, setSuggested] = useState(false);
  const touched = useRef(!!params.direction);
  const now = useNow(15_000);
  const toast = useToast();

  const network = useNetwork();
  // «تسافر:» (r1): remembered on the device; the board marks the seats this rider can't take.
  const prof = useProfile();
  const travellingAs = prof.rajaaTravellingAs;
  const [askTraveller, setAskTraveller] = useState(false);
  // s2/s5: the day and part of the day (a preset return trip opens on its own part).
  // Keyed by the Baghdad day, so the board's read changes only at midnight, not with every tick.
  const day0 = baghdadMidnight(now);
  const days = useMemo(() => boardDays(new Date(day0)), [day0]);
  const span = useMemo(() => ({ from: days[0]!.start, to: days[days.length - 1]!.end }), [days]);
  const [dayId, setDayId] = useState<BoardDayId>('today');
  const [part, setPart] = useState<DayPartId | null>(null);
  const day = days.find((d) => d.id === dayId) ?? days[0]!;
  const board = useBoard({ corridorId, direction, window: window ?? span, ...(travellingAs ? { travellingAs } : {}) });
  // Who drives each car (first name, today's check-in): one read for the whole board (C-19).
  const drivers = useDriverCards((board.data?.departures ?? []).map((d) => d.id));
  const trip = useActiveBooking();
  // Joy l9: the rider's favourite الرجعة drivers wear «سايقك المفضل» on their cars.
  const favs = useFavourites();
  const favDrivers = useMemo(() => new Set((favs.data ?? []).filter((f) => f.kinds.includes('intercity')).map((f) => f.driverId)), [favs.data]);
  const [refreshing, setRefreshing] = useState(false);

  // Auto-suggest the direction once, from the last known position (web: none → default).
  useEffect(() => {
    if (touched.current || !network.data) return;
    let live = true;
    void lastKnownLocation().then((at) => {
      if (!live || touched.current) return;
      const s = suggestDirection(at, network.data.garages);
      if (!s) return;
      const corridor = network.data.corridors.find((c) => c.cityId === s.cityId) ?? network.data.corridors.find((c) => c.id === PRIMARY_CORRIDOR);
      if (corridor) setCorridorId(corridor.id);
      setDirection(s.direction);
      setSuggested(s.direction === 'to_aziziyah' && s.cityId === 'baghdad');
    });
    return () => {
      live = false;
    };
  }, [network.data]);

  const corridors = useMemo(
    () => [...(network.data?.corridors ?? [])].sort((a, b) => Number(b.primary) - Number(a.primary)),
    [network.data],
  );
  const corridor = corridors.find((c) => c.id === corridorId);
  const origin = endpoints(corridor?.cityId ?? 'baghdad', direction).from;
  // A preset return trip («احجز رجعتك») reads its own window; otherwise the board reads three days
  // and the rider narrows it to a day and a part of it (s2, s5).
  const narrowing = !window;
  const live = useMemo(
    () => (board.data && network.data ? groupBoard(board.data.departures, network.data.garages, origin, now).flatMap((g) => g.departures) : []),
    [board.data, network.data, origin, now],
  );
  const counts = useMemo(() => dayCounts(live, days), [live, days]);
  const parts = partsAhead(day, now);
  const shownPart = part && parts.includes(part) ? part : null;
  // s4: going out, the garage nearest the rider's home comes first, with its distance.
  const homePin = useMemo(() => {
    const home = selectedPlace(prof);
    return direction === 'from_aziziyah' && home ? (deliveryPointOf(home).pin ?? null) : null;
  }, [prof, direction]);
  const groups = useMemo(() => {
    if (!board.data || !network.data) return [];
    const shown = narrowing ? filterBoard(board.data.departures, day, shownPart) : board.data.departures;
    const g = groupBoard(shown, network.data.garages, origin, now).map((x) => ({ ...x, km: homePin ? haversineM(homePin, x.garage) / 1000 : null }));
    return homePin ? [...g].sort((a, b) => a.km! - b.km!) : g;
  }, [board.data, network.data, origin, now, narrowing, day, shownPart, homePin]);
  const banner = board.data ? demandBanner(board.data.demand, now) : null;
  const anyCars = groups.some((g) => g.departures.length > 0);
  const when = shownPart ? `${dayName(t, day.id)} ${partName(t, shownPart)}` : dayName(t, day.id);

  // s1: today's cars on each line for the «بغداد» / «الكوت» cards.
  const lineBoards = useCorridorBoards(
    corridors.map((c) => c.id),
    direction,
    span,
  );
  const lines = corridors.map((c, i) => {
    const deps = lineBoards[i]?.data?.departures ?? [];
    const today = network.data ? filterBoard(groupBoard(deps, network.data.garages, endpoints(c.cityId, direction).from, now).flatMap((g) => g.departures), days[0]!, null) : [];
    return { corridor: c, today: today.length, first: [...today].sort((a, b) => a.departAt.getTime() - b.departAt.getTime())[0] ?? null };
  });

  const openDemand = () => router.push({ pathname: '/rajaa/demand', params: { corridor: corridorId, direction } });
  // s7: one tap posts the wish for the day (or part) with what we know: who travels, one seat, the garage.
  const postWish = usePostDemand();
  const wish = wishWindow(day, shownPart, now);
  const sendWish =
    wish && travellingAs
      ? () =>
          postWish.mutate(
            { corridorId, direction, windowStart: wish.start, windowEnd: wish.end, seats: 1, travellingAs, pickup: { kind: 'garage' } },
            {
              onSuccess: () => router.push({ pathname: '/rajaa/demand', params: { corridor: corridorId, direction } }),
              onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }, 5000),
            },
          )
      : null;
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([board.refetch(), trip.refetch()]);
    setRefreshing(false);
  };

  return (
    <Screen
      testID="rajaa-board"
      edges={['bottom']}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
    >
      {/* f3/n1: «العزيزية ← بغداد» going out; «الرجعة» only on the way back. */}
      <Stack.Screen options={{ title: boardTitle(t, corridor?.cityId ?? 'baghdad', direction) }} />
      <View style={{ gap: theme.space[3] }}>
        {network.isPending ? (
          <Skeleton height={60} radius={20} />
        ) : (
          <CorridorPicker
            corridors={corridor ? [corridor] : []}
            corridorId={corridorId}
            direction={direction}
            suggested={suggested}
            leading={travellingAs && !askTraveller ? <TravellerChip value={travellingAs} onPress={() => setAskTraveller(true)} /> : null}
            onCorridor={(id) => {
              touched.current = true;
              setSuggested(false);
              setCorridorId(id);
            }}
            onFlip={() => {
              touched.current = true;
              setSuggested(false);
              setDirection((d) => flip(d));
            }}
          />
        )}
        {!network.isPending ? (
          <CorridorCards
            items={lines}
            value={corridorId}
            onChange={(id) => {
              touched.current = true;
              setSuggested(false);
              setCorridorId(id);
            }}
          />
        ) : null}
        {!travellingAs || askTraveller ? (
          <TravellerAsk
            value={travellingAs}
            onChange={(v) => {
              setAskTraveller(false);
              void profile.setRajaaTravellingAs(v);
            }}
          />
        ) : null}
      </View>

      {window && presetAt ? (
        <Card testID="rajaa-preset" tone="tint" elevation={0} padding={3}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Icon name="clock" size={20} color="text" />
            <Text variant="label" weight={600} style={{ flex: 1 }}>
              {t('rajaa.preset_title', { when: `${dayLabel(t, dayKey(presetAt, now))} ${clockLabel(presetAt)}` })}
            </Text>
            <Button testID="rajaa-preset-clear" size="sm" variant="ghost" label={t('rajaa.preset_clear')} onPress={() => setPresetAt(null)} />
          </View>
        </Card>
      ) : null}

      {trip.data ? <TripPill booking={trip.data} garage={garageName(network.data, trip.data.departure.garageId)} now={now} /> : null}

      {/* Joy r5: a regular الرجعة asking now, and «رحلاتي الثابتة». */}
      <RideHabitsStrip kind="rajaa" />

      {narrowing && board.data ? (
        <View style={{ gap: theme.space[3] }} testID="board-narrow">
          <DayStrip
            days={days}
            counts={counts}
            value={day.id}
            onChange={(id) => {
              setDayId(id);
              setPart(null);
            }}
          />
          <PartChips parts={parts} value={shownPart} onChange={setPart} />
          <DayChart deps={filterBoard(live, day, null)} day={day} part={shownPart} dayLabel={dayName(t, day.id)} />
        </View>
      ) : null}

      {board.isPending || network.isPending ? (
        <View style={{ gap: theme.space[3] }}>
          <Skeleton height={20} width="40%" />
          <Skeleton height={190} radius={20} />
          <Skeleton height={190} radius={20} />
        </View>
      ) : board.isError && !board.data ? (
        <EmptyState
          icon="garage"
          title={t('rajaa.load_failed')}
          body={apiErrorMessage(board.error, t('error.network'), locale)}
          action={{ label: t('action.retry'), onPress: () => void board.refetch() }}
        />
      ) : (
        <>
          {!anyCars ? (
            <>
              <WishCard when={when} seats={seatsCount(t, 1)} busy={postWish.isPending} onWish={sendWish} onMore={openDemand} />
              {banner ? <DemandBanner demand={banner} empty direction={direction} onPost={openDemand} /> : null}
            </>
          ) : null}
          {(anyCars ? groups.filter((g) => g.departures.length > 0) : []).map((g, gi) => {
            const { open, folded } = foldBoard(g.departures, Boolean(travellingAs));
            return (
            <View key={g.garage.id} style={{ gap: theme.space[3] }} testID={`garage-${g.garage.id}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <Icon name="garage" size={20} color="textMuted" />
                <View style={{ flex: 1 }}>
                  <SectionHeader title={publicPlaceName(g.garage.nameAr)} />
                </View>
                {gi === 0 ? <StatusPill size="sm" tone="success" live label={t('rajaa.live')} /> : null}
                <Text variant="caption" color="textMuted" testID={`garage-meta-${g.garage.id}`}>
                  {[
                    g.km !== null ? t('rajaa.garage_km', { km: g.km.toFixed(1) }) : null,
                    g.departures.length === 0 ? null : t(countKey('rajaa.garage_count', g.departures.length), { n: g.departures.length }),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              {/* The calm line (keep list #1), now a caption under the first garage instead of above the route. */}
              {gi === 0 ? (
                <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start', marginTop: -theme.space[1] }}>
                  <Icon name="shield" size={16} color="textMuted" strokeWidth={2} />
                  <Text variant="caption" color="textMuted" style={{ flex: 1 }} testID="rajaa-calm-line">
                    {t('rajaa.calm_line')}
                  </Text>
                </View>
              ) : null}
              {g.departures.length === 0 ? (
                <Card elevation={0} tone="sunken" padding={4}>
                  <Text variant="footnote" color="textMuted">
                    {t('rajaa.garage_empty')}
                  </Text>
                </Card>
              ) : (
                open.map((d) => (
                  <DepartureTile
                    key={d.id}
                    dep={d}
                    now={now}
                    driver={drivers.data?.get(d.id)}
                    fit={travellingAs ? seatFit(d) : undefined}
                    favourite={favDrivers.has(d.driverId)}
                    {...(corridor ? { arrive: { city: cityName(t, endpoints(corridor.cityId, direction).to), travelMin: corridor.travelMin } } : {})}
                    onPress={() => router.push({ pathname: '/rajaa/departure/[id]', params: { id: d.id, corridor: corridorId, direction } })}
                  />
                ))
              )}
              {folded.length > 0 ? (
                <Card elevation={0} tone="sunken" padding={0} testID={`garage-folded-${g.garage.id}`}>
                  {folded.map((d, i) => (
                    <FoldedDeparture key={d.id} dep={d} driver={drivers.data?.get(d.id)} fit={travellingAs ? seatFit(d) : undefined} divider={i < folded.length - 1} />
                  ))}
                </Card>
              ) : null}
            </View>
            );
          })}
          {anyCars ? <DemandBanner demand={banner} empty={false} direction={direction} onPost={openDemand} /> : null}
        </>
      )}

      <Card testID="rajaa-request-entry" padding={4} onPress={() => router.push('/rajaa/request')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Icon name="car" size={24} color="textMuted" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" weight={600}>
              {t('rajaa.request_entry_title')}
            </Text>
            <Text variant="footnote" color="textMuted">
              {t('rajaa.request_entry_body')}
            </Text>
          </View>
          <Icon name="chevron-forward" size={18} color="textMuted" />
        </View>
      </Card>
    </Screen>
  );
}
