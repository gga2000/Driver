import { View } from 'react-native';
import type { DepartureCard, RajaaDriverCard } from '@driver/contracts';
import { Avatar, Card, DepartureTime, Icon, PlateChip, StatusPill, Text, useTheme, type StatusTone } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { apiPhoto } from '@/lib/photo';
import type { SeatFit } from './fit';
import { fitLabel, fitReason, seatsLeftLabel, vehicleDesc } from './labels';
import { clockLabel, fillTone, isBoardingOpen, minutesUntil, type FillTone } from './logic';
import { compactRecord, rodeBefore } from './driver-record';

const FILL_TONE: Record<FillTone, StatusTone> = { open: 'success', filling: 'accent', last: 'warning', full: 'neutral' };

/**
 * One departure on the garage board, compact (joy r7, audit R-05): when it leaves and the hard latest
 * time, the seats left (for you, once you said who travels: r1) and the price on one row; the driver,
 * his car and plate on one line under it; then the pickup options. Two to three cars fit in the first
 * screen. The seat map lives on the seat sheet the tile opens.
 */
export function DepartureTile({
  dep,
  now,
  driver,
  fit,
  onPress,
  favourite,
  selected,
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
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const tone = fillTone(dep.fill);
  const pill = fit ? fitLabel(t, fit) : seatsLeftLabel(t, dep.fill.free);
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
        {/* Time · seats for you · price: the three things a rider scans for. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <DepartureTime testID={`departure-time-${dep.id}`} at={dep.departAt} now={now.getTime()} size="compact" note={boarding ? t('rajaa.boarding_now') : undefined} noteTone={boarding ? 'accent' : 'muted'} countdown={mins > 0 && mins < 120} />
            <Text variant="caption" color="textMuted">
              {t('rajaa.or_full_latest', { time: clockLabel(dep.latestDepartureAt) })}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: theme.space[1] }}>
            <StatusPill size="sm" tone={pillTone} label={pill} />
            <Text variant="bodyStrong" tabular>
              {iqd(dep.seatPriceIqd, { locale })}
            </Text>
          </View>
        </View>

        {/* سايقك on one line: initial (verified ring), first name and car, the plate never clipped (R-08). */}
        <View testID={`departure-driver-${dep.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Avatar name={name} uri={apiPhoto(driver?.photoUrl) ?? undefined} size={36} ring={Boolean(driver?.verifiedTodayAt)} {...(driver?.firstName ? {} : { icon: 'user' as const, tone: 'accent' as const })} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text variant="label" weight={600} numberOfLines={1} style={{ flexShrink: 1 }}>
                {name}
              </Text>
              {driver?.verifiedTodayAt ? <Icon name="shield" size={13} color="successText" strokeWidth={2.2} accessibilityLabel={t('trip.verified_today')} /> : null}
              {favourite ? (
                <StatusPill testID={`departure-fav-${dep.id}`} size="sm" tone="accent" icon="heart" label={t('habits.fav_badge')} />
              ) : rode ? (
                <StatusPill testID={`departure-rode-${dep.id}`} size="sm" tone="success" icon="check" label={rode} />
              ) : null}
            </View>
            {/* His record (x16) on its own line, «★ 4.9 · 120 سفرة», then the car, so neither gets cut. */}
            <View testID={`departure-record-${dep.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              {record?.rating ? <Icon name="star" size={12} color="accent" filled fillColor="accent" /> : null}
              <Text variant="caption" color="textMuted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {[record?.rating, record?.text].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {vehicleDesc(t, dep.vehicle)}
            </Text>
          </View>
          <PlateChip plate={dep.vehicle.plate} accessibilityLabel={t('driver.plate')} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
          <Icon name="map-pin" size={14} color="textMuted" style={{ marginTop: 3 }} />
          <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
            {[
              t('rajaa.pickup_short_garage'),
              hasWay ? `${t('rajaa.pickup_short_way')} ${iqd(wayFrom, { locale, sign: true })}` : null,
              dep.doorPickupsLeft > 0 ? t('rajaa.pickup_short_door') : null,
              dep.frontSeat === 'free' ? t('rajaa.front_free', { amount: amountParam(dep.frontPremiumIqd) }) : null,
              dep.familyOnly ? t('intercity.family_only') : null,
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
