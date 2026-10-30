import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Easing, runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';
import type { LatLng, NearbyVehicles as NearbyVehiclesData } from '@driver/contracts';
import { fitCamera, type Camera, type Size } from '@/features/track/geo';
import { BaseMap } from '@/features/track/map/BaseMap';
import { useLabelAvoid } from '@/features/track/map/useLabelAvoid';
import { PlacePin, RadarPulse } from '@/features/track/map/Overlay';
import type { VehicleKind } from '@/features/track/map/Vehicle';
import { MapCredit, useMapCamera } from '@/features/places/PinPicker';
import { useT } from '@/lib/i18n';
import { NearbyVehicles } from './NearbyVehicles';
import { RouteToPin, useFixedRoute, useKeptRoads } from './RouteToPin';
import type { WalkRoad } from './walk-stop';
import { WalkLine, WalkPin } from './WalkToStop';

const AZIZIYAH: Camera = { lat: 32.9085, lng: 45.0655, zoom: 13.5 };

/**
 * The choose-ride map: pickup (green) and destination (ink) pins and the line between them along the
 * streets the map has drawn, in the chosen service's colour with the distance on it (the same line as
 * the pin steps; dotted and straight when the streets don't join them), framed between the top bar and
 * the panel. Optional
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
  walk,
  service,
  onRoads,
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
  /**
   * Map idea N10: the dotted walk from where he stands to the safe stop, with «أنت هنا» and
   * «اوكف هنا» in place of the pickup pin. The camera keeps both ends in view.
   */
  walk?: { from: LatLng; to: LatLng; youLabel: string; stopLabel: string } | null;
  /** The chosen ride: the line takes its colour. */
  service: 'taxi' | 'tuktuk';
  /** The roads the map has drawn, each time it settles (the safe-stop finder reads them). */
  onRoads?: (roads: WalkRoad[]) => void;
  testID?: string;
}) {
  const t = useT();
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const sizeSV = useSharedValue<Size>({ w: 1, h: 1 });
  const cam = useMapCamera(AZIZIYAH);
  const [drawn, setDrawn] = useState<Camera>(AZIZIYAH);
  const placed = useRef(false);

  // With a walk (N10) the car's trip starts at the stop, not where he stands.
  const from = walk ? walk.to : pickup;
  const [roads, keepRoads] = useKeptRoads();
  const onMapRoads = (rs: WalkRoad[]) => {
    keepRoads(rs);
    onRoads?.(rs);
  };
  const route = useFixedRoute([from.lng, from.lat], dropoff ? [dropoff.lng, dropoff.lat] : null, roads);

  // The extra points count, not their positions: free cars move every refresh and the camera stays put.
  const key = `${pickup.lat},${pickup.lng}|${dropoff?.lat},${dropoff?.lng}|${size.w}x${size.h}|${topInset}|${bottomInset}|${frame?.length ?? 0}|${walk ? `${walk.from.lat},${walk.from.lng},${walk.to.lat},${walk.to.lng}` : ''}`;
  useEffect(() => {
    if (size.w === 0) return;
    const pts = [...(dropoff ? [pickup, dropoff] : [pickup]), ...(frame ?? [])];
    // N10: close in on the short walk (both ends and their names), the trip running on past the edge.
    const target = walk
      ? fitCamera([walk.to, walk.from], size, { top: topInset + 96, bottom: bottomInset + 48, left: 96, right: 96 }, [15, 17.5])
      : fitCamera(pts, size, { top: topInset + 56, bottom: bottomInset + 36, left: 64, right: 64 }, [11, dropoff ? 16 : 15.5]);
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

  const labelAvoid = useLabelAvoid(walk ? [walk.from, walk.to, dropoff] : [pickup, dropoff]);

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
          <BaseMap drawn={drawn} cam={cam} size={size} onUserGestureStart={() => undefined} onUserCamera={setDrawn} labelAvoid={labelAvoid} coveredTop={topInset} coveredBottom={bottomInset} onRoads={onMapRoads} />
          {radar ? <RadarPulse cam={cam} size={sizeSV} at={pickup} testID="ride-radar" /> : null}
          {nearby ? <NearbyVehicles cam={cam} size={sizeSV} data={nearby.data} kind={nearby.kind} /> : null}
          {dropoff ? (
            <RouteToPin
              cam={cam}
              size={sizeSV}
              route={route}
              service={service}
              kmLabel={(km) => t('ride.route_km', { km })}
              mLabel={(m) => t('ride.route_m', { m })}
              insets={{ top: topInset + 56, bottom: bottomInset + 24, side: 56 }}
              shortTagBy={dropoff}
              // The walk to the stop is what to read then; the trip runs on past the edge.
              showTag={!walk}
            />
          ) : null}
          {walk ? (
            <>
              <WalkLine cam={cam} size={sizeSV} from={walk.from} to={walk.to} testID="ride-walk-line" />
              <WalkPin cam={cam} size={sizeSV} at={walk.from} kind="you" label={walk.youLabel} testID="pin-walk-you" />
              <WalkPin cam={cam} size={sizeSV} at={walk.to} kind="stop" label={walk.stopLabel} testID="pin-walk-stop" />
            </>
          ) : (
            <PlacePin cam={cam} size={sizeSV} at={pickup} kind="pickup" label={pickupLabel} testID="pin-pickup" />
          )}
          {dropoff ? <PlacePin cam={cam} size={sizeSV} at={dropoff} kind={dropoffKind} label={dropoffLabel} testID="pin-dropoff" /> : null}
        </>
      ) : null}
      <MapCredit bottom={bottomInset} />
    </View>
  );
}
