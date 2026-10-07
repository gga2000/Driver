import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Easing, runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';
import type { LatLng, NearbyVehicles as NearbyVehiclesData } from '@driver/contracts';
import { useTheme } from '@driver/ui';
import { fitCamera, type Camera, type LngLat, type Size } from '@/features/track/geo';
import type { Glide } from '@/features/track/motion';
import { BaseMap } from '@/features/track/map/BaseMap';
import { useLabelAvoid } from '@/features/track/map/useLabelAvoid';
import { PlacePin, RadarPulse, RouteLine } from '@/features/track/map/Overlay';
import type { VehicleKind } from '@/features/track/map/Vehicle';
import { MapCredit, useMapCamera } from '@/features/places/PinPicker';
import { NearbyVehicles } from './NearbyVehicles';

const AZIZIYAH: Camera = { lat: 32.9085, lng: 45.0655, zoom: 13.5 };

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
  dropoffKind = 'destination',
  topInset,
  bottomInset,
  radar = false,
  nearby,
  frame,
  testID,
}: {
  pickup: LatLng;
  dropoff: LatLng | null;
  pickupLabel: string;
  dropoffLabel: string;
  /** The saved home gets the house; any other destination a flag (L-15). */
  dropoffKind?: 'home' | 'destination';
  topInset: number;
  bottomInset: number;
  radar?: boolean;
  /** Free vehicles of the chosen kind around the pickup (blurred by the server). */
  nearby?: { data: NearbyVehiclesData | undefined; kind: VehicleKind };
  /** More points to keep in view with the pickup (the where-to map frames the nearest free cars, ride idea w1). */
  frame?: readonly LatLng[];
  testID?: string;
}) {
  const theme = useTheme();
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const sizeSV = useSharedValue<Size>({ w: 1, h: 1 });
  const cam = useMapCamera(AZIZIYAH);
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

  // The extra points count, not their positions: free cars move every refresh and the camera stays put.
  const key = `${pickup.lat},${pickup.lng}|${dropoff?.lat},${dropoff?.lng}|${size.w}x${size.h}|${topInset}|${bottomInset}|${frame?.length ?? 0}`;
  useEffect(() => {
    if (size.w === 0) return;
    const pts = [...(dropoff ? [pickup, dropoff] : [pickup]), ...(frame ?? [])];
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

  const labelAvoid = useLabelAvoid([pickup, dropoff]);

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
          <BaseMap drawn={drawn} cam={cam} size={size} onUserGestureStart={() => undefined} onUserCamera={setDrawn} labelAvoid={labelAvoid} coveredTop={topInset} coveredBottom={bottomInset} />
          {radar ? <RadarPulse cam={cam} size={sizeSV} at={pickup} testID="ride-radar" /> : null}
          {nearby ? <NearbyVehicles cam={cam} size={sizeSV} data={nearby.data} kind={nearby.kind} /> : null}
          {dropoff ? <RouteLine cam={cam} size={sizeSV} glide={glide} progress={progress} start={start} waypoints={waypoints} color={theme.colors.accent} /> : null}
          <PlacePin cam={cam} size={sizeSV} at={pickup} kind="pickup" label={pickupLabel} testID="pin-pickup" />
          {dropoff ? <PlacePin cam={cam} size={sizeSV} at={dropoff} kind={dropoffKind} label={dropoffLabel} testID="pin-dropoff" /> : null}
        </>
      ) : null}
      <MapCredit bottom={bottomInset} />
    </View>
  );
}
