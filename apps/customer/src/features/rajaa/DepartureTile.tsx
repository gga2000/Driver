import { View } from 'react-native';
import type { DepartureCard } from '@driver/contracts';
import { Avatar, Card, Icon, SeatMap, StatusPill, Text, useTheme, type SeatInfo, type StatusTone } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { driverLabel, seatsLeftLabel, vehicleLine } from './labels';
import { clockLabel, fillTone, isBoardingOpen, minutesUntil, toSeatMap, type FillTone } from './logic';

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
export function DepartureTile({ dep, now, onPress }: { dep: DepartureCard; now: Date; onPress?: () => void }) {
  const theme = useTheme();
  const t = useT();
  const tone = fillTone(dep.fill);
  const full = tone === 'full';
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
      accessibilityLabel={`${t('intercity.leaves_at_or_full', { time: clockLabel(dep.departAt) })}، ${seatsLeftLabel(t, dep.fill.free)}`}
    >
      <View style={{ gap: theme.space[3] }}>
        {/* Time first: the one thing a rider scans for. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
          <View style={{ flex: 1, gap: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2], flexWrap: 'wrap' }}>
              <Text variant="heading" tabular>
                {clockLabel(dep.departAt)}
              </Text>
              <Text variant="footnote" color={boarding ? 'accentText' : 'textMuted'} weight={boarding ? 600 : 400}>
                {boarding ? t('rajaa.boarding_now') : mins > 0 && mins < 120 ? t('rajaa.in_minutes', { n: mins }) : ''}
              </Text>
            </View>
            <Text variant="footnote" color="textMuted">
              {t('rajaa.or_full_latest', { time: clockLabel(dep.latestDepartureAt) })}
            </Text>
          </View>
          <StatusPill size="sm" tone={FILL_TONE[tone]} label={seatsLeftLabel(t, dep.fill.free)} />
        </View>

        <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
          <MiniSeatMap dep={dep} />
          <View style={{ flex: 1, gap: theme.space[2] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Avatar size={28} icon="user" />
              <View style={{ flex: 1 }}>
                <Text variant="label" numberOfLines={1}>
                  {driverLabel(t, dep.driverId)}
                </Text>
                <Text variant="caption" color="textMuted" numberOfLines={2}>
                  {vehicleLine(t, dep.vehicle)}
                </Text>
              </View>
            </View>
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
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap' }}>
          <Icon name="map-pin" size={14} color="textMuted" />
          <Text variant="caption" color="textMuted">
            {[
              t('rajaa.pickup_short_garage'),
              hasWay ? `${t('rajaa.pickup_short_way')} +${amountParam(wayFrom)}` : null,
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
