import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import type { IntercityDirection } from '@driver/contracts';
import { Card, EmptyState, Icon, Skeleton, StatusPill, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { CorridorPicker, DemandBanner, TravellerPicker, TripPill } from '@/features/rajaa/BoardParts';
import { seatFit } from '@/features/rajaa/fit';
import { DepartureTile } from '@/features/rajaa/DepartureTile';
import { lastKnownLocation } from '@/features/rajaa/location';
import { DEFAULT_DIRECTION, demandBanner, endpoints, flip, groupBoard, PRIMARY_CORRIDOR, suggestDirection, publicPlaceName } from '@/features/rajaa/logic';
import { garageName, useActiveBooking, useBoard, useDriverCards, useNetwork } from '@/features/rajaa/queries';
import { useNow } from '@/features/rajaa/useNow';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { profile, useProfile } from '@/lib/profile';

/**
 * الرجعة board (customer spec §2). The point of this screen is calm: the rider sees every car that
 * will leave, how full it is, and that a seat booked here is theirs — no running between cars at
 * the garage. Polls every 5 s.
 */
export default function RajaaBoard() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const params = useLocalSearchParams<{ corridor?: string; direction?: string }>();
  const [corridorId, setCorridorId] = useState(params.corridor || PRIMARY_CORRIDOR);
  const [direction, setDirection] = useState<IntercityDirection>(
    params.direction === 'from_aziziyah' || params.direction === 'to_aziziyah' ? params.direction : DEFAULT_DIRECTION,
  );
  const [suggested, setSuggested] = useState(false);
  const touched = useRef(!!params.direction);
  const now = useNow(15_000);

  const network = useNetwork();
  // «تسافر:» (r1): remembered on the device; the board marks the seats this rider can't take.
  const travellingAs = useProfile().rajaaTravellingAs;
  const board = useBoard({ corridorId, direction, ...(travellingAs ? { travellingAs } : {}) });
  // Who drives each car (first name, today's check-in): one read for the whole board (C-19).
  const drivers = useDriverCards((board.data?.departures ?? []).map((d) => d.id));
  const trip = useActiveBooking();
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
  const groups = useMemo(
    () => (board.data && network.data ? groupBoard(board.data.departures, network.data.garages, origin, now) : []),
    [board.data, network.data, origin, now],
  );
  const banner = board.data ? demandBanner(board.data.demand, now) : null;
  const anyCars = groups.some((g) => g.departures.length > 0);

  const openDemand = () => router.push({ pathname: '/rajaa/demand', params: { corridor: corridorId, direction } });
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
      <View style={{ gap: theme.space[4] }}>
        <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'flex-start' }}>
          <Icon name="shield" size={20} color="accentText" strokeWidth={2} />
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {t('rajaa.calm_line')}
          </Text>
        </View>
        {network.isPending ? (
          <Skeleton height={140} radius={20} />
        ) : (
          <CorridorPicker
            corridors={corridors}
            corridorId={corridorId}
            direction={direction}
            suggested={suggested}
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
        <TravellerPicker value={travellingAs} onChange={(v) => void profile.setRajaaTravellingAs(v)} />
      </View>

      {trip.data ? <TripPill booking={trip.data} garage={garageName(network.data, trip.data.departure.garageId)} now={now} /> : null}

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
          {banner || !anyCars ? <DemandBanner demand={banner} empty={!anyCars} onPost={openDemand} /> : null}
          {groups.map((g, gi) => (
            <View key={g.garage.id} style={{ gap: theme.space[3] }} testID={`garage-${g.garage.id}`}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <Icon name="garage" size={20} color="textMuted" />
                <View style={{ flex: 1 }}>
                  <SectionHeader title={publicPlaceName(g.garage.nameAr)} />
                </View>
                {gi === 0 ? <StatusPill size="sm" tone="success" live label={t('rajaa.live')} /> : null}
                <Text variant="caption" color="textMuted">
                  {g.departures.length === 1 ? t('rajaa.garage_count_one') : g.departures.length > 1 ? t('rajaa.garage_count', { n: g.departures.length }) : ''}
                </Text>
              </View>
              {g.departures.length === 0 ? (
                <Card elevation={0} tone="sunken" padding={4}>
                  <Text variant="footnote" color="textMuted">
                    {t('rajaa.garage_empty')}
                  </Text>
                </Card>
              ) : (
                g.departures.map((d) => (
                  <DepartureTile
                    key={d.id}
                    dep={d}
                    now={now}
                    driver={drivers.data?.get(d.id)}
                    fit={travellingAs ? seatFit(d) : undefined}
                    onPress={() => router.push({ pathname: '/rajaa/departure/[id]', params: { id: d.id, corridor: corridorId, direction } })}
                  />
                ))
              )}
            </View>
          ))}
          {!banner && anyCars ? <DemandBanner demand={null} empty={false} onPost={openDemand} /> : null}
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
