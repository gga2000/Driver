import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import type { NearbyVehicles as NearbyVehiclesData } from '@driver/contracts';
import { color as palette } from '@driver/design-tokens';
import { useTheme } from '@driver/ui';
import { nearestAngle, project, type Size } from '@/features/track/geo';
import type { CameraValues } from '@/features/track/map/types';
import { Vehicle, type VehicleKind } from '@/features/track/map/Vehicle';
import { matchVehicles, type NearbySlot } from './nearby';

/** Free vehicles are drawn smaller than "your" driver. */
const SIZE = 30;
/** One refresh's move takes this long (the refresh is every 10 s). */
const GLIDE_MS = 1_200;

/**
 * Free taxis or tuktuks around the pickup before booking (maps program c10): small top-down vehicles
 * in neutral colours (not the accent of a driver on his way to you), gliding between refreshes, new
 * ones fading in and gone ones fading out. Positions are already blurred by the server.
 */
export function NearbyVehicles({ cam, size, data, kind }: { cam: CameraValues; size: SharedValue<Size>; data: NearbyVehiclesData | undefined; kind: VehicleKind }) {
  const last = useRef<{ kind: VehicleKind; slots: NearbySlot[] }>({ kind, slots: [] });
  const seq = useRef(0);
  // Re-match on a new answer (React Query keeps the same object while nothing changed); a switch to
  // the other kind starts afresh — a taxi never turns into a tuktuk.
  const slots = useMemo(() => {
    if (!data) return [];
    const prev = last.current.kind === kind ? last.current.slots : [];
    return matchVehicles(prev, data.vehicles, () => `v${++seq.current}`);
  }, [data, kind]);
  useEffect(() => {
    last.current = { kind, slots };
  }, [kind, slots]);
  return (
    <>
      {slots.map((s) => (
        <NearbyVehicle key={`${kind}:${s.key}`} cam={cam} size={size} slot={s} kind={kind} />
      ))}
    </>
  );
}

function NearbyVehicle({ cam, size, slot, kind }: { cam: CameraValues; size: SharedValue<Size>; slot: NearbySlot; kind: VehicleKind }) {
  const theme = useTheme();
  const lat = useSharedValue(slot.lat);
  const lng = useSharedValue(slot.lng);
  const heading = useSharedValue(slot.heading ?? 0);
  useEffect(() => {
    const ease = { duration: theme.reduceMotion ? 0 : GLIDE_MS, easing: Easing.inOut(Easing.quad) };
    lat.value = withTiming(slot.lat, ease);
    lng.value = withTiming(slot.lng, ease);
    if (slot.heading !== null) heading.value = withTiming(nearestAngle(heading.value, slot.heading), ease);
  }, [slot.lat, slot.lng, slot.heading, lat, lng, heading, theme.reduceMotion]);
  const place = useAnimatedStyle(() => {
    const p = project(lat.value, lng.value, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size.value);
    return { transform: [{ translateX: p.x - SIZE / 2 }, { translateY: p.y - SIZE / 2 }, { rotate: `${heading.value}deg` }] };
  });
  return (
    <Animated.View
      pointerEvents="none"
      entering={theme.reduceMotion ? undefined : FadeIn.duration(400)}
      exiting={theme.reduceMotion ? undefined : FadeOut.duration(400)}
      style={[styles.anchor, { width: SIZE, height: SIZE }, place]}
      testID="nearby-vehicle"
    >
      <Vehicle kind={kind} size={SIZE} body={theme.colors.surface} ink={theme.colors.text} glass={theme.colors.surfaceSunken} shadow={palette.neutral[1000]} muted={false} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: 0, top: 0 },
});
