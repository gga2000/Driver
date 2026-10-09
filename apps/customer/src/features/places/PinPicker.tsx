import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import type { LatLng } from '@driver/contracts';
import { color as palette } from '@driver/design-tokens';
import type { LabelObstacle } from '@driver/map';
import { Text, useTheme, withAlpha } from '@driver/ui';
import { TILE_SIZE, type Camera, type Size } from '@/features/track/geo';
import { BaseMap } from '@/features/track/map/BaseMap';
import { MAP_CREDIT } from '@/features/track/map/credit';

const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
/** Below this the ring hides under the pin head: not worth drawing. */
const MIN_RING_PX = 20;
/** The centre pin: a round head on a stem, its tip on the spot. */
const PIN_HEAD = 34;
const PIN_STEM = 20;
/**
 * Zone names and landmarks keep clear of the centre pin, tip to head («شارع 30» was drawn under its
 * stem); a landmark may sit just beside its narrow head, where it helps place the pin.
 */
const CENTRE_PIN_AVOID: readonly LabelObstacle[] = [{ centre: true, up: PIN_HEAD + PIN_STEM, halfW: PIN_HEAD / 2 + 6 }];

/** The map camera as shared values (the overlays and the base map read it on the UI thread). */
export function useMapCamera(initial: Camera) {
  const lng = useSharedValue(initial.lng);
  const lat = useSharedValue(initial.lat);
  const zoom = useSharedValue(initial.zoom);
  return useMemo(() => ({ lng, lat, zoom }), [lng, lat, zoom]);
}

/** Metres one screen pixel covers at this latitude and zoom (web mercator, 512 px tiles). */
export function metresPerPixel(lat: number, zoom: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * 2 ** zoom);
}

/** The map credit on every map surface (maps program f12). */
export function MapCredit({ bottom }: { bottom: number }) {
  const theme = useTheme();
  return (
    <Text variant="caption" color="textMuted" style={{ position: 'absolute', right: theme.space[3], bottom: bottom + theme.space[1], fontSize: 10, lineHeight: 14, opacity: 0.8 }}>
      {MAP_CREDIT}
    </Text>
  );
}

/**
 * Pin adjust (customer spec §5, "map pin adjust"; maps program a1 for saved places): the map moves
 * under a fixed centre pin, like the big ride apps. The pin lifts while the map is dragged and drops
 * when it settles; `onCentre` gets the spot under the pin tip. `recentre` moves the camera (my
 * location, a picked zone); with `accuracyM` it also draws how far off the phone's GPS may be around
 * the pin, until the map is moved by hand — so a customer sees when "my location" is only roughly right.
 */
export function PinPicker({
  initial,
  onCentre,
  onMoving,
  recentre,
  tone = 'dropoff',
  testID,
}: {
  initial: LatLng;
  onCentre: (p: LatLng) => void;
  onMoving: (moving: boolean) => void;
  recentre: { pin: LatLng; seq: number; accuracyM?: number } | null;
  tone?: 'pickup' | 'dropoff';
  testID?: string;
}) {
  const theme = useTheme();
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const start: Camera = { lat: initial.lat, lng: initial.lng, zoom: 15.2 };
  const cam = useMapCamera(start);
  const [drawn, setDrawn] = useState<Camera>(start);
  const [ringM, setRingM] = useState<number | null>(null);
  const lift = useSharedValue(0);
  const cbs = useRef({ onCentre, onMoving });
  cbs.current = { onCentre, onMoving };

  useEffect(() => {
    if (!recentre) return;
    const ease = { duration: 500, easing: Easing.inOut(Easing.cubic) };
    const target: Camera = { lat: recentre.pin.lat, lng: recentre.pin.lng, zoom: Math.max(15.5, cam.zoom.value) };
    cam.lng.value = withTiming(target.lng, ease);
    cam.lat.value = withTiming(target.lat, ease);
    cam.zoom.value = withTiming(target.zoom, ease, (done) => {
      if (done) runOnJS(setDrawn)(target);
    });
    setRingM(recentre.accuracyM ?? null);
    cbs.current.onCentre(recentre.pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentre?.seq]);

  const pinStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value * 14 }] }));
  const shadowStyle = useAnimatedStyle(() => ({ opacity: 0.25 + lift.value * 0.2, transform: [{ scale: 1 - lift.value * 0.35 }] }));
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const head = tone === 'pickup' ? theme.colors.success : theme.colors.text;
  const ringPx = ringM === null ? 0 : Math.min(Math.max(size.w, size.h), ringM / metresPerPixel(drawn.lat, drawn.zoom));

  return (
    <View style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden' }]} onLayout={onLayout} testID={testID}>
      {size.w > 0 ? (
        <BaseMap
          drawn={drawn}
          cam={cam}
          size={size}
          labelAvoid={CENTRE_PIN_AVOID}
          onUserGestureStart={() => {
            lift.value = withSpring(1, { damping: 16, stiffness: 260 });
            setRingM(null);
            cbs.current.onMoving(true);
          }}
          onUserCamera={(c) => {
            setDrawn(c);
            lift.value = withSpring(0, { damping: 12, stiffness: 220 });
            cbs.current.onMoving(false);
            cbs.current.onCentre({ lat: Math.round(c.lat * 1e6) / 1e6, lng: Math.round(c.lng * 1e6) / 1e6 });
          }}
        />
      ) : null}
      {/* The fixed centre pin: its tip is the spot. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        {ringPx >= MIN_RING_PX ? (
          <View
            testID="pin-accuracy"
            style={{ position: 'absolute', width: ringPx * 2, height: ringPx * 2, borderRadius: ringPx, backgroundColor: withAlpha(theme.colors.accent, 0.12), borderWidth: 1.5, borderColor: withAlpha(theme.colors.accent, 0.5) }}
          />
        ) : null}
        <Animated.View style={[{ position: 'absolute', width: 14, height: 6, borderRadius: 7, backgroundColor: palette.neutral[1000] }, shadowStyle]} />
        <Animated.View testID="pin-centre" style={[{ alignItems: 'center', marginBottom: 52 }, pinStyle]}>
          <View
            style={{
              width: PIN_HEAD,
              height: PIN_HEAD,
              borderRadius: PIN_HEAD / 2,
              backgroundColor: head,
              borderWidth: 4,
              borderColor: theme.colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: palette.neutral[1000],
              shadowOpacity: 0.22,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 3 },
              elevation: 6,
            }}
          >
            <View style={{ width: 10, height: 10, borderRadius: tone === 'pickup' ? 5 : 2, backgroundColor: theme.colors.surface }} />
          </View>
          <View style={{ width: 3, height: PIN_STEM, borderRadius: 2, backgroundColor: head }} />
        </Animated.View>
        <View style={{ position: 'absolute', width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: withAlpha(head, 0.3) }} />
      </View>
      <MapCredit bottom={0} />
    </View>
  );
}
