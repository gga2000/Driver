import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';
import type { LatLng, OrderTracking } from '@driver/contracts';
import { color as palette } from '@driver/design-tokens';
import { Avatar, Icon, IconButton, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { season } from '@/lib/season';
import { playCue } from '@/lib/sound';
import { cashAtDoor } from './arrival-logic';
import { rideNearDue } from '@/features/ride/logic';
import { rideNearAt } from '@/features/ride/safety';
import { almostThere, DRIVER_HERE_GAP_MS, momentFeedback, momentsBetween, type MomentSnapshot } from './moments';
import { courierAtDoor, type Phase } from './timeline';
import { apiPhoto } from '@/lib/photo';

export type DoorCardVariant = 'near' | 'door';
/** Every card the moments put over the map: food's two, and a ride's "a minute away" (ride idea d3). */
export type MomentCard = DoorCardVariant | 'ride_near';

/**
 * The tracking screen's moments (maps program SP5b, joy f3): compares each read of the order with the
 * last one and, for every new moment, buzzes and plays its soft cue. Returns which card shows over the
 * map: "almost there" from the first read with him about two minutes out (latched, so ETA or GPS
 * jitter at the line does not blink it), then "at your door" once he pressed "وصلت" at my door —
 * until he hands it over or the customer closes it. Rides: "a minute away" (d3), latched the same
 * way, until he is at the pickup (the driver-here card takes over).
 */
export function useTrackingMoments(
  v: OrderTracking | undefined,
  phase: Phase | null,
  courier: LatLng | null,
  eta: Date | null,
  now: number,
): { card: MomentCard | null; closeCard: () => void } {
  const theme = useTheme();
  const prev = useRef<MomentSnapshot | null>(null);
  const [nearFor, setNearFor] = useState<string | null>(null);
  const [rideNearFor, setRideNearFor] = useState<string | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const ride = Boolean(v && v.order.type === 'ride');
  const orderId = v?.order.id ?? null;
  const myDrop = v?.trip?.stops.find((s) => s.mine && s.type === 'dropoff');
  const card =
    v && phase
      ? almostThere({
          phase,
          food: v.order.type !== 'ride',
          atDoor: courierAtDoor(v),
          courier,
          door: v.dropoff?.pin ?? myDrop?.target ?? null,
          nearAt: myDrop?.courierNearAt ?? null,
          eta,
          now,
        })
      : null;
  const near = card === 'near';
  const door = card === 'door';
  // Joy l2: a courier on the job (the reveal's buzz on food orders).
  const onJob = Boolean(v?.courier && v.trip?.acceptedAt);
  // Ride idea d3: a minute from the pickup, latched per order (the ETA may wobble back over the line);
  // the server's stamp on my pickup (the same moment as the «السايق قريب» push) counts too.
  const nearStamped = rideNearAt(v, phase) !== null;
  const rideNear = Boolean(ride && orderId && (rideNearFor === orderId || nearStamped || rideNearDue({ comingToPickup: phase === 'to_pickup', eta, now })));

  useEffect(() => {
    if (!orderId || !phase) return;
    const next: MomentSnapshot = { orderId, phase, near, door, ride, courier: onJob, rideNear };
    for (const m of momentsBetween(prev.current, next)) {
      // Quiet days (J1a): no sound, no celebratory buzz; the door has no sound of its own (the knock is enough).
      const f = momentFeedback(m, season.current);
      f.haptics.forEach((h, i) => (i === 0 ? theme.haptic(h) : setTimeout(() => theme.haptic(h), i * DRIVER_HERE_GAP_MS)));
      if (f.cue) playCue(f.cue);
    }
    // The card also shows when the screen opens with him already close (the customer tapped the push).
    if (near) setNearFor(orderId);
    if (rideNear) setRideNearFor(orderId);
    prev.current = next;
    // `theme` is stable for the screen's life; re-running on it would replay nothing anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, phase, near, door, ride, onJob, rideNear]);

  const variant: MomentCard | null = door
    ? 'door'
    : orderId && nearFor === orderId && phase === 'on_the_way'
      ? 'near'
      : rideNear && phase === 'to_pickup'
        ? 'ride_near'
        : null;
  const key = variant && orderId ? `${orderId}:${variant}` : null;
  return { card: key && closed !== key ? variant : null, closeCard: () => setClosed(key) };
}

/**
 * Over the map: "الدليفري قريب" with what to have ready, or — once he is at my door — "{name} عند
 * بابك" with the exact cash to hand over (joy f3). Announced at once to screen readers (L-23).
 */
export function AlmostThereCard({
  order,
  variant,
  name,
  photoUrl = null,
  top,
  onClose,
}: {
  order: OrderTracking['order'];
  variant: DoorCardVariant;
  name: string | null;
  photoUrl?: string | null;
  top: number;
  onClose: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const pay = cashAtDoor(order);
  const atDoor = variant === 'door';
  const who = name ?? t('track.courier_fallback');
  const tender = pay.kind === 'cash' && pay.tender ? `\n${t('cashchange.door_tender', { tender: amountParam(pay.tender.tenderIqd), change: amountParam(pay.tender.changeIqd) })}` : '';
  const body =
    pay.kind === 'cash'
      ? `${atDoor ? t('track.door_cash', { amount: amountParam(pay.cashIqd) }) : t('track.cash_ready', { amount: amountParam(pay.cashIqd) })}${tender}`
      : atDoor
        ? t('track.door_paid')
        : t('track.near_paid');
  return (
    <Animated.View
      key={variant}
      testID={atDoor ? 'at-door' : 'almost-there'}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      entering={theme.reduceMotion ? undefined : FadeInDown.duration(260)}
      exiting={theme.reduceMotion ? undefined : FadeOut.duration(180)}
      style={{
        position: 'absolute',
        top,
        left: theme.space[4],
        right: theme.space[4],
        minHeight: 72,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        padding: theme.space[3],
        paddingEnd: theme.space[2],
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: atDoor ? 2 : 1,
        borderColor: theme.colors.accent,
        shadowColor: palette.neutral[1000],
        shadowOpacity: 0.16,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 5,
      }}
    >
      {atDoor ? (
        <Avatar name={who} uri={apiPhoto(photoUrl) ?? undefined} size={44} />
      ) : (
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={pay.kind === 'cash' ? 'cash' : 'home'} size={22} color="accentText" strokeWidth={2.2} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={700} testID="door-card-title">
          {atDoor ? t('track.door_title', { name: who }) : t('track.near_title')}
        </Text>
        <Text variant="footnote" color="textMuted" testID="almost-there-cash">
          {body}
        </Text>
      </View>
      <IconButton icon="x" variant="plain" accessibilityLabel={t('action.close')} onPress={onClose} testID="almost-there-close" />
    </Animated.View>
  );
}
