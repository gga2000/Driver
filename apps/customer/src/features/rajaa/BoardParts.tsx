import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { BookingView, CorridorView, IntercityDirection, TravellingAs } from '@driver/contracts';
import { Button, Card, Chip, Icon, StatusPill, Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { cityName, TRAVELLING_AS, TRAVELLING_AS_ICON, travellingAsLabel, windowLabel } from './labels';
import { bookingHref, clockLabel, endpoints, holdCountdown, type DemandSummary } from './logic';

/**
 * The route as one row (joy r7, audit R-05): "بغداد ← العزيزية" with the swap button, and the
 * corridors as small chips under it ("بغداد" · "الكوت", the far city named like the garage sign).
 */
export function CorridorPicker({
  corridors,
  corridorId,
  direction,
  onCorridor,
  onFlip,
  suggested,
  leading,
}: {
  /** First in the chip row: the «تسافر:» chip (r1). */
  leading?: ReactNode;
  corridors: readonly CorridorView[];
  corridorId: string;
  direction: IntercityDirection;
  onCorridor: (id: string) => void;
  onFlip: () => void;
  suggested?: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const corridor = corridors.find((c) => c.id === corridorId);
  const e = endpoints(corridor?.cityId ?? 'baghdad', direction);
  return (
    <View style={{ gap: theme.space[2] }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: theme.colors.border,
          paddingVertical: theme.space[2],
          paddingStart: theme.space[4],
          paddingEnd: theme.space[2],
        }}
      >
        <Text variant="title" style={{ flex: 1 }} numberOfLines={1} testID="rajaa-route" accessibilityRole="header">
          <Text variant="title" testID="rajaa-from">
            {cityName(t, e.from)}
          </Text>
          <Text variant="title" color="textMuted">
            {'  ←  '}
          </Text>
          <Text variant="title" testID="rajaa-to">
            {cityName(t, e.to)}
          </Text>
        </Text>
        <Pressable
          testID="rajaa-flip"
          accessibilityRole="button"
          accessibilityLabel={t('rajaa.flip')}
          onPress={() => {
            theme.haptic('selection');
            onFlip();
          }}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: pressed ? theme.colors.accentTint : theme.colors.surfaceSunken,
            alignItems: 'center',
            justifyContent: 'center',
          })}
        >
          <Text variant="title" color="accentText" style={{ lineHeight: 26, transform: [{ rotate: '90deg' }] }}>
            ⇄
          </Text>
        </Pressable>
      </View>
      {corridors.length > 1 || leading ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2], alignItems: 'center' }}>
          {leading}
          {corridors.length > 1
            ? corridors.map((c) => (
                <Chip key={c.id} testID={`corridor-${c.id}`} role="radio" label={t('rajaa.corridor_chip', { city: cityName(t, c.cityId) })} selected={c.id === corridorId} onPress={() => onCorridor(c.id)} />
              ))
            : null}
        </ScrollView>
      ) : null}
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

/** "7 ناس يريدون يرجعون بين 4 و 6 العصر" with the أريد أرجع call to action. */
export function DemandBanner({ demand, empty, onPost }: { demand: DemandSummary | null; /** No car on the board at all. */ empty: boolean; onPost: () => void }) {
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
                ? t('rajaa.demand_banner_one', { window })
                : t('rajaa.demand_banner', { n: demand.posts, window })
              : empty
                ? t('rajaa.board_empty_title')
                : t('rajaa.demand_none_title')}
          </Text>
          <Text variant="caption" color="textMuted">
            {demand ? t('rajaa.demand_banner_hint') : t('rajaa.board_empty_body')}
          </Text>
        </View>
        <Button testID="rajaa-demand-cta" label={t('demand.post_title')} size="sm" variant={empty ? 'primary' : 'secondary'} onPress={onPost} />
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
