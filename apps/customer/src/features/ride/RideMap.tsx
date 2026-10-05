import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import type { LatLng, NearbyVehicles as NearbyVehiclesData } from '@driver/contracts';
import { Text, useTheme, withAlpha } from '@driver/ui';
import { fitCamera, type Camera, type LngLat, type Size } from '@/features/track/geo';
import type { Glide } from '@/features/track/motion';
import { BaseMap } from '@/features/track/map/BaseMap';
import { PlacePin, RadarPulse, RouteLine } from '@/features/track/map/Overlay';
import type { VehicleKind } from '@/features/track/map/Vehicle';
import { NearbyVehicles } from './NearbyVehicles';
import { color as palette } from '@driver/design-tokens';

const AZIZIYAH: Camera = { lat: 32.9085, lng: 45.0655, zoom: 13.5 };

function useCamera(initial: Camera) {
  const lng = useSharedValue(initial.lng);
  const lat = useSharedValue(initial.lat);
  const zoom = useSharedValue(initial.zoom);
  return useMemo(() => ({ lng, lat, zoom }), [lng, lat, zoom]);
}

/**
 * The choose-ride map: pickup (green) and destination (ink) pins, the straight dashed line between
 * them (no road router yet, so it stays honest), framed between the top bar and the panel. Optional
 * radar at the pickup while a driver is being found, and the free vehicles around it (maps program c10).
 */
export function RideMap({
  pickup,
  dropoff,
  pickupLabel,
  dropoffLabel,
  topInset,
  bottomInset,
  radar = false,
  nearby,
  testID,
}: {
  pickup: LatLng;
  dropoff: LatLng | null;
  pickupLabel: string;
  dropoffLabel: string;
  topInset: number;
  bottomInset: number;
  radar?: boolean;
  /** Free vehicles of the chosen kind around the pickup (blurred by the server). */
  nearby?: { data: NearbyVehiclesData | undefined; kind: VehicleKind };
  testID?: string;
}) {
  const theme = useTheme();
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const sizeSV = useSharedValue<Size>({ w: 1, h: 1 });
  const cam = useCamera(AZIZIYAH);
  const [drawn, setDrawn] = useState<Camera>(AZIZIYAH);
  const placed = useRef(false);

  // A line from the pickup with no courier glide: RouteLine draws start → waypoints.
  const glide = useSharedValue<Glide | null>(null);
  const progress = useSharedValue(1);
  const start = useSharedValue<LngLat | null>(pickup);
  const waypoints = useSharedValue<LngLat[]>(dropoff ? [dropoff] : []);
  useEffect(() => {
    start.value = pickup;
    waypoints.value = dropoff ? [dropoff] : [];
  }, [pickup, dropoff, start, waypoints]);

  const key = `${pickup.lat},${pickup.lng}|${dropoff?.lat},${dropoff?.lng}|${size.w}x${size.h}|${topInset}|${bottomInset}`;
  useEffect(() => {
    if (size.w === 0) return;
    const pts = dropoff ? [pickup, dropoff] : [pickup];
    const target = fitCamera(pts, size, { top: topInset + 56, bottom: bottomInset + 36, left: 64, right: 64 }, [11, dropoff ? 16 : 15.5]);
    if (!placed.current) {
      placed.current = true;
      cam.lng.value = target.lng;
      cam.lat.value = target.lat;
      cam.zoom.value = target.zoom;
      setDrawn(target);
      return;
    }
    const ease = { duration: 600, easing: Easing.inOut(Easing.cubic) };
    cam.lng.value = withTiming(target.lng, ease);
    cam.lat.value = withTiming(target.lat, ease);
    cam.zoom.value = withTiming(target.zoom, ease, (done) => {
      if (done) runOnJS(setDrawn)(target);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    sizeSV.value = { w: width, h: height };
    setSize({ w: width, h: height });
  };

  return (
    // Map maths are physical (x grows rightwards): lay the map out LTR inside the RTL app.
    <View style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden' }]} onLayout={onLayout} testID={testID}>
      {size.w > 0 ? (
        <>
          <BaseMap drawn={drawn} cam={cam} size={size} onUserGestureStart={() => undefined} onUserCamera={setDrawn} />
          {radar ? <RadarPulse cam={cam} size={sizeSV} at={pickup} testID="ride-radar" /> : null}
          {nearby ? <NearbyVehicles cam={cam} size={sizeSV} data={nearby.data} kind={nearby.kind} /> : null}
          {dropoff ? <RouteLine cam={cam} size={sizeSV} glide={glide} progress={progress} start={start} waypoints={waypoints} color={theme.colors.accent} /> : null}
          <PlacePin cam={cam} size={sizeSV} at={pickup} kind="pickup" label={pickupLabel} testID="pin-pickup" />
          {dropoff ? <PlacePin cam={cam} size={sizeSV} at={dropoff} kind="home" label={dropoffLabel} testID="pin-dropoff" /> : null}
        </>
      ) : null}
      <MapCredit bottom={bottomInset} />
    </View>
  );
}

function MapCredit({ bottom }: { bottom: number }) {
  const theme = useTheme();
  return (
    <Text variant="caption" color="textMuted" style={{ position: 'absolute', right: theme.space[3], bottom: bottom + theme.space[1], fontSize: 10, lineHeight: 14, opacity: 0.8 }}>
      © OpenStreetMap
    </Text>
  );
}

/**
 * Pin adjust (customer spec §5, "map pin adjust"): the map moves under a fixed centre pin, like the
 * big ride apps. The pin lifts while the map is dragged and drops when it settles; `onCentre` gets
 * the spot under the pin tip. `recentre` moves the camera (my location, a picked zone).
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
  recentre: { pin: LatLng; seq: number } | null;
  tone?: 'pickup' | 'dropoff';
  testID?: string;
}) {
  const theme = useTheme();
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const start: Camera = { lat: initial.lat, lng: initial.lng, zoom: 15.2 };
  const cam = useCamera(start);
  const [drawn, setDrawn] = useState<Camera>(start);
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
    cbs.current.onCentre(recentre.pin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentre?.seq]);

  const pinStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value * 14 }] }));
  const shadowStyle = useAnimatedStyle(() => ({ opacity: 0.25 + lift.value * 0.2, transform: [{ scale: 1 - lift.value * 0.35 }] }));
  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const head = tone === 'pickup' ? theme.colors.success : theme.colors.text;

  return (
    <View style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden' }]} onLayout={onLayout} testID={testID}>
      {size.w > 0 ? (
        <BaseMap
          drawn={drawn}
          cam={cam}
          size={size}
          onUserGestureStart={() => {
            lift.value = withSpring(1, { damping: 16, stiffness: 260 });
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
        <Animated.View style={[{ position: 'absolute', width: 14, height: 6, borderRadius: 7, backgroundColor: palette.neutral[1000] }, shadowStyle]} />
        <Animated.View testID="pin-centre" style={[{ alignItems: 'center', marginBottom: 52 }, pinStyle]}>
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
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
          <View style={{ width: 3, height: 20, borderRadius: 2, backgroundColor: head }} />
        </Animated.View>
        <View style={{ position: 'absolute', width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: withAlpha(head, 0.3) }} />
      </View>
      <MapCredit bottom={0} />
    </View>
  );
}
