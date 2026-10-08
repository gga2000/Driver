import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, useSharedValue, withTiming } from 'react-native-reanimated';
import type { OrderTracking } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Icon, ltr, Text, useTheme } from '@driver/ui';
import { useGlide } from './glide';
import { useCityConfig } from './queries';
import { freeCancelLeftSec, mmss, paidWaitPerIqd, searchProgress, searchStage, tooClose, zoneTitle, type SearchStage } from './logic';
import { useRideMemo } from './store';
import { ChangeCreditStrip } from '@/features/track/ChangeCredited';
import { useLocale, useT } from '@/lib/i18n';
import { deliveryPointOf, useProfile } from '@/lib/profile';
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

/** The search wave the ride is in, from the city's dispatch config (nearest → wider → everyone). */
export function useSearchStage(v: OrderTracking | undefined, now: number): SearchStage | null {
  const city = useCityConfig();
  if (!v) return null;
  const vertical = v.trip?.vertical === 'tuktuk' ? 'tuktuk' : 'taxi';
  return searchStage(searchElapsedSec(v, now), city.data?.dispatch?.[vertical]);
}

/** The honest wave line under "ندور لك سايق" (dispatch config waves). */
export function useSearchNote(v: OrderTracking | undefined, now: number): string | null {
  const t = useT();
  const stage = useSearchStage(v, now);
  return stage ? t(STAGE[stage]) : null;
}

/** Where the search is (ride idea m2): which of the three parts, how full, how many drivers asked. */
export function useSearchProgress(v: OrderTracking | undefined, now: number) {
  const city = useCityConfig();
  if (!v) return null;
  const vertical = v.trip?.vertical === 'tuktuk' ? 'tuktuk' : 'taxi';
  const cfg = city.data?.dispatch?.[vertical];
  return searchProgress(searchElapsedSec(v, now), cfg, cfg?.customerFreeCancelAfterSec ?? 180);
}

/** Collapsed-sheet height the search bar adds (the bar row, the honest line, the gap above them). */
export const SEARCH_PROGRESS_H = 58;

/**
 * Ride idea m2: a three-part bar for the search (nearest few, wider, everyone), the current part
 * filling, the time since the request at its end, and the honest line under it — in place of the
 * small «1 من 3» box.
 */
export function SearchProgress({ part, fill, note, seconds }: { part: 1 | 2 | 3; fill: number; note: string | null; seconds: number }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID="ride-search-progress"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={[note, t('ride.search_stage', { n: part }), mmss(seconds)].filter(Boolean).join('، ')}
      style={{ gap: 6 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
          {([1, 2, 3] as const).map((i) => (
            <BarPart key={i} fill={i < part ? 1 : i === part ? fill : 0} live={i === part} testID={`ride-search-part-${i}${i < part ? '-done' : i === part ? '-now' : ''}`} />
          ))}
        </View>
        <Text variant="caption" weight={600} color="textMuted" tabular testID="ride-search-counter">
          {mmss(seconds)}
        </Text>
      </View>
      {note ? (
        <Text variant="caption" color="textMuted" numberOfLines={1} testID="status-note">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

function BarPart({ fill, live, testID }: { fill: number; live: boolean; testID: string }) {
  const theme = useTheme();
  const w = useSharedValue(fill);
  useEffect(() => {
    // The clock ticks each second: glide to the new fill over that second, so the bar moves smoothly.
    w.value = theme.reduceMotion ? fill : withTiming(fill, { duration: 950, easing: Easing.linear });
  }, [fill, w, theme.reduceMotion]);
  const glide = useGlide(w);
  return (
    <View testID={testID} onLayout={glide.onLayout} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: live ? theme.colors.accentTint : theme.colors.border, overflow: 'hidden' }}>
      <Animated.View style={[{ width: '100%', height: 6, borderRadius: 3, backgroundColor: theme.colors.accent }, glide.fill]} />
    </View>
  );
}

/** Collapsed-sheet height the free-cancel chip adds (44 tap target and the gap above it). */
export const FREE_CANCEL_H = 56;

/**
 * Ride idea m4: for the first minute after a driver accepts, cancelling is still free (pricing
 * `rideFreeAfterAcceptSec`); a chip says so and counts the seconds down, and opens the cancel panel.
 */
export function FreeCancelChip({ acceptedAt, now, onPress }: { acceptedAt: Date | null; now: number; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  const left = freeCancelLeftSec(acceptedAt, now);
  if (left === null) return null;
  return (
    <Pressable
      testID="ride-free-cancel"
      accessibilityRole="button"
      accessibilityLabel={t('ride.free_cancel_a11y', { seconds: left })}
      onPress={onPress}
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: theme.colors.successText,
        backgroundColor: pressed ? theme.colors.successTint : theme.colors.surface,
      })}
    >
      <Icon name="x" size={16} color="successText" strokeWidth={2.4} />
      <Text variant="label" weight={600} color="successText">
        {t('ride.free_cancel_chip')}
      </Text>
      <Text variant="label" weight={700} color="successText" tabular testID="ride-free-cancel-seconds">
        {mmss(left)}
      </Text>
    </Pressable>
  );
}

/** Free wait at the pickup (dispatch spec §4: 3 min, then the meter runs for the driver). */
export const FREE_WAIT_SEC = 180;

/**
 * The collapsed header's right side while the driver waits at the pickup: the free wait counting
 * down, then the paid wait counting up (warning tone), so "اطلع" carries a clock. `paid` false (nothing
 * charges waiting yet): "ينتظرك" counting down, then "صارله ينتظرك" counting up — no promised charge.
 */
export function WaitCounter({ arrivedAt, now, paid }: { arrivedAt: Date; now: number; paid: boolean }) {
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
        {t(paid ? (free ? 'ride.wait_free_label' : 'ride.wait_paid_label') : free ? 'ride.wait_label_plain' : 'ride.wait_over_plain')}
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
  const per = paidWaitPerIqd(city.data, vertical);
  return (
    <View testID="ride-wait-note" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}>
      <Icon name="clock" size={18} color="successText" strokeWidth={2.2} />
      <Text variant="footnote" weight={600} color="successText" style={{ flex: 1 }}>
        {per === null ? t('ride.wait_note_plain') : t('ride.wait_note', { amount: amountParam(per) })}
      </Text>
    </View>
  );
}

/**
 * The arrival receipt for a ride (ride idea a1): the fare large (locked at booking) and how it is
 * paid, the change that went to the wallet when the driver had none («الخردة علينا»), the car and its
 * plate (who drove and the minutes are in the line above it), then where from and to — the receipt in one glance, where a food order
 * shows the gate photo.
 */
export function RideArrivalSummary({ view }: { view: OrderTracking }) {
  const theme = useTheme();
  const t = useT();
  const o = view.order;
  const fare = Math.max(0, o.totalIqd - o.tipIqd);
  const cash = o.paymentMethod === 'cash';
  const credited = cash ? (o.changeToWalletIqd ?? 0) : 0;
  const tuktuk = view.courier?.vehicleClass === 'tuktuk' || view.trip?.vertical === 'tuktuk';
  const vehicle = t(tuktuk ? 'ride.vehicle_tuktuk' : 'ride.vehicle_taxi');
  return (
    <View
      testID="ride-arrival-summary"
      style={{ width: '100%', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}
    >
      <View style={{ alignItems: 'center', gap: theme.space[1] }}>
        <Text variant="caption" color="textMuted">
          {t('ride.fare')}
        </Text>
        <Text variant="display" tabular testID="ride-arrival-fare" style={{ fontSize: 40, lineHeight: 52 }}>
          {amountParam(fare)}
          <Text variant="title" color="textMuted">
            {` ${t('quote.currency')}`}
          </Text>
        </Text>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1], paddingHorizontal: theme.space[3], minHeight: 30, borderRadius: 15, backgroundColor: cash ? theme.colors.accentTint : theme.colors.successTint }}
        >
          <Icon name={cash ? 'cash' : 'wallet'} size={15} color={cash ? 'accentText' : 'successText'} strokeWidth={2.2} />
          <Text variant="footnote" weight={600} color={cash ? 'accentText' : 'successText'} testID="ride-arrival-paid">
            {cash ? t('ride.pay_driver_cash', { amount: amountParam(fare) }) : t('ride.paid_wallet')}
          </Text>
        </View>
      </View>
      {credited > 0 ? <ChangeCreditStrip amountIqd={credited} /> : null}
      {/* Who and how long are in the line under «وصلت بالسلامة»; here the car, for a lost item. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[1] }}>
        <Icon name={tuktuk ? 'tuktuk' : 'car'} size={16} color="textMuted" strokeWidth={2} />
        <Text variant="footnote" color="textMuted" numberOfLines={1} style={{ flexShrink: 1 }} testID="ride-arrival-vehicle">
          {[vehicle, view.courier?.plate ? ltr(view.courier.plate) : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={{ height: 1, backgroundColor: theme.colors.border }} />
      <RideRoute view={view} />
    </View>
  );
}

/**
 * Ride idea a3: after a ride to a spot that isn't one of the rider's places, «تحب تسمّي هالمكان؟» in
 * the calm receipt opens the place editor on that pin; once saved it shows with البيت and الشغل and
 * among the smart picks. Only for rides booked on this device (the memo knows what was chosen).
 */
export function NameThisPlace({ view }: { view: OrderTracking }) {
  const theme = useTheme();
  const t = useT();
  const memo = useRideMemo(view.order.id);
  const places = useProfile().places;
  const dest = memo?.dest;
  if (!dest || dest.kind === 'saved' || memo?.toHome) return null;
  const known = places.some((p) => {
    const pin = deliveryPointOf(p).pin;
    return pin ? tooClose({ pin }, dest) : false;
  });
  if (known) return null;
  return (
    <Pressable
      testID="ride-name-place"
      accessibilityRole="button"
      accessibilityLabel={`${t('ride.name_place_title')} ${t('ride.name_place_action')}`}
      onPress={() =>
        router.push({
          pathname: '/places/new',
          params: { from: 'ride', label: 'custom', lat: String(dest.pin.lat), lng: String(dest.pin.lng), zoneId: dest.zoneId },
        })
      }
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        minHeight: 52,
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.lg,
        backgroundColor: pressed ? theme.colors.accentTint : theme.colors.surfaceSunken,
      })}
    >
      <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentTint }}>
        <Icon name="star" size={16} color="accentText" strokeWidth={2.2} />
      </View>
      <Text variant="label" weight={600} style={{ flex: 1 }} numberOfLines={1}>
        {t('ride.name_place_title')}
      </Text>
      <Text variant="label" weight={700} color="accentText">
        {t('ride.name_place_action')}
      </Text>
    </Pressable>
  );
}
