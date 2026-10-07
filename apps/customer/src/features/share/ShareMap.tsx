import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { LIVE_RULES, SHARE_LIVE_RULES, type SharedTrip } from '@driver/contracts';
import { Text, useTheme } from '@driver/ui';
import { distanceM, type LngLat, type Size } from '@/features/track/geo';
import { BaseMap } from '@/features/track/map/BaseMap';
import { useLabelAvoid } from '@/features/track/map/useLabelAvoid';
import { CourierMarker, PlacePin, placePinSide, RouteLine } from '@/features/track/map/Overlay';
import { RecentreChip } from '@/features/track/map/RecentreChip';
import { AZIZIYAH_CAMERA, useFollowCamera } from '@/features/track/map/useFollowCamera';
import { useRoadGlide, type GlideFix } from '@/features/track/map/useRoadGlide';
import { vehicleKind } from '@/features/track/map/Vehicle';
import { useT } from '@/lib/i18n';
import { useSharedRoute } from './queries';

/** Inside this distance the camera closes in on the last streets (as on the rider's own screen). */
const CLOSE_IN_M = 400;
/** The sheet below overlaps the map by this much. */
const SHEET_OVERLAP = 24;

/**
 * The share page's map (maps program SP5c, c9): the same moving map the rider sees — the car gliding
 * along the road between live fixes, the road ahead shortening behind it, the minutes on the car and
 * where it is heading (a pin, never an address). The camera frames car and target until the viewer
 * moves the map ("رجّع الخريطة" brings it back). Before the first fix: the town at rest.
 */
export function ShareMap({ token, trip, stale, live, minutes }: { token: string; trip: SharedTrip; stale: boolean; live: boolean; minutes: string | null }) {
  const theme = useTheme();
  const t = useT();
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const sizeSV = useSharedValue<Size>({ w: 1, h: 1 });

  const pos = trip.position;
  const fix = useMemo<GlideFix | null>(
    () => (pos ? { pin: { lat: pos.lat, lng: pos.lng }, at: pos.at, bearing: pos.bearing, speedKmh: pos.speedKmh } : null),
    // A new fix is a new time or place; the same fix re-read must not restart the glide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pos?.at.getTime(), pos?.lat, pos?.lng],
  );
  const target: LngLat | null = trip.target ? { lat: trip.target.lat, lng: trip.target.lng } : null;
  const intervalMs = !live ? LIVE_RULES.fallbackPollMs : trip.subject === 'intercity' ? SHARE_LIVE_RULES.intercityMs : LIVE_RULES.positionThrottleMs;

  const road = useSharedRoute(token, Boolean(fix && trip.target), `${trip.status}:${trip.target?.kind ?? 'none'}`);
  const motion = useRoadGlide({ fix, polyline6: road.data?.polyline6 ?? null, stale, intervalMs, onStray: () => void road.refetch() });

  // Without a road shape, a dashed straight line from the car to the target.
  const startSV = useSharedValue<LngLat | null>(null);
  const waypointsSV = useSharedValue<LngLat[]>(target ? [target] : []);
  const targetKey = target ? `${target.lat},${target.lng}` : 'none';
  useEffect(() => {
    waypointsSV.value = target ? [target] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  // Zone names keep clear of the car and the pin («شارع 30» was drawn under the restaurant).
  const labelAvoid = useLabelAvoid([fix?.pin, target]);

  const close = fix && target ? distanceM(fix.pin, target) < CLOSE_IN_M : false;
  const focus = fix ? (target ? [fix.pin, target] : [fix.pin]) : [AZIZIYAH_CAMERA];
  const camera = useFollowCamera({
    size,
    focus,
    zoom: !fix ? [AZIZIYAH_CAMERA.zoom, AZIZIYAH_CAMERA.zoom] : close ? [15.5, 16.8] : [12, 16],
    pad: { top: 72, bottom: SHEET_OVERLAP + 40, left: 48, right: 48 },
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    sizeSV.value = { w: width, h: height };
    setSize({ w: width, h: height });
  };
  const cam = camera.cam;

  return (
    // Map maths are physical (x grows rightwards): lay the map out LTR inside the RTL page.
    <View style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }]} onLayout={onLayout} testID="share-map">
      {size.w > 0 ? (
        <>
          <BaseMap drawn={camera.drawn} cam={cam} size={size} onUserGestureStart={camera.stopFollowing} onUserCamera={camera.setDrawn} labelAvoid={labelAvoid} coveredBottom={SHEET_OVERLAP} />
          {fix && target ? <RouteLine cam={cam} size={sizeSV} glide={motion.glide} progress={motion.progress} path={motion.path} onRoad={motion.onRoad} start={startSV} waypoints={waypointsSV} color={theme.colors.accent} /> : null}
          {trip.target && target ? (
            <PlacePin cam={cam} size={sizeSV} at={target} kind={pinKind(trip)} label={pinLabel(trip, t)} side={placePinSide(target, pinLabel(trip, t), fix?.pin ?? null, Boolean(minutes), camera.drawn, size)} testID="share-target" />
          ) : null}
          <CourierMarker cam={cam} size={sizeSV} glide={motion.glide} progress={motion.progress} path={motion.path} kind={vehicleKind(trip.vehicleClass ?? 'car')} stale={stale} minutes={minutes} testID="share-car" />
        </>
      ) : null}
      {!camera.follow && fix ? <RecentreChip bottom={SHEET_OVERLAP + theme.space[3]} onPress={camera.recentre} /> : null}
      <Text variant="caption" color="textMuted" style={{ position: 'absolute', right: theme.space[3], bottom: SHEET_OVERLAP + theme.space[1], fontSize: 10, lineHeight: 14, opacity: 0.8 }}>
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

/** A delivery heads to the store, then home; a ride to the rider, then the destination. */
function pinKind(trip: SharedTrip): 'kitchen' | 'pickup' | 'home' {
  if (trip.target?.kind !== 'pickup') return 'home';
  return trip.subject === 'delivery' ? 'kitchen' : 'pickup';
}

function pinLabel(trip: SharedTrip, t: ReturnType<typeof useT>): string {
  if (trip.target?.kind !== 'pickup') return t('share.destination');
  return trip.subject === 'delivery' ? (trip.storeName ?? t('track.kitchen_pin')) : t('ride.pickup_here');
}
