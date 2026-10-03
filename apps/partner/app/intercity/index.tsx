import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import type { IntercityDirection } from '@driver/contracts';
import { Button, Card, EmptyState, Rule, SegmentedControl, Skeleton, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { DemandRow, MyDepartureCard, RequestCard, RideCard, SectionHead } from '@/features/intercity/BoardParts';
import { cityName } from '@/features/intercity/labels';
import { CORRIDOR_SWITCH, originCity, splitDepartures, type CorridorId } from '@/features/intercity/logic';
import { useDemand, useMyDepartures, useMyRides, useNetwork, useOpenRequests } from '@/features/intercity/queries';
import { useNow } from '@/features/intercity/useNow';
import { useT } from '@/lib/i18n';

/**
 * لوحة الكراج — the intercity driver's home for الرجعة: corridor (عزيزية ⇄ بغداد / الكوت) and side,
 * his upcoming departures (seats, who still needs him), riders waiting per time window (announce
 * against them in one tap), his private request-board rides and the open requests to offer on.
 */
export default function IntercityBoard() {
  const theme = useTheme();
  const t = useT();
  const now = useNow(15_000);
  const network = useNetwork();
  const mine = useMyDepartures();
  const [corridorId, setCorridorId] = useState<CorridorId>('aziziyah_baghdad');
  const [direction, setDirection] = useState<IntercityDirection>('from_aziziyah');
  const corridorCityId = CORRIDOR_SWITCH.find((c) => c.id === corridorId)!.cityId;
  const fromCity = originCity(corridorCityId, direction);
  const demand = useDemand(corridorId, direction);
  const requests = useOpenRequests();
  const rides = useMyRides();

  // Open on the side of his next live departure, once.
  const [aligned, setAligned] = useState(false);
  useEffect(() => {
    if (aligned || !mine.data) return;
    const next = splitDepartures(mine.data, new Date()).live[0];
    if (next && CORRIDOR_SWITCH.some((c) => c.id === next.corridorId)) {
      setCorridorId(next.corridorId as CorridorId);
      setDirection(next.direction);
    }
    setAligned(true);
  }, [aligned, mine.data]);

  const garages = useMemo(() => new Map((network.data?.garages ?? []).map((g) => [g.id, g])), [network.data]);
  const { live, past } = useMemo(() => splitDepartures(mine.data ?? [], now), [mine.data, now]);
  const buckets = useMemo(
    () => (demand.data ?? []).filter((b) => b.windowEnd.getTime() > now.getTime() && b.postedSeats - b.claimedSeats > 0).sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime()),
    [demand.data, now],
  );
  // Posts leaving from this side's garages, plus posts that name no garage (their city is unknown).
  const openPosts = useMemo(
    () => (requests.data ?? []).filter((p) => !p.from.garageId || garages.get(p.from.garageId)?.cityId === fromCity).sort((a, b) => a.when.getTime() - b.when.getTime()),
    [requests.data, garages, fromCity],
  );
  const myRides = rides.data ?? [];

  const announceHref = (at?: Date) =>
    router.push({ pathname: '/intercity/announce', params: { corridor: corridorId, direction, ...(at ? { at: at.toISOString() } : {}) } });

  const refreshing = mine.isRefetching || demand.isRefetching;
  const refresh = () => void Promise.all([mine.refetch(), demand.refetch(), requests.refetch(), rides.refetch()]);

  return (
    <Screen
      testID="intercity-board"
      edges={['bottom']}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      footer={<Button testID="announce-open" label={t('partner.ic_announce_cta')} icon="plus" size="lg" fullWidth onPress={() => announceHref()} />}
    >
      <Stack.Screen options={{ title: t('partner.hub_intercity') }} />

      <View style={{ gap: theme.space[2] }}>
        <SegmentedControl
          accessibilityLabel={t('partner.ic_announce_route')}
          options={CORRIDOR_SWITCH.map((c) => ({ value: c.id, label: t('partner.ic_corridor', { city: cityName(t, c.cityId) }) }))}
          value={corridorId}
          onChange={setCorridorId}
        />
        <SegmentedControl
          options={[
            { value: 'from_aziziyah' as const, label: t('partner.ic_side_from', { city: cityName(t, 'aziziyah') }) },
            { value: 'to_aziziyah' as const, label: t('partner.ic_side_from', { city: cityName(t, corridorCityId) }) },
          ]}
          value={direction}
          onChange={setDirection}
        />
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHead title={t('partner.ic_mine_title')} />
        {!mine.data ? (
          <Skeleton height={150} radius={20} />
        ) : live.length === 0 ? (
          <Card elevation={0} tone="sunken" padding={5}>
            <View style={{ gap: 2 }}>
              <Text variant="bodyStrong">{t('partner.ic_mine_empty_title')}</Text>
              <Text variant="footnote" color="textMuted">
                {t('partner.ic_mine_empty_body')}
              </Text>
            </View>
          </Card>
        ) : (
          live.map((d) => <MyDepartureCard key={d.id} dep={d} garage={garages.get(d.garageId)} now={now} />)
        )}
      </View>

      {myRides.length > 0 ? (
        <View style={{ gap: theme.space[3] }}>
          <SectionHead title={t('partner.ic_rides_title')} />
          {myRides.map((r) => (
            <RideCard key={r.id} ride={r} now={now} />
          ))}
        </View>
      ) : null}

      <View style={{ gap: theme.space[1] }}>
        <SectionHead title={t('partner.ic_demand_title')} sub={t('partner.ic_demand_sub')} />
        <Card padding={0} style={{ paddingHorizontal: theme.space[4], marginTop: theme.space[2] }}>
          {!demand.data ? (
            <View style={{ paddingVertical: theme.space[4] }}>
              <Skeleton lines={2} />
            </View>
          ) : buckets.length === 0 ? (
            <Text variant="footnote" color="textMuted" style={{ paddingVertical: theme.space[4] }}>
              {t('partner.ic_demand_empty')}
            </Text>
          ) : (
            buckets.map((b, i) => (
              <View key={`${b.garageId ?? 'any'}-${b.windowStart.toISOString()}`}>
                {i > 0 ? <Rule /> : null}
                <DemandRow bucket={b} garage={b.garageId ? garages.get(b.garageId) : undefined} cityId={fromCity} onAnnounce={() => announceHref(b.windowStart)} />
              </View>
            ))
          )}
        </Card>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <SectionHead title={t('partner.ic_requests_title')} sub={t('partner.ic_requests_sub')} />
        {!requests.data ? (
          <Skeleton height={110} radius={20} />
        ) : openPosts.length === 0 ? (
          <EmptyState icon="map-pin" title={t('partner.ic_requests_empty')} style={{ paddingVertical: theme.space[4] }} />
        ) : (
          openPosts.map((p) => <RequestCard key={p.id} post={p} now={now} />)
        )}
      </View>

      {past.length > 0 ? (
        <View style={{ gap: theme.space[3] }}>
          <SectionHead title={t('partner.ic_past_title')} />
          {past.map((d) => (
            <MyDepartureCard key={d.id} dep={d} garage={garages.get(d.garageId)} now={now} />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}
