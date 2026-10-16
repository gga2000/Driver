import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { BookingView, IntercityDirection, TravellingAs } from '@driver/contracts';
import { Button, Card, Chip, Icon, StatusPill, Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { TRAVELLING_AS, TRAVELLING_AS_ICON, travellingAsLabel, wayKey, windowLabel } from './labels';
import { bookingHref, clockLabel, holdCountdown, type DemandSummary } from './logic';

/**
 * Which way (second polish pass, 2026-10-07): one quiet line, «راجع للعزيزية», with «اقلب» at its
 * end. The far city is picked on the corridor cards under it, so the route isn't said twice.
 */
export function DirectionRow({ direction, onFlip, suggested }: { direction: IntercityDirection; onFlip: () => void; suggested?: boolean }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ gap: theme.space[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Text variant="title" style={{ flex: 1 }} numberOfLines={1} testID="rajaa-route" accessibilityRole="header">
          {t(`rajaa.dir_line.${direction}`)}
        </Text>
        <Pressable
          testID="rajaa-flip"
          accessibilityRole="button"
          accessibilityLabel={t('rajaa.flip')}
          onPress={() => {
            theme.haptic('selection');
            onFlip();
          }}
          hitSlop={4}
          style={({ pressed }) => ({
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[1],
            paddingHorizontal: theme.space[3],
            borderRadius: theme.radius.pill,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: pressed ? theme.colors.accentTint : theme.colors.surface,
          })}
        >
          <Icon name="refresh" size={16} color="accentText" />
          <Text variant="label" weight={700} color="accentText">
            {t('rajaa.flip_short')}
          </Text>
        </Pressable>
      </View>
      {suggested ? (
        <Text variant="footnote" color="textMuted">
          {t('rajaa.suggested_back')}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * «تسافر: نساء · غيّر» (joy r1, audit R-03): asked once on the board, remembered on the device, and
 * sent with every board read so each tile says whether a seat is left *for you*. The chip sits in the
 * route's chip row; tapping it opens `TravellerAsk` again.
 */
export function TravellerChip({ value, onPress }: { value: TravellingAs; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Pressable
      testID="traveller-change"
      accessibilityRole="button"
      accessibilityLabel={`${t('rajaa.traveller_chip', { who: travellingAsLabel(t, value) })}، ${t('rajaa.traveller_change')}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
      })}
    >
      <Icon name={TRAVELLING_AS_ICON[value]} size={18} color="text" />
      <Text variant="label" weight={600} compact>
        {t('rajaa.traveller_chip', { who: travellingAsLabel(t, value) })}
      </Text>
      <Text variant="label" color="textMuted" compact>
        ·
      </Text>
      <Text variant="label" color="accentText" weight={600} compact>
        {t('rajaa.traveller_change')}
      </Text>
    </Pressable>
  );
}

/** The three choices with one line saying why we ask (first visit, or after «غيّر»). */
export function TravellerAsk({ value, onChange }: { value: TravellingAs | null; onChange: (v: TravellingAs) => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ gap: theme.space[2] }} testID="traveller-ask">
      <Text variant="footnote" color="textMuted">
        {t('rajaa.traveller_ask')}
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.space[2] }} accessibilityRole="radiogroup" accessibilityLabel={t('intercity.travelling_as')}>
        {TRAVELLING_AS.map((v) => (
          <Chip key={v} testID={`traveller-${v}`} role="radio" icon={TRAVELLING_AS_ICON[v]} label={travellingAsLabel(t, v)} selected={value === v} style={{ flex: 1 }} onPress={() => onChange(v)} />
        ))}
      </View>
    </View>
  );
}

/** "7 ناس يريدون يرجعون بين 4 و 6 العصر" (or «يسافرون» going out) with «أريد أرجع» / «نبّهني». */
export function DemandBanner({
  demand,
  empty,
  direction,
  onPost,
}: {
  demand: DemandSummary | null;
  /** No car on the board at all. */
  empty: boolean;
  /** «أريد أرجع» on the way back, «نبّهني» going out. */
  direction: IntercityDirection;
  onPost: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const window = demand ? windowLabel(t, demand.windowStart, demand.windowEnd, locale) : '';
  return (
    <Card testID="rajaa-demand-banner" tone="tint" elevation={0} padding={4}>
      <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={600}>
            {demand
              ? demand.posts === 1
                ? t(wayKey('rajaa.demand_banner_one', direction), { window })
                : t(wayKey('rajaa.demand_banner', direction), { n: demand.posts, window })
              : empty
                ? t('rajaa.board_empty_title')
                : t('rajaa.demand_none_title')}
          </Text>
          <Text variant="caption" color="textMuted">
            {demand ? t('rajaa.demand_banner_hint') : t(wayKey('rajaa.board_empty_body', direction))}
          </Text>
        </View>
        <Button testID="rajaa-demand-cta" label={t(wayKey('demand.post_title', direction))} size="sm" variant={empty ? 'primary' : 'secondary'} onPress={onPost} />
      </View>
    </Card>
  );
}

/** The rider's own trip pinned on top of the board: a live hold (finish booking) or the next booked trip. */
export function TripPill({ booking, garage, now }: { booking: BookingView; garage: string; now: Date }) {
  const theme = useTheme();
  const t = useT();
  const held = booking.state === 'held' && booking.heldUntil;
  const left = held ? holdCountdown(booking.heldUntil!, now).label : null;
  return (
    <Card testID="rajaa-trip-pill" padding={3} onPress={() => router.push(bookingHref(booking) as never)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: held ? theme.colors.warningTint : theme.colors.successTint,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={held ? 'clock' : 'check'} size={20} color={held ? 'warningText' : 'successText'} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="label" weight={600}>
            {held ? t('rajaa.my_hold') : t('rajaa.my_trip', { time: clockLabel(booking.departure.departAt), garage })}
          </Text>
          <Text variant="caption" color="textMuted" tabular>
            {held ? `${clockLabel(booking.departure.departAt)} · ${garage}` : `${t('rajaa.pin_label')} · ${booking.pin ?? ''}`}
          </Text>
        </View>
        {held ? <StatusPill size="sm" tone="warning" label={left ?? ''} /> : null}
        <Icon name="chevron-forward" size={18} color="textMuted" />
      </View>
    </Card>
  );
}
