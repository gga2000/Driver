import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeInUp, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withTiming, ZoomIn } from 'react-native-reanimated';
import type { CourierCard, OrderTracking, VehicleClass } from '@driver/contracts';
import { color as palette } from '@driver/design-tokens';
import { pluralKey, type MessageKey } from '@driver/i18n';
import { Avatar, Icon, IconButton, PlateChip, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';
import { storage } from '@/lib/storage';
import { useSeason } from '@/lib/use-season';
import { REVEAL_SHOW_MS, revealPlays, revealSeenKey } from './moments';
import type { Phase } from './timeline';

const VEHICLE_KEY: Record<VehicleClass, MessageKey> = {
  bike: 'track.vehicle.bike',
  tuktuk: 'track.vehicle.tuktuk',
  car: 'track.vehicle.car',
  suv: 'track.vehicle.suv',
  van: 'track.vehicle.van',
  intercity: 'track.vehicle.intercity',
};

/** Where the reveal may show: rides until he is at the pickup (then «عباس وصل» takes over), food until he has it. */
function revealPhase(phase: Phase | null, ride: boolean): boolean {
  if (ride) return phase === 'to_pickup';
  return phase === 'preparing' || phase === 'to_pickup' || phase === 'at_pickup';
}

/**
 * Joy l2: whether the driver reveal shows now. Decided once per order when the screen first sees
 * him on the job — he accepted while the screen was open, or it was opened within a minute of that —
 * and never again on this phone (stored key). Closes by itself after `REVEAL_SHOW_MS`.
 */
export function useDriverReveal(v: OrderTracking | undefined, phase: Phase | null, now: () => number): { show: boolean; close: () => void } {
  const orderId = v?.order.id ?? null;
  const ride = v?.order.type === 'ride';
  const onJob = Boolean(v?.courier && v.trip?.acceptedAt);
  const eligible = onJob && revealPhase(phase, ride);
  const prev = useRef<{ orderId: string; onJob: boolean } | null>(null);
  const [decision, setDecision] = useState<{ orderId: string; plays: boolean } | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const acceptedAt = v?.trip?.acceptedAt ?? null;

  useEffect(() => {
    const was = prev.current;
    prev.current = orderId ? { orderId, onJob } : null;
    if (!orderId || !eligible || decision?.orderId === orderId) return;
    const liveTransition = was !== null && was.orderId === orderId && !was.onJob;
    void (async () => {
      const key = revealSeenKey(orderId);
      // Unreadable storage: treat as not seen; the stored key is only a "don't repeat" courtesy.
      const seen = (await storage.getItem(key).catch(() => null)) !== null;
      const plays = revealPlays({ seen, liveTransition, acceptedAt, now: now() });
      if (plays) await storage.setItem(key, String(now())).catch(() => undefined);
      setDecision({ orderId, plays });
    })();
    // Decided once per order; later reads change nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, onJob, eligible]);

  const show = Boolean(orderId && eligible && decision?.orderId === orderId && decision.plays && closed !== orderId);
  useEffect(() => {
    if (!show || !orderId) return;
    const id = setTimeout(() => setClosed(orderId), REVEAL_SHOW_MS);
    return () => clearTimeout(id);
  }, [show, orderId]);
  return { show, close: () => setClosed(orderId) };
}

/**
 * «لگينالك سايق» / «هذا دليفري طلبك» (joy l2, research S-2): who is coming, as a warm moment over the
 * map — his approved photo (his initial when none), first name, the car in words, the plate for a
 * ride (the thing to find at the kerb), the rating customers gave him when there are enough, and
 * «متحقق اليوم». The photo pops in with a short saffron sparkle on ordinary days; on a quiet day or
 * with reduce motion it simply appears. Announced at once to screen readers.
 */
export function DriverRevealCard({ courier, ride, top, onClose }: { courier: CourierCard; ride: boolean; top: number; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const today = useSeason();
  const celebrate = today.celebrations && !theme.reduceMotion;
  const name = courier.firstName ?? t(ride ? 'track.driver_fallback' : 'track.courier_fallback');
  const vehicle = courier.vehicleLabel ?? (courier.vehicleClass ? t(VEHICLE_KEY[courier.vehicleClass]) : null);
  const rating = courier.rating !== null && courier.ratingCount > 0 ? t(pluralKey('track.reveal_rating', courier.ratingCount), { rating: courier.rating.toFixed(1), n: courier.ratingCount }) : null;
  return (
    <Animated.View
      testID="driver-reveal"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      entering={theme.reduceMotion ? undefined : FadeInUp.springify().damping(16)}
      exiting={theme.reduceMotion ? undefined : FadeOut.duration(theme.motion.duration.fast)}
      style={{
        position: 'absolute',
        top,
        left: theme.space[4],
        right: theme.space[4],
        gap: theme.space[3],
        padding: theme.space[4],
        borderRadius: theme.radius.xl,
        backgroundColor: theme.colors.surface,
        borderWidth: 1,
        borderColor: theme.colors.border,
        shadowColor: palette.neutral[1000],
        shadowOpacity: 0.18,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 5 },
        elevation: 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
        <View style={{ width: 76, height: 76, alignItems: 'center', justifyContent: 'center' }}>
          {celebrate ? <Sparkle /> : null}
          <Animated.View entering={celebrate ? ZoomIn.springify().damping(12) : undefined}>
            <Avatar name={name} uri={apiPhoto(courier.photoUrl) ?? undefined} size={72} ring={Boolean(courier.verifiedTodayAt)} />
          </Animated.View>
        </View>
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text variant="caption" weight={700} color="liveText" testID="driver-reveal-eyebrow">
            {t(ride ? 'track.reveal_ride' : 'track.reveal_food')}
          </Text>
          <Text variant="heading" numberOfLines={1} testID="driver-reveal-name">
            {name}
          </Text>
          {vehicle ? (
            <Text variant="footnote" color="textMuted" numberOfLines={1} testID="driver-reveal-vehicle">
              {vehicle}
            </Text>
          ) : null}
        </View>
        <View style={{ alignSelf: 'flex-start' }}>
          <IconButton icon="x" variant="plain" accessibilityLabel={t('action.close')} onPress={onClose} testID="driver-reveal-close" />
        </View>
      </View>
      {rating || courier.verifiedTodayAt ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space[2] }}>
          {rating ? (
            <View testID="driver-reveal-rating" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: theme.space[2], paddingVertical: 4, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceSunken }}>
              <Icon name="star" size={14} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
              <Text variant="caption" weight={700} tabular>
                {rating}
              </Text>
            </View>
          ) : null}
          {courier.verifiedTodayAt ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: theme.space[2], paddingVertical: 4, borderRadius: theme.radius.pill, backgroundColor: theme.colors.successTint }}>
              <Icon name="check" size={14} color="successText" strokeWidth={2.4} />
              <Text variant="caption" weight={600} color="successText">
                {t('trip.verified_today')}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {ride && courier.plate ? <PlateChip plate={courier.plate} accessibilityLabel={t('driver.plate')} size="lg" testID="driver-reveal-plate" /> : null}
    </Animated.View>
  );
}

const SPARKS = 8;

/** Eight saffron sparks that fly out from behind the photo once and fade (celebration days only). */
function Sparkle() {
  return (
    <>
      {Array.from({ length: SPARKS }, (_, i) => (
        <Spark key={i} angle={(i / SPARKS) * Math.PI * 2} delay={i % 2 === 0 ? 0 : 60} />
      ))}
    </>
  );
}

function Spark({ angle, delay }: { angle: number; delay: number }) {
  const theme = useTheme();
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay + 120, withTiming(1, { duration: theme.motion.duration.slow, easing: Easing.out(Easing.cubic) }));
  }, [p, delay, theme.motion.duration.slow]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value === 0 ? 0 : 1 - p.value,
    transform: [{ translateX: Math.cos(angle) * 46 * p.value }, { translateY: Math.sin(angle) * 46 * p.value }, { scale: 1 - 0.5 * p.value }],
  }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.deal }, style]} />;
}
