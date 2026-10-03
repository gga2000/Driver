import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { BookingView, CorridorView, IntercityDirection } from '@driver/contracts';
import { Button, Card, Icon, SegmentedControl, StatusPill, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { cityName, windowLabel } from './labels';
import { bookingHref, clockLabel, endpoints, holdCountdown, type DemandSummary } from './logic';

/**
 * Corridor picker: بغداد ⇄ العزيزية (default) and العزيزية ⇄ الكوت, then the route itself with a
 * flip button. The far city is named, so the segment reads like the garage sign.
 */
export function CorridorPicker({
  corridors,
  corridorId,
  direction,
  onCorridor,
  onFlip,
  suggested,
}: {
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
    <View style={{ gap: theme.space[3] }}>
      {corridors.length > 1 ? (
        <SegmentedControl
          accessibilityLabel={t('home.rajaa_title')}
          value={corridorId}
          onChange={onCorridor}
          options={corridors.map((c) => ({ value: c.id, label: `${cityName(t, c.cityId)} ⇄ ${cityName(t, 'aziziyah')}` }))}
        />
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radius.xl,
          borderWidth: 1,
          borderColor: theme.colors.border,
          paddingVertical: theme.space[3],
          paddingHorizontal: theme.space[4],
        }}
      >
        <View style={{ alignItems: 'center', gap: 3 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: theme.colors.accent }} />
          <View style={{ width: 2, height: 22, backgroundColor: theme.colors.border }} />
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.accent }} />
        </View>
        <View style={{ flex: 1, gap: theme.space[2] }}>
          <View>
            <Text variant="caption" color="textMuted">
              {t('intercity.from')}
            </Text>
            <Text variant="title" testID="rajaa-from">
              {cityName(t, e.from)}
            </Text>
          </View>
          <View>
            <Text variant="caption" color="textMuted">
              {t('intercity.to')}
            </Text>
            <Text variant="title" testID="rajaa-to">
              {cityName(t, e.to)}
            </Text>
          </View>
        </View>
        <Pressable
          testID="rajaa-flip"
          accessibilityRole="button"
          accessibilityLabel={t('rajaa.flip')}
          onPress={() => {
            theme.haptic('selection');
            onFlip();
          }}
          style={({ pressed }) => ({
            width: 48,
            height: 48,
            borderRadius: 24,
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
      {suggested ? (
        <Text variant="footnote" color="textMuted">
          {t('rajaa.suggested_back')}
        </Text>
      ) : null}
    </View>
  );
}

/** "7 ناس يريدون يرجعون بين 4 و 6" with the أريد أرجع call to action. */
export function DemandBanner({ demand, empty, onPost }: { demand: DemandSummary | null; /** No car on the board at all. */ empty: boolean; onPost: () => void }) {
  const theme = useTheme();
  const t = useT();
  const window = demand ? windowLabel(t, demand.windowStart, demand.windowEnd) : '';
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
