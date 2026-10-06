import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import type { DemandPickup, IntercityDirection, TravellingAs } from '@driver/contracts';
import { formatHourRange, type MessageKey } from '@driver/i18n';
import { Button, Card, Chip, ChipGroup, CountdownRing, Icon, Skeleton, Stepper, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { HeaderBack } from '@/features/food/HeaderBack';
import { routeLabel, seatsCount, seatsList, TRAVELLING_AS, travellingAsLabel, windowLabel } from '@/features/rajaa/labels';
import { RajaaDriver } from '@/features/rajaa/RajaaDriver';
import { clockLabel, demandWindows, endpoints, holdCountdown, PRIMARY_CORRIDOR, RAJAA_RULES, waitingWithMe, type WindowId, publicPlaceName } from '@/features/rajaa/logic';
import { Section } from '@/features/rajaa/Option';
import { garageName, useBoard, useCancelDemand, useDriverCards, useMyBookings, useMyDemand, useNetwork, usePostDemand } from '@/features/rajaa/queries';
import { useNow } from '@/features/rajaa/useNow';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';

const HOLD_MS = RAJAA_RULES.holdMin * 60_000;

/**
 * "أريد أرجع" (spec §2): post a window, seats, travelling-as and where you'd board. While open the
 * rider sees how many wait with them; when a driver's announcement claims the post it turns into a
 * 10-minute hold with "كمّل الحجز".
 */
export default function DemandScreen() {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const locale = useLocale();
  const params = useLocalSearchParams<{ corridor?: string; direction?: string }>();
  const corridorId = params.corridor || PRIMARY_CORRIDOR;
  const direction: IntercityDirection = params.direction === 'from_aziziyah' ? 'from_aziziyah' : 'to_aziziyah';
  const now = useNow(1000);

  const network = useNetwork();
  const mine = useMyDemand();
  const bookings = useMyBookings();
  const board = useBoard({ corridorId, direction });
  const post = usePostDemand();
  const cancel = useCancelDemand();

  const corridor = network.data?.corridors.find((c) => c.id === corridorId);
  const origin = endpoints(corridor?.cityId ?? 'baghdad', direction).from;
  const garages = useMemo(() => (network.data?.garages ?? []).filter((g) => g.cityId === origin), [network.data, origin]);
  const windows = useMemo(() => demandWindows(new Date()), []);

  const [windowId, setWindowId] = useState<WindowId>('hour');
  const [seats, setSeats] = useState(1);
  const [travellingAs, setTravellingAs] = useState<TravellingAs | null>(null);
  const [garageId, setGarageId] = useState<string>('any');

  // Latest post on this corridor and direction that still matters (open, or claimed with a live hold).
  const posts = (mine.data ?? []).filter((p) => p.corridorId === corridorId && p.direction === direction);
  const open = posts.find((p) => p.state === 'open' && p.windowEnd.getTime() > now.getTime()) ?? null;
  const claimed = posts
    .filter((p) => p.state === 'claimed' && p.bookingId)
    .map((p) => ({ p, b: bookings.data?.find((b) => b.id === p.bookingId) }))
    .find((x) => x.b && (x.b.state === 'held' || x.b.state === 'booked'));
  // R-02: who drives the car that claimed the seat (first name, today's check-in, the plate).
  const cards = useDriverCards(claimed?.b ? [claimed.b.departure.id] : []);
  // Opened from a push there is nothing to go back to: back goes to الرجعة (C-26).
  const back = <Stack.Screen options={{ headerLeft: () => <HeaderBack fallback="/rajaa" /> }} />;

  if (mine.isPending || network.isPending) {
    return (
      <Screen edges={['bottom']}>
        <Skeleton height={160} radius={20} />
        <Skeleton height={220} radius={20} />
      </Screen>
    );
  }

  // ── claimed: a driver announced in the window and a seat is held for this rider ──
  if (claimed?.b) {
    const b = claimed.b;
    const cd = b.state === 'held' && b.heldUntil ? holdCountdown(b.heldUntil, now) : null;
    const place = garageName(network.data, b.departure.garageId);
    const card = cards.data?.get(b.departure.id);
    return (
      <Screen
        testID="rajaa-demand-claimed"
        edges={['bottom']}
        footer={
          <Button
            testID="rajaa-demand-complete"
            size="lg"
            fullWidth
            icon="check"
            label={b.state === 'held' ? t('rajaa.complete_payment') : t('intercity.boarding_pass')}
            onPress={() => router.replace({ pathname: b.state === 'held' ? '/rajaa/booking/[id]' : '/rajaa/pass/[id]', params: { id: b.id } })}
          />
        }
      >
        {back}
        <View style={{ alignItems: 'center', gap: theme.space[3], paddingTop: theme.space[4] }}>
          {cd && !cd.expired ? (
            <CountdownRing mode="accept" format="clock" size={140} strokeWidth={8} urgentMs={60_000} startedAt={b.heldUntil!.getTime() - HOLD_MS} durationMs={HOLD_MS} caption={t('rajaa.hold_left')} />
          ) : (
            <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: theme.colors.successTint, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={44} color="successText" strokeWidth={2.4} />
            </View>
          )}
          <Text variant="heading" align="center" testID="rajaa-claim-title">
            {card?.firstName ? t('demand.claimed_with', { name: card.firstName }) : t('push.demand_claimed.title')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('demand.claimed', { time: clockLabel(b.departure.departAt), place })}
          </Text>
        </View>
        <Card elevation={0} padding={4} testID="rajaa-claim-summary">
          <View style={{ gap: theme.space[2] }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
              <Text variant="heading" tabular>
                {clockLabel(b.departure.departAt)}
              </Text>
              <Text variant="label" color="textMuted" style={{ flex: 1 }}>
                {place}
              </Text>
              <Text variant="bodyStrong" tabular>
                {iqd(b.totalIqd, { locale })}
              </Text>
            </View>
            <Text variant="footnote" color="textMuted">
              {t('rajaa.or_full_latest', { time: clockLabel(b.departure.latestDepartureAt) })}
            </Text>
            <RajaaDriver dep={b.departure} card={card} testID="rajaa-claim-driver" style={{ marginTop: theme.space[2] }} />
            <Text variant="footnote" color="textMuted">
              {t('rajaa.seat_label')}: {seatsList(t, b.seatIds)}
            </Text>
          </View>
        </Card>
      </Screen>
    );
  }

  // ── open: waiting with others ──
  if (open) {
    const others = board.data ? waitingWithMe(open, board.data.demand) : 0;
    return (
      <Screen
        testID="rajaa-demand-posted"
        edges={['bottom']}
        footer={
          <Button
            testID="rajaa-demand-cancel"
            variant="secondary"
            fullWidth
            label={t('rajaa.demand_cancel')}
            loading={cancel.isPending}
            onPress={() =>
              cancel.mutate(
                { postId: open.id },
                { onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }) },
              )
            }
          />
        }
      >
        <View style={{ alignItems: 'center', gap: theme.space[2], paddingTop: theme.space[4] }}>
          <View style={{ width: 112, height: 112, borderRadius: 56, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
            {others > 0 ? (
              <Text variant="numeralMd" color="accentText">
                {others}
              </Text>
            ) : (
              <Icon name="bell" size={44} color="accentText" />
            )}
          </View>
          <Text testID="rajaa-waiting" variant="heading" align="center">
            {others > 0 ? t('rajaa.demand_waiting', { n: others }) : t('rajaa.demand_waiting_alone')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('rajaa.demand_waiting_hint')}
          </Text>
        </View>
        <Card elevation={0} padding={4}>
          <View style={{ gap: theme.space[2] }}>
            <Text variant="caption" color="textMuted">
              {corridor ? routeLabel(t, corridor.cityId, direction) : ''}
            </Text>
            <Text variant="title">{windowLabel(t, open.windowStart, open.windowEnd, locale)}</Text>
            <Text variant="footnote" color="textMuted">
              {seatsCount(t, open.seats)} · {travellingAsLabel(t, open.travellingAs)} · {open.garageId ? garageName(network.data, open.garageId) : t('rajaa.any_garage')}
            </Text>
          </View>
        </Card>
        <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'flex-start' }}>
          <Icon name="bell" size={18} color="textMuted" />
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {t('demand.posted')} {t('rajaa.demand_escalate')}
          </Text>
        </View>
      </Screen>
    );
  }

  // ── the post sheet ──
  const chosen = windows.find((w) => w.id === windowId && w.available) ?? null;
  const submit = () => {
    if (!chosen || !travellingAs) return;
    const pickup: DemandPickup = garageId === 'any' ? { kind: 'garage' } : { kind: 'garage', garageId };
    post.mutate(
      { corridorId, direction, windowStart: chosen.start, windowEnd: chosen.end, seats, travellingAs, pickup },
      { onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }, 5000) },
    );
  };

  return (
    <Screen
      testID="rajaa-demand"
      edges={['bottom']}
      footer={
        <Button testID="rajaa-demand-submit" size="lg" fullWidth icon="bell" label={t('rajaa.demand_submit')} disabled={!chosen || !travellingAs} loading={post.isPending} onPress={submit} />
      }
    >
      <View style={{ gap: theme.space[2] }}>
        <Text variant="caption" color="textMuted">
          {corridor ? routeLabel(t, corridor.cityId, direction) : ''}
        </Text>
        <Text variant="body" color="textMuted">
          {t('rajaa.demand_intro')}
        </Text>
      </View>

      <Section title={t('rajaa.window_q')}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {windows.map((w) => (
            <Chip
              key={w.id}
              testID={`window-${w.id}`}
              role="radio"
              label={w.id === 'afternoon' ? formatHourRange(new Date(w.end.getTime() - 2 * 3600_000), w.end, { locale }) : t(`rajaa.window_${w.id}` as MessageKey)}
              selected={windowId === w.id && w.available}
              disabled={!w.available}
              onPress={() => setWindowId(w.id)}
            />
          ))}
        </View>
        {chosen ? (
          <Text variant="footnote" color="textMuted">
            {windowLabel(t, chosen.start, chosen.end, locale)}
          </Text>
        ) : null}
      </Section>

      <Section title={t('rajaa.seats_q')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Stepper value={seats} min={1} max={4} onChange={setSeats} accessibilityLabel={t('rajaa.seats_q')} />
          <Text variant="label" color="textMuted">
            {seatsCount(t, seats)}
          </Text>
        </View>
      </Section>

      <Section title={t('intercity.travelling_as')} hint={t('rajaa.travelling_as_hint')}>
        <ChipGroup
          required
          items={TRAVELLING_AS.map((v) => ({ id: v, label: travellingAsLabel(t, v), icon: 'user' as const }))}
          value={travellingAs ? [travellingAs] : []}
          onChange={(next) => setTravellingAs((next[0] as TravellingAs | undefined) ?? null)}
        />
      </Section>

      <Section title={t('rajaa.pickup_title')}>
        <ChipGroup
          required
          items={[{ id: 'any', label: t('rajaa.any_garage'), icon: 'garage' as const }, ...garages.map((g) => ({ id: g.id, label: publicPlaceName(g.nameAr) }))]}
          value={[garageId]}
          onChange={(next) => setGarageId(next[0] ?? 'any')}
        />
      </Section>
    </Screen>
  );
}
