import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { BookingView, IntercityNetwork } from '@driver/contracts';
import { Icon, StatusPill, Text, useTheme, type StatusTone } from '@driver/ui';
import { dayKey } from '@/features/orders/history';
import { dayLabel } from '@/features/orders/OrderRow';
import { useT, type TFn } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { bookingStateLabel, routeLabel, seatsList } from './labels';
import { bookingHref, clockLabel } from './logic';

const TONE: Partial<Record<BookingView['state'], StatusTone>> = { booked: 'accent', checked_in: 'success', held: 'warning', completed: 'success' };

/**
 * "بغداد ← العزيزية": the booking names its corridor's far city; the network is the fallback for an
 * older answer. Never a guessed city: with neither, the row just says «رحلتي».
 */
export function tripRoute(t: TFn, b: BookingView, network: IntercityNetwork | undefined): string {
  const cityId = b.departure.cityId ?? network?.corridors.find((c) => c.id === b.departure.corridorId)?.cityId;
  return cityId ? routeLabel(t, cityId, b.departure.direction) : t('rajaa.trip_title');
}

/**
 * A الرجعة seat in طلباتي and Help (joy r4): the route, the day and time it leaves, the seat, and for a
 * coming trip the PIN (so the list answers "where is my ticket?"); a past trip says how it ended and
 * the points it earned. Opens the pass (or its kept stub), unless `onPress` says otherwise (Help).
 */
export function TripRow({ booking, network, now, divider, onPress, testID }: { booking: BookingView; network: IntercityNetwork | undefined; now: Date; divider?: boolean; onPress?: () => void; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const b = booking;
  const upcoming = b.state === 'booked' || b.state === 'checked_in' || b.state === 'held';
  const when = `${dayLabel(t, dayKey(b.departure.departAt, now))} ${clockLabel(b.departure.departAt)}`;
  const meta = [when, seatsList(t, b.seatIds), upcoming && b.pin ? t('rajaa.trip_row_pin', { pin: b.pin }) : null, !upcoming && b.pointsEarned ? t('rajaa.trip_row_points', { n: amountParam(b.pointsEarned, { sign: true }) }) : null]
    .filter(Boolean)
    .join(' · ');
  const route = tripRoute(t, b, network);
  // o8 (after-order plan, Ali 2026-10-07 «ok to all»): the trips' own colours, as on home — date brown
  // going out, الرجعة gold coming back, the quiet «off» swatch once the trip is over.
  const swatch = !upcoming ? theme.services.off : b.departure.direction === 'to_aziziyah' ? theme.services.back : theme.services.trips;
  return (
    <Pressable
      testID={testID ?? `trip-${b.id}`}
      accessibilityRole="button"
      accessibilityLabel={[route, bookingStateLabel(t, b.state), meta].join('، ')}
      onPress={onPress ?? (() => router.push(bookingHref(b) as never))}
      style={({ pressed }) => ({ flexDirection: 'row', gap: theme.space[3], padding: theme.space[4], minHeight: 64, backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent', borderBottomWidth: divider ? 1 : 0, borderColor: theme.colors.border })}
    >
      <View style={{ width: 48, height: 48, borderRadius: theme.radius.lg, alignItems: 'center', justifyContent: 'center', backgroundColor: swatch.fill }}>
        <Icon name="rajaa" size={26} color={swatch.on} />
      </View>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
            {route}
          </Text>
          <StatusPill size="sm" tone={TONE[b.state] ?? 'neutral'} label={bookingStateLabel(t, b.state)} />
        </View>
        <Text variant="caption" color="textMuted" tabular numberOfLines={2}>
          {meta}
        </Text>
      </View>
    </Pressable>
  );
}
