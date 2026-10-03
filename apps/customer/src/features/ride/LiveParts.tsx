import { View } from 'react-native';
import type { OrderTracking } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Icon, ltr, Text, useTheme } from '@driver/ui';
import { useCityConfig } from './queries';
import { mmss, searchStage, zoneTitle, type SearchStage } from './logic';
import { useRideMemo } from './store';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

const STAGE: Record<SearchStage, MessageKey> = {
  nearest: 'ride.searching_nearest',
  wider: 'ride.searching_wider',
  everyone: 'ride.searching_everyone',
};

/** Seconds the ride has been looking for a driver (server-corrected clock). */
export function searchElapsedSec(v: OrderTracking, now: number): number {
  return Math.max(0, Math.floor((now - v.order.placedAt.getTime()) / 1000));
}

/** The honest wave line under "ندور لك سايق" (dispatch config waves). */
export function useSearchNote(v: OrderTracking | undefined, now: number): string | null {
  const t = useT();
  const city = useCityConfig();
  if (!v) return null;
  const vertical = v.trip?.vertical === 'tuktuk' ? 'tuktuk' : 'taxi';
  return t(STAGE[searchStage(searchElapsedSec(v, now), city.data?.dispatch?.[vertical])]);
}

/** The collapsed header's right side while searching: a live counter in the ETA's place. */
export function SearchCounter({ seconds }: { seconds: number }) {
  const theme = useTheme();
  return (
    <View
      testID="ride-search-counter"
      style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: theme.colors.accentTint, minWidth: 84 }}
    >
      <Icon name="search" size={16} color="accentText" strokeWidth={2.4} />
      <Text variant="amount" tabular color="accentText" style={{ lineHeight: 30 }}>
        {mmss(seconds)}
      </Text>
    </View>
  );
}

/** Free wait at the pickup (dispatch spec §4: 3 min, then the meter runs for the driver). */
export const FREE_WAIT_SEC = 180;

/**
 * The collapsed header's right side while the driver waits at the pickup: the free wait counting
 * down, then the paid wait counting up (warning tone), so "اطلع" carries a clock.
 */
export function WaitCounter({ arrivedAt, now }: { arrivedAt: Date; now: number }) {
  const theme = useTheme();
  const t = useT();
  const waited = Math.max(0, Math.floor((now - arrivedAt.getTime()) / 1000));
  const free = waited < FREE_WAIT_SEC;
  return (
    <View
      testID="ride-wait-counter"
      style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space[3], paddingVertical: theme.space[1], borderRadius: theme.radius.lg, backgroundColor: free ? theme.colors.successTint : theme.colors.warningTint, minWidth: 84 }}
    >
      <Text variant="caption" color={free ? 'successText' : 'warningText'} style={{ lineHeight: 16 }}>
        {t(free ? 'ride.wait_free_label' : 'ride.wait_paid_label')}
      </Text>
      <Text variant="amount" tabular color={free ? 'successText' : 'warningText'} style={{ lineHeight: 30 }}>
        {mmss(free ? FREE_WAIT_SEC - waited : waited - FREE_WAIT_SEC)}
      </Text>
    </View>
  );
}

/** The vehicle the rider asked for, before a driver (and his vehicle) is known. */
export function rideVehicleLabel(v: OrderTracking, t: (k: MessageKey) => string, memoVertical?: string | null): string {
  const asked = v.courier?.vehicleClass === 'tuktuk' || (!v.courier && (v.trip?.vertical ?? memoVertical) === 'tuktuk');
  return t(asked ? 'ride.vehicle_tuktuk' : 'ride.vehicle_taxi');
}

/** "● من … ■ إلى …" in the sheet: the names the rider chose (device memo), else the zones. */
export function RideRoute({ view }: { view: OrderTracking }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const memo = useRideMemo(view.order.id);
  const lang = locale === 'en' ? 'en' : 'ar-IQ';
  const from = memo?.from ?? t('ride.pickup_here');
  const to = memo?.to ?? (view.dropoff ? zoneTitle(view.dropoff.zoneKey, lang) : t('track.destination_pin'));
  const row = (kind: 'pickup' | 'dropoff', label: string, text: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 28 }}>
      <View style={{ width: 16, alignItems: 'center' }}>
        {kind === 'pickup' ? (
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: theme.colors.success, borderWidth: 2, borderColor: theme.colors.successTint }} />
        ) : (
          <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: theme.colors.text }} />
        )}
      </View>
      <Text variant="caption" color="textMuted" style={{ width: 22 }}>
        {label}
      </Text>
      <Text variant="body" weight={500} numberOfLines={1} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
  return (
    <View testID="ride-live-route">
      {row('pickup', t('ride.from'), from)}
      <View style={{ width: 16, alignItems: 'center' }}>
        <View style={{ width: 2, height: 6, borderRadius: 1, backgroundColor: theme.colors.border }} />
      </View>
      {row('dropoff', t('ride.to'), to)}
    </View>
  );
}

/** "السايق ينتظرك 3 دقايق مجاناً…" while the driver waits at the pickup (dispatch spec §4). */
export function WaitNote({ vertical }: { vertical: 'taxi' | 'tuktuk' }) {
  const theme = useTheme();
  const t = useT();
  const city = useCityConfig();
  const per = city.data?.verticals.find((v) => v.vertical === vertical)?.components.find((c) => c.key === 'wait')?.perUnit ?? 250;
  return (
    <View testID="ride-wait-note" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}>
      <Icon name="clock" size={18} color="successText" strokeWidth={2.2} />
      <Text variant="footnote" weight={600} color="successText" style={{ flex: 1 }}>
        {t('ride.wait_note', { amount: amountParam(per) })}
      </Text>
    </View>
  );
}

/**
 * The arrival moment for a ride: where from and to, the fare (locked at booking) and how it is paid,
 * and who drove — the receipt in one glance, where a food order shows the gate photo.
 */
export function RideArrivalSummary({ view }: { view: OrderTracking }) {
  const theme = useTheme();
  const t = useT();
  const o = view.order;
  const fare = Math.max(0, o.totalIqd - o.tipIqd);
  const name = view.courier?.firstName ?? t('track.driver_fallback');
  const tuktuk = view.courier?.vehicleClass === 'tuktuk' || view.trip?.vertical === 'tuktuk';
  const vehicle = t(tuktuk ? 'ride.vehicle_tuktuk' : 'ride.vehicle_taxi');
  return (
    <View
      testID="ride-arrival-summary"
      style={{ width: '100%', gap: theme.space[4], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}
    >
      <RideRoute view={view} />
      <View style={{ height: 1, backgroundColor: theme.colors.border }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="caption" color="textMuted">
            {t('ride.fare')}
          </Text>
          <Text variant="footnote" weight={600} color={o.paymentMethod === 'cash' ? 'accentText' : 'successText'}>
            {o.paymentMethod === 'cash' ? t('ride.pay_driver_cash', { amount: amountParam(fare) }) : t('ride.paid_wallet')}
          </Text>
        </View>
        <Text variant="amount" tabular testID="ride-arrival-fare">
          {amountParam(fare)}
          <Text variant="footnote" color="textMuted">
            {` ${t('quote.currency')}`}
          </Text>
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name={tuktuk ? 'tuktuk' : 'car'} size={18} color="textMuted" strokeWidth={2} />
        <Text variant="footnote" color="textMuted" numberOfLines={1} style={{ flex: 1 }}>
          {t('ride.arrived_with', { name, vehicle: [vehicle, view.courier?.plate ? ltr(view.courier.plate) : null].filter(Boolean).join(' · ') })}
        </Text>
      </View>
    </View>
  );
}
