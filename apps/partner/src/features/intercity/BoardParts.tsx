import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import type { DemandBucket, DriverDepartureView, DriverRequestRide, GarageView, IntercitySeatId, RequestPostView } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Card, Icon, StatusPill, Text, useTheme, type StatusTone } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { cityName, countdownLabel, demandLine, departureState, rideState, seatsCount, timeWithPeriod, travellingAsLabel, whenLabel } from './labels';
import { clockBare, clockLabel, corridorCity, dayPeriod, destinationCity, openSeats, pendingPickups, riderStatus } from './logic';

/** Section title with an optional one-line explainer. */
export function SectionHead({ title, sub, trailing }: { title: string; sub?: string; trailing?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Text variant="title" style={{ flex: 1 }}>
          {title}
        </Text>
        {trailing}
      </View>
      {sub ? (
        <Text variant="footnote" color="textMuted">
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

const STATE_TONE: Record<DriverDepartureView['state'], StatusTone> = {
  scheduled: 'neutral',
  boarding: 'accent',
  departed: 'info',
  arrived: 'success',
  closed: 'neutral',
  cancelled_by_driver: 'danger',
  cancelled_low_fill: 'danger',
};

export function departureTone(s: DriverDepartureView['state']): StatusTone {
  return STATE_TONE[s];
}

type SeatTone = 'checked' | 'booked' | 'walkup' | 'held' | 'free';

/** One block per seat, in seat-map order: who is in the car at a glance. */
export function SeatStrip({ dep, size = 'md' }: { dep: Pick<DriverDepartureView, 'seats' | 'bookings' | 'walkUps'>; size?: 'sm' | 'md' }) {
  const theme = useTheme();
  const tone = new Map<IntercitySeatId, SeatTone>();
  for (const s of dep.seats) tone.set(s.id, 'free');
  for (const w of dep.walkUps) tone.set(w.seatId, 'walkup');
  for (const b of dep.bookings) {
    if (b.state === 'no_show' || b.state === 'cancelled' || b.state === 'expired') continue;
    const st = riderStatus(b);
    for (const id of b.seatIds) tone.set(id, st === 'checked_in' || st === 'completed' ? 'checked' : st === 'held' ? 'held' : 'booked');
  }
  const c = theme.colors;
  const look: Record<SeatTone, { bg: string; border: string; dashed?: boolean }> = {
    checked: { bg: c.success, border: c.success },
    booked: { bg: c.accent, border: c.accent },
    walkup: { bg: c.info, border: c.info },
    held: { bg: c.warningTint, border: c.warning, dashed: true },
    free: { bg: c.surface, border: c.borderStrong },
  };
  const h = size === 'sm' ? 8 : 10;
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {dep.seats.map((s) => {
        const l = look[tone.get(s.id) ?? 'free'];
        return <View key={s.id} style={{ flex: 1, height: h, borderRadius: h / 2, backgroundColor: l.bg, borderWidth: 1.5, borderColor: l.border, borderStyle: l.dashed ? 'dashed' : 'solid' }} />;
      })}
    </View>
  );
}

/** My departure on the board: time, garage → city, state, countdown, seats, what needs him. */
export function MyDepartureCard({ dep, garage, now }: { dep: DriverDepartureView; garage: GarageView | undefined; now: Date }) {
  const theme = useTheme();
  const t = useT();
  const live = dep.state === 'scheduled' || dep.state === 'boarding';
  const pending = pendingPickups(dep).length;
  const checked = dep.bookings.filter((b) => b.state === 'checked_in').length;
  const to = cityName(t, destinationCity(corridorCity(dep.corridorId), dep.direction));
  return (
    <Card testID={`my-departure-${dep.id}`} onPress={() => router.push(`/intercity/departure/${dep.id}`)} accessibilityLabel={`${timeWithPeriod(t, dep.departAt)} ${garage?.nameAr ?? ''}`} padding={0} style={{ overflow: 'hidden' }}>
      <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
              <Text variant="amount" tabular>
                {clockBare(dep.departAt)}
              </Text>
              <Text variant="label" color="textMuted">
                {t(`partner.ic_period_${dayPeriod(dep.departAt)}` as MessageKey)}
              </Text>
            </View>
            <Text variant="label" weight={600}>
              {t('rajaa.route', { from: garage?.nameAr ?? '', to })}
            </Text>
          </View>
          <StatusPill label={departureState(t, dep.state)} tone={departureTone(dep.state)} live={dep.state === 'boarding' || dep.state === 'departed'} size="sm" />
        </View>
        {live ? (
          <Text variant="footnote" color={dep.departAt.getTime() < now.getTime() ? 'warningText' : 'textMuted'}>
            {`${countdownLabel(t, dep.departAt, now)} · ${t('partner.ic_dep_or_full', { time: clockLabel(dep.latestDepartureAt) })}`}
          </Text>
        ) : null}
        <SeatStrip dep={dep} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space[3], rowGap: 2 }}>
          <Text variant="label" weight={600} tabular>
            {t('intercity.fill', { filled: dep.fill.booked + dep.fill.walkUps, total: dep.fill.seatsTotal })}
          </Text>
          {checked > 0 ? <Meta text={t('partner.ic_fill_checked', { n: checked })} /> : null}
          {dep.fill.walkUps > 0 ? <Meta text={t('partner.ic_fill_walkups', { n: dep.fill.walkUps })} /> : null}
          {dep.fill.held > 0 ? <Meta text={t('partner.ic_fill_held', { n: dep.fill.held })} /> : null}
        </View>
      </View>
      {pending > 0 && live ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], backgroundColor: theme.colors.warningTint }}>
          <Icon name="home" size={18} color="warningText" strokeWidth={2.2} />
          <Text variant="label" weight={600} color="warningText" style={{ flex: 1 }}>
            {pending === 1 ? t('partner.ic_pickups_waiting_one') : t('partner.ic_pickups_waiting_few', { n: pending })}
          </Text>
          <Icon name="chevron-forward" size={16} color="warningText" strokeWidth={2.4} />
        </View>
      ) : null}
    </Card>
  );
}

function Meta({ text }: { text: string }) {
  return (
    <Text variant="footnote" color="textMuted" tabular>
      {`· ${text}`}
    </Text>
  );
}

/** "12 راكب يريدون 7:00–8:00" with where, claimed vs posted, and a one-tap announce. */
export function DemandRow({ bucket, garage, cityId, onAnnounce }: { bucket: DemandBucket; garage: GarageView | undefined; cityId: string; onAnnounce: () => void }) {
  const theme = useTheme();
  const t = useT();
  const waiting = openSeats(bucket);
  const hot = waiting >= 4;
  return (
    <View testID="demand-row" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[3] }}>
      <View style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: hot ? theme.colors.accent : theme.colors.accentTint }}>
        <Text variant="title" weight={700} color={hot ? 'onAccent' : 'accentText'} tabular>
          {String(waiting)}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 0 }}>
        <Text variant="label" weight={600} tabular>
          {demandLine(t, waiting, bucket.windowStart, bucket.windowEnd)}
        </Text>
        <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
          {[garage?.nameAr ?? t('partner.ic_demand_any_garage', { city: cityName(t, cityId) }), bucket.claimedSeats > 0 ? t('partner.ic_demand_claimed', { n: bucket.claimedSeats }) : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Pressable hitSlop={4}
        testID="demand-announce"
        accessibilityRole="button"
        onPress={onAnnounce}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: theme.space[3], height: 36, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.accent, backgroundColor: theme.colors.surface }}
      >
        <Icon name="plus" size={14} color="accentText" strokeWidth={2.6} />
        <Text variant="caption" weight={700} color="accentText">
          {t('partner.ic_demand_announce')}
        </Text>
      </Pressable>
    </View>
  );
}

/** A request-board post for another destination or a private car. */
export function RequestCard({ post, now }: { post: RequestPostView; now: Date }) {
  const theme = useTheme();
  const t = useT();
  const mine = post.offers.find((o) => o.state === 'open');
  return (
    <Card testID={`request-${post.id}`} onPress={() => router.push(`/intercity/request/${post.id}`)} accessibilityLabel={t('rajaa.route', { from: post.from.label, to: post.to.label })}>
      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
            {t('rajaa.route', { from: post.from.label, to: post.to.label })}
          </Text>
          {post.origin === 'stranded' ? <StatusPill label={t('partner.ic_req_stranded')} tone="warning" size="sm" /> : post.privateCar ? <StatusPill label={t('partner.ic_req_private')} tone="info" size="sm" /> : null}
        </View>
        <Text variant="footnote" color="textMuted" tabular>
          {[whenLabel(t, post.when, now), seatsCount(t, post.seats), travellingAsLabel(t, post.travellingAs)].join(' · ')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingTop: 2 }}>
          {mine ? (
            <StatusPill label={t('partner.ic_req_my_offer', { amount: amountParam(mine.priceIqd) })} tone="accent" size="sm" icon="check" />
          ) : post.priceCapIqd !== null ? (
            <StatusPill label={t('partner.ic_req_cap_short', { amount: amountParam(post.priceCapIqd) })} tone="warning" size="sm" />
          ) : (
            <Text variant="caption" color="textMuted">
              {t('partner.ic_req_offers_none')}
            </Text>
          )}
          <View style={{ flex: 1 }} />
          <Text variant="caption" weight={700} color="accentText">
            {t('partner.ic_req_offer_cta')}
          </Text>
          <Icon name="chevron-forward" size={14} color="accentText" strokeWidth={2.6} />
        </View>
      </View>
    </Card>
  );
}

/** A request-board ride the rider gave him: where, when, state, cash. */
export function RideCard({ ride, now }: { ride: DriverRequestRide; now: Date }) {
  const theme = useTheme();
  const t = useT();
  const live = ride.state === 'matched' || ride.state === 'driver_arrived';
  return (
    <Card testID={`ride-${ride.id}`} tone={live ? 'tint' : 'surface'} onPress={() => router.push(`/intercity/request/${ride.id}`)} accessibilityLabel={t('rajaa.route', { from: ride.from.label, to: ride.to.label })}>
      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="car" size={20} color="accentText" />
          <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
            {t('rajaa.route', { from: ride.from.label, to: ride.to.label })}
          </Text>
          <StatusPill label={rideState(t, ride.state)} tone={live ? 'accent' : ride.state === 'completed' ? 'success' : 'neutral'} size="sm" live={live} />
        </View>
        <Text variant="footnote" color="textMuted" tabular>
          {[whenLabel(t, ride.when, now), seatsCount(t, ride.seats), `${amountParam(ride.priceIqd)} ${t('quote.currency')}`].join(' · ')}
        </Text>
      </View>
    </Card>
  );
}
