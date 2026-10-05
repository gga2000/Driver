import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Easing, useSharedValue, withTiming } from 'react-native-reanimated';
import type { SharedTrip } from '@driver/contracts';
import { Text, useTheme } from '@driver/ui';
import { type Camera, type LngLat, type Size } from '@/features/track/geo';
import { vehicleKind } from '@/features/track/map/Vehicle';
import { glidePos, planGlide, type Glide } from '@/features/track/motion';
import { BaseMap } from '@/features/track/map/BaseMap';
import { CourierMarker } from '@/features/track/map/Overlay';
import { useT } from '@/lib/i18n';

const AZIZIYAH: Camera = { lat: 32.9085, lng: 45.0655, zoom: 13.5 };
const GLIDE_MS = 4000;

/**
 * The share page's map: the car only (never a stop or an address), gliding between polls, the
 * camera following it. Before the first fix (or outside the sharing window) the town at rest.
 */
export function ShareMap({ trip, stale }: { trip: SharedTrip; stale: boolean }) {
  const theme = useTheme();
  const t = useT();
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const sizeSV = useSharedValue<Size>({ w: 1, h: 1 });
  const glide = useSharedValue<Glide | null>(null);
  const progress = useSharedValue(1);
  const pos = trip.position;
  const key = pos ? `${pos.at.getTime()}:${pos.lat}:${pos.lng}` : 'none';

  const lng = useSharedValue(pos?.lng ?? AZIZIYAH.lng);
  const lat = useSharedValue(pos?.lat ?? AZIZIYAH.lat);
  const zoom = useSharedValue(pos ? 14.6 : AZIZIYAH.zoom);
  const cam = useMemo(() => ({ lng, lat, zoom }), [lng, lat, zoom]);
  const [drawn, setDrawn] = useState<Camera>(pos ? { lat: pos.lat, lng: pos.lng, zoom: 14.6 } : AZIZIYAH);
  const placed = useRef(Boolean(pos));

  useEffect(() => {
    if (!pos) {
      glide.value = null;
      return;
    }
    const target: LngLat & { bearing: null } = { lat: pos.lat, lng: pos.lng, bearing: null };
    const g = glide.value;
    if (!g) {
      glide.value = { kind: 'line', from: target, to: target, fromHeading: 0, toHeading: 0 };
      progress.value = 1;
    } else {
      glide.value = planGlide(null, glidePos(g, null, progress.value), target, GLIDE_MS);
      progress.value = 0;
      progress.value = withTiming(1, { duration: GLIDE_MS, easing: Easing.linear });
    }
    const next = { lat: pos.lat, lng: pos.lng, zoom: 14.6 };
    if (!placed.current) {
      placed.current = true;
      lng.value = next.lng;
      lat.value = next.lat;
      zoom.value = next.zoom;
      setDrawn(next);
    } else {
      const ease = { duration: GLIDE_MS, easing: Easing.inOut(Easing.cubic) };
      lng.value = withTiming(next.lng, ease);
      lat.value = withTiming(next.lat, ease);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    sizeSV.value = { w: width, h: height };
    setSize({ w: width, h: height });
  };

  return (
    <View style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }]} onLayout={onLayout} testID="share-map">
      {size.w > 0 ? (
        <>
          <BaseMap drawn={drawn} cam={cam} size={size} onUserGestureStart={() => undefined} onUserCamera={setDrawn} />
          <CourierMarker cam={cam} size={sizeSV} glide={glide} progress={progress} kind={vehicleKind(trip.vehicleClass ?? 'car')} stale={stale} minutes={null} testID="share-car" />
        </>
      ) : null}
      <Text variant="caption" color="textMuted" style={{ position: 'absolute', right: theme.space[3], bottom: theme.space[8], fontSize: 10, lineHeight: 14, opacity: 0.8 }}>
        © OpenStreetMap
      </Text>
      {!pos ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: '42%', alignSelf: 'center', paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface }}>
          <Text variant="label" color="textMuted">
            {t('share.no_position')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
