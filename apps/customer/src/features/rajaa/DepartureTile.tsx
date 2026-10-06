import { useWindowDimensions, View } from 'react-native';
import type { DepartureCard, RajaaDriverCard } from '@driver/contracts';
import { Card, DepartureTime, Icon, SeatMap, StatusPill, Text, useTheme, type SeatInfo, type StatusTone } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import type { SeatFit } from './fit';
import { fitLabel, fitReason, seatsLeftLabel } from './labels';
import { RajaaDriver } from './RajaaDriver';
import { clockLabel, fillTone, isBoardingOpen, minutesUntil, toSeatMap, type FillTone } from './logic';

/** Below this window width the seat map sits under the driver block (R-08: 360 px phones). */
const NARROW_MAX = 380;

const FILL_TONE: Record<FillTone, StatusTone> = { open: 'success', filling: 'accent', last: 'warning', full: 'neutral' };

/** The compact SeatMap scaled down to sit beside the card's text (layout box shrinks with it). */
export function MiniSeatMap({ dep, scale = 0.78 }: { dep: Pick<DepartureCard, 'vehicle' | 'seats'>; scale?: number }) {
  const rows = dep.vehicle.layout === 4 ? 2 : 3;
  // Same geometry as SeatMap's compact mode: 38×40 cells, 6 gap, 18 side and 34/22 top/bottom padding.
  const w = 38 * 3 + 6 * 2 + 18 * 2;
  const h = 34 + rows * 40 + (rows - 1) * 6 + 22;
  return (
    <View style={{ width: w * scale, height: h * scale }} importantForAccessibility="no-hide-descendants">
      <View style={{ position: 'absolute', width: w, height: h, left: -(w - w * scale) / 2, top: -(h - h * scale) / 2, transform: [{ scale }] }}>
        <SeatMap compact legend={false} layout={dep.vehicle.layout} seats={toSeatMap(dep.seats) as SeatInfo[]} selection={[]} />
      </View>
    </View>
  );
}

/**
 * One departure on the garage board: when it leaves (and the hard latest time), how full it is, the
 * car and driver, the seat map, price, front seat and pickup options. Tapping opens seat booking.
 */
export function DepartureTile({ dep, now, driver, fit, onPress }: { dep: DepartureCard; now: Date; driver?: RajaaDriverCard; /** Seats for the rider's «تسافر:» choice (r1); absent = not asked yet. */ fit?: SeatFit; onPress?: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const narrow = useWindowDimensions().width < NARROW_MAX;
  const tone = fillTone(dep.fill);
  // A car with nothing for this rider reads like a full one: grey, not tappable, with the reason.
  const full = tone === 'full' || fit?.kind === 'none_fit' || fit?.kind === 'full';
  const pill = fit ? fitLabel(t, fit) : seatsLeftLabel(t, dep.fill.free);
  const pillTone: StatusTone = fit && fit.kind !== 'fits' ? 'neutral' : fit?.kind === 'fits' && fit.n === 1 ? 'warning' : FILL_TONE[tone];
  const mins = minutesUntil(dep.departAt, now);
  const boarding = dep.state === 'boarding' || isBoardingOpen(dep.departAt, now);
  const hasWay = dep.meetingPoints.length > 0;
  const wayFrom = hasWay ? Math.min(...dep.meetingPoints.map((m) => m.feeIqd)) : 0;

  return (
    <Card
      testID={`departure-${dep.id}`}
      padding={4}
      elevation={full ? 0 : 1}
      tone={full ? 'sunken' : 'surface'}
      onPress={full ? undefined : onPress}
      accessibilityLabel={`${t('intercity.leaves_at_or_full', { time: clockLabel(dep.departAt) })}، ${pill}`}
    >
      <View style={{ gap: theme.space[3] }}>
        {/* Time first: the one thing a rider scans for. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
          <View style={{ flex: 1, gap: theme.space[1] }}>
            {/* The board itself (audit d-2): split-flap time, then "بعد 25 دقيقة" or "الصعود بدأ". */}
            <DepartureTime testID={`departure-time-${dep.id}`} at={dep.departAt} now={now.getTime()} size="card" note={boarding ? t('rajaa.boarding_now') : undefined} noteTone={boarding ? 'accent' : 'muted'} countdown={mins > 0 && mins < 120} />
            <Text variant="footnote" color="textMuted">
              {t('rajaa.or_full_latest', { time: clockLabel(dep.latestDepartureAt) })}
            </Text>
          </View>
          <StatusPill size="sm" tone={pillTone} label={pill} />
        </View>
        {fit?.kind === 'none_fit' ? (
          <Text variant="caption" color="textMuted" testID={`departure-fit-reason-${dep.id}`}>
            {fitReason(t, fit.reason)}
          </Text>
        ) : null}

        {/* R-08: on a narrow phone the seat map goes under the driver, so his plate is never clipped. */}
        <View style={narrow ? { gap: theme.space[3] } : { flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
          {narrow ? null : <MiniSeatMap dep={dep} />}
          <View style={{ flex: narrow ? undefined : 1, minWidth: 0, gap: theme.space[2] }}>
            <RajaaDriver dep={dep} card={driver} testID={`departure-driver-${dep.id}`} />
            <Text variant="bodyStrong" tabular>
              {t('rajaa.price_per_seat', { amount: amountParam(dep.seatPriceIqd) })}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[1] }}>
              {dep.frontSeat !== 'none' ? (
                <StatusPill
                  size="sm"
                  tone={dep.frontSeat === 'free' ? 'accent' : 'neutral'}
                  icon="seat"
                  label={
                    dep.frontSeat === 'free'
                      ? t('rajaa.front_free', { amount: amountParam(dep.frontPremiumIqd) })
                      : dep.frontSeat === 'held'
                        ? t('rajaa.front_held')
                        : t('rajaa.front_taken')
                  }
                />
              ) : null}
              {dep.familyOnly ? <StatusPill size="sm" tone="info" icon="user" label={t('intercity.family_only')} /> : null}
            </View>
          </View>
          {narrow ? (
            <View style={{ alignItems: 'center' }}>
              <MiniSeatMap dep={dep} />
            </View>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap' }}>
          <Icon name="map-pin" size={14} color="textMuted" />
          <Text variant="caption" color="textMuted">
            {[
              t('rajaa.pickup_short_garage'),
              hasWay ? `${t('rajaa.pickup_short_way')} ${iqd(wayFrom, { locale, sign: true })}` : null,
              dep.doorPickupsLeft > 0 ? t('rajaa.pickup_short_door') : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View style={{ flex: 1 }} />
          {!full ? <Icon name="chevron-forward" size={18} color="textMuted" /> : null}
        </View>
      </View>
    </Card>
  );
}
