import { View } from 'react-native';
import type { DepartureCard, IntercitySeatId, RajaaDriverCard } from '@driver/contracts';
import { Avatar, Card, DepartureTime, Icon, PlateChip, StatusPill, Text, useTheme, type StatusTone } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { apiPhoto } from '@/lib/photo';
import type { SeatFit } from './fit';
import { fitLabel, fitReason, seatsLeftLabel, vehicleDesc } from './labels';
import { clockLabel, fillTone, isBoardingOpen, minutesUntil, ROW_SEATS, type FillTone } from './logic';
import { arrivalAt } from './board-filters';
import { compactRecord, rodeBefore } from './driver-record';

const FILL_TONE: Record<FillTone, StatusTone> = { open: 'success', filling: 'accent', last: 'warning', full: 'neutral' };

/**
 * One departure on the garage board, compact (joy r7, audit R-05; second polish pass 2026-10-07):
 * the time and the price with the seats left on the top row, one quiet line with the latest it
 * leaves and when it arrives, the driver with his rating, trips, car and a small plate, then the
 * pickup options. The seat map lives on the seat sheet the tile opens.
 */
export function DepartureTile({
  dep,
  now,
  driver,
  fit,
  onPress,
  favourite,
  selected,
  arrive,
}: {
  dep: DepartureCard;
  now: Date;
  driver?: RajaaDriverCard;
  /** Seats for the rider's «تسافر:» choice (r1); absent = not asked yet. */
  fit?: SeatFit;
  onPress?: () => void;
  /** Joy l9: the driver is one of the rider's favourites («سايقك المفضل»). */
  favourite?: boolean;
  /** The car chosen on a regular trip's «أكدها» (joy r5): the tile shows it picked. */
  selected?: boolean;
  /** s6: «توصل بغداد حوالي 9:30» from the corridor's travel time. */
  arrive?: { city: string; travelMin: number };
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const tone = fillTone(dep.fill);
  // b4: every car leaves early when it fills, so the last seat says so.
  const lastSeat = dep.fill.free === 1 && (!fit || fit.kind === 'fits');
  const pill = lastSeat ? t('rajaa.last_seat_go') : fit ? fitLabel(t, fit) : seatsLeftLabel(t, dep.fill.free);
  const pillTone: StatusTone = fit && fit.kind !== 'fits' ? 'neutral' : fit?.kind === 'fits' && fit.n === 1 ? 'warning' : FILL_TONE[tone];
  const mins = minutesUntil(dep.departAt, now);
  const boarding = dep.state === 'boarding' || isBoardingOpen(dep.departAt, now);
  const hasWay = dep.meetingPoints.length > 0;
  const wayFrom = hasWay ? Math.min(...dep.meetingPoints.map((m) => m.feeIqd)) : 0;
  const name = driver?.firstName ?? t('rajaa.driver_unnamed');
  const record = driver ? compactRecord(t, driver.stats) : null;
  // «سافرت وياه قبل» (x17); a favourite already says more, so it shows only one of the two.
  const rode = driver ? rodeBefore(t, driver.stats.ridesWithYou) : null;

  return (
    <Card
      testID={`departure-${dep.id}`}
      padding={4}
      elevation={1}
      tone={selected ? 'tint' : 'surface'}
      onPress={onPress}
      accessibilityLabel={[
        t('intercity.leaves_at_or_full', { time: clockLabel(dep.departAt) }),
        pill,
        name,
        driver?.stats.ratingAvg != null ? t('rajaa.record_rating_a11y', { rating: record?.rating ?? '', n: driver.stats.ratingCount }) : record?.text,
        favourite ? t('habits.fav_badge_long') : rode,
      ]
        .filter(Boolean)
        .join('، ')}
    >
      <View style={{ gap: theme.space[3] }}>
        {/* The two things a rider scans for, big and apart: when it leaves (start) and what a seat
            costs with how many are left (end). Everything else is quieter and below. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
          <View style={{ flex: 1, gap: theme.space[1] }}>
            <DepartureTime testID={`departure-time-${dep.id}`} at={dep.departAt} now={now.getTime()} size="compact" countdown={mins > 0 && mins < 120} />
            {/* b3: the car at the garage loading now pulses. */}
            {boarding ? <StatusPill testID={`departure-loading-${dep.id}`} size="sm" tone="accent" live label={t('rajaa.loading_now')} style={{ alignSelf: 'flex-start' }} /> : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: theme.space[2] }}>
            <Text variant="title" weight={700} tabular testID={`departure-price-${dep.id}`}>
              {iqd(dep.seatPriceIqd, { locale })}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <StatusPill size="sm" tone={pillTone} label={pill} testID={`departure-pill-${dep.id}`} />
              <SeatDots dep={dep} />
            </View>
          </View>
        </View>

        {/* «أو من تكمل · آخر حد 9:55 · توصل حوالي 11:15» on one full-width line (s6). */}
        <Text variant="caption" color="textMuted" tabular testID={`departure-arrive-${dep.id}`}>
          {arrive
            ? t('rajaa.tile_when', { latest: clockLabel(dep.latestDepartureAt), arrive: clockLabel(arrivalAt(dep, arrive.travelMin)) })
            : t('rajaa.or_full_latest', { time: clockLabel(dep.latestDepartureAt) })}
        </Text>

        {/* سايقك: photo (verified ring), name and rating on one line, his trips and the car under it; the plate small at the end. */}
        <View
          testID={`departure-driver-${dep.id}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingTop: theme.space[3], borderTopWidth: 1, borderTopColor: theme.colors.border }}
        >
          <Avatar name={name} uri={apiPhoto(driver?.photoUrl) ?? undefined} size={36} ring={Boolean(driver?.verifiedTodayAt)} {...(driver?.firstName ? {} : { icon: 'user' as const, tone: 'accent' as const })} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View testID={`departure-record-${dep.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text variant="label" weight={700} numberOfLines={1} style={{ flexShrink: 1 }}>
                {name}
              </Text>
              {driver?.verifiedTodayAt ? <Icon name="shield" size={13} color="successText" strokeWidth={2.2} accessibilityLabel={t('trip.verified_today')} /> : null}
              {record?.rating ? (
                <>
                  <Icon name="star" size={13} color="accent" filled fillColor="accent" style={{ marginStart: 2 }} />
                  <Text variant="footnote" weight={700} tabular>
                    {record.rating}
                  </Text>
                </>
              ) : null}
              {favourite ? (
                <StatusPill testID={`departure-fav-${dep.id}`} size="sm" tone="accent" icon="heart" label={t('habits.fav_badge')} />
              ) : rode ? (
                <StatusPill testID={`departure-rode-${dep.id}`} size="sm" tone="success" icon="check" label={rode} />
              ) : null}
            </View>
            <Text variant="caption" color="textMuted" numberOfLines={2}>
              {[record?.text, vehicleDesc(t, dep.vehicle)].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <PlateChip size="sm" plate={dep.vehicle.plate} accessibilityLabel={t('driver.plate')} style={{ alignSelf: 'center' }} />
        </View>

        {/* Where you can get in, and what the car has. Family-only isn't shown: every rider books as a family now (RIDER_TRAVELLING_AS). */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="map-pin" size={14} color="textMuted" />
          <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
            {[
              t('rajaa.pickup_short_garage'),
              hasWay ? `${t('rajaa.pickup_short_way')} ${iqd(wayFrom, { locale, sign: true })}` : null,
              dep.doorPickupsLeft > 0 ? t('rajaa.pickup_short_door') : null,
              dep.frontSeat === 'free' ? t('rajaa.front_free', { amount: amountParam(dep.frontPremiumIqd) }) : null,
              dep.vehicle.ac ? t('rajaa.badge_ac') : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <Icon name="chevron-forward" size={18} color="textMuted" />
        </View>
      </View>
    </Card>
  );
}

/**
 * b2: the car's seats as small dots, row by row as they sit (front first): a free front seat in the
 * accent, other free seats light, taken seats dark, a free seat that isn't for you faint. Fill at a
 * glance; the pill beside it says it in words, so the dots are hidden from screen readers.
 */
function SeatDots({ dep }: { dep: DepartureCard }) {
  const theme = useTheme();
  const rows = ROW_SEATS[dep.vehicle.layout];
  const byId = new Map(dep.seats.map((x) => [x.id, x]));
  // Seen from above with the nose up: the driver's place on the left (an outline), the front seat beside him.
  const order: (IntercitySeatId | 'driver')[][] = [dep.frontSeat !== 'none' ? (['driver', 'front'] as const).slice() : [], rows.middle ?? [], rows.back ?? [], rows.rear ?? []].filter((r) => r.length > 0);
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ gap: 2, alignItems: 'flex-end' }} testID={`departure-dots-${dep.id}`}>
      {order.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 2, direction: 'ltr' }}>
          {row.map((id) => {
            if (id === 'driver') return <View key={id} style={{ width: 9, height: 10, borderRadius: 3, borderWidth: 1, borderColor: theme.colors.border }} />;
            const seat = byId.get(id);
            const free = seat?.state === 'free';
            const color = !seat ? theme.colors.border : free ? (seat.blocked ? theme.colors.border : id === 'front' ? theme.colors.accent : theme.colors.surfaceSunken) : theme.colors.textMuted;
            return <View key={id} style={{ width: 9, height: 10, borderRadius: 3, backgroundColor: color, borderWidth: free && !seat?.blocked && id !== 'front' ? 1 : 0, borderColor: theme.colors.borderStrong, opacity: free && seat?.blocked ? 0.5 : 1 }} />;
          })}
        </View>
      ))}
    </View>
  );
}

/**
 * A full car (or one with nothing left for this rider) folded into one 44-pt line at the bottom of its
 * garage (r7): "6:15 المسا · كاملة · علي", with the reason when it is a seat that doesn't suit you.
 */
export function FoldedDeparture({ dep, driver, fit, divider }: { dep: DepartureCard; driver?: RajaaDriverCard; fit?: SeatFit; divider: boolean }) {
  const theme = useTheme();
  const t = useT();
  const label = fit && fit.kind === 'none_fit' ? fitLabel(t, fit) : t('intercity.full');
  return (
    <View
      testID={`departure-folded-${dep.id}`}
      accessible
      accessibilityLabel={[clockLabel(dep.departAt), label, driver?.firstName].filter(Boolean).join('، ')}
      style={{ minHeight: 44, justifyContent: 'center', paddingVertical: theme.space[2], paddingHorizontal: theme.space[4], borderBottomWidth: divider ? 1 : 0, borderBottomColor: theme.colors.border }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name={fit?.kind === 'none_fit' ? 'seat' : 'car'} size={16} color="textMuted" />
        <Text variant="label" color="textMuted" tabular numberOfLines={1} style={{ flex: 1 }}>
          {[clockLabel(dep.departAt), label, driver?.firstName].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {fit?.kind === 'none_fit' ? (
        <Text variant="caption" color="textMuted" style={{ paddingStart: 24 }}>
          {fitReason(t, fit.reason)}
        </Text>
      ) : null}
    </View>
  );
}
