import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import type { CourierPosition, NearbyVehicles as NearbyVehiclesData, OrderTracking } from '@driver/contracts';
import { NearbyVehicles } from '@/features/ride/NearbyVehicles';
import { Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { distanceM, type LngLat, type Size } from './geo';
import { BaseMap } from './map/BaseMap';
import { useLabelAvoid } from './map/useLabelAvoid';
import { CourierMarker, HeadingArrow, PlacePin, placePinSide, PrepRing, RadarPulse, RouteLine } from './map/Overlay';
import { RecentreChip } from './map/RecentreChip';
import { useFollowCamera } from './map/useFollowCamera';
import { useRoadGlide } from './map/useRoadGlide';
import { vehicleKind, type VehicleKind } from './map/Vehicle';
import { isLive, POSITION_POLL_MS, useOrderRoute } from './queries';
import { storyShot } from './story';
import { phaseOf } from './timeline';

/** The cooking ring moves this often (prep is minutes long). */
const PREP_TICK_MS = 5_000;

export interface TrackMapProps {
  view: OrderTracking;
  fix: CourierPosition | null;
  /** The fix is old (signal lost): grey marker, no pulse. */
  stale: boolean;
  /** Heights covered by the top bar and the collapsed sheet: the camera frames the space between. */
  topInset: number;
  bottomInset: number;
  /** Rides: dispatch is still looking for a driver (radar at the pickup). */
  searching?: boolean;
  /** Minutes to arrival for the pill on the courier ("8 دقيقة"); null hides it. */
  minutes?: string | null;
  /** Unreachable at the door (joy f18): ring the courier so the customer sees where he stands. */
  spotlight?: boolean;
  /** Rides while searching: free cars of the asked kind around the pickup (L-03, maps c10). */
  nearby?: { data: NearbyVehiclesData | undefined; kind: VehicleKind } | null;
  /** Rides: the saved home gets the house, any other destination a flag (L-15). */
  destinationKind?: 'home' | 'destination';
}

/** Where the route still goes after the courier: next stops of this order, in order. */
export function routeWaypoints(v: OrderTracking): { start: LngLat | null; waypoints: LngLat[] } {
  const stops = v.trip?.stops.filter((s) => s.mine && s.target && s.state !== 'completed' && s.state !== 'skipped') ?? [];
  const home = v.dropoff?.pin ?? v.trip?.stops.find((s) => s.mine && s.type === 'dropoff')?.target ?? null;
  const kitchen = v.merchant?.pin ?? null;
  if (stops.length > 0) return { start: v.courier ? null : (kitchen ?? null), waypoints: stops.map((s) => s.target!) };
  if (v.order.deliveredAt || v.order.state === 'closed' || v.order.state === 'delivered') return { start: null, waypoints: [] };
  // No trip yet: kitchen → door.
  if (kitchen && home) return { start: kitchen, waypoints: [home] };
  return { start: null, waypoints: home ? [home] : [] };
}

/**
 * Map ≈ 60 % of the live screen: base map (MapLibre on the web, SVG zones on native), the road ahead
 * (`orders.route`) shortening as the courier glides along it between fixes — dead reckoning through
 * short gaps, no backwards hops, turning with the road (`motion.ts`) — his top-down vehicle with the
 * minutes to arrival, the home and kitchen pins, and a follow camera with a re-centre chip.
 */
export function TrackMap({ view, fix, stale, topInset, bottomInset, searching = false, minutes = null, spotlight = false, nearby = null, destinationKind = 'destination' }: TrackMapProps) {
  const theme = useTheme();
  const t = useT();
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const sizeSV = useSharedValue<Size>({ w: 1, h: 1 });

  const home = view.dropoff?.pin ?? view.trip?.stops.find((s) => s.mine && s.type === 'dropoff')?.target ?? null;
  const kitchen = view.order.type === 'ride' ? null : (view.merchant?.pin ?? null);
  const pickedUp = Boolean(view.order.pickedUpAt);
  // Rides: where the rider waits, until the driver has picked him up.
  const ridePickupStop = view.order.type === 'ride' ? view.trip?.stops.find((s) => s.mine && s.type === 'pickup') : undefined;
  const ridePickup = ridePickupStop && !ridePickupStop.completedAt ? ridePickupStop.target : null;
  const route = useMemo(() => routeWaypoints(view), [view]);

  // ── the kitchen's cooking ring (maps program SP5b): how far the promised prep time has run ──
  const accepted = view.order.acceptedAt?.getTime() ?? null;
  const promisedReady = view.order.promisedReadyAt?.getTime() ?? null;
  const cooking = view.order.type !== 'ride' && !pickedUp && accepted !== null && promisedReady !== null && promisedReady > accepted && !view.order.readyAt;
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!cooking) return;
    const id = setInterval(() => setClock(Date.now()), PREP_TICK_MS);
    return () => clearInterval(id);
  }, [cooking]);
  const prepProgress = cooking ? Math.min(1, Math.max(0, (clock - accepted) / (promisedReady - accepted))) : null;

  // ── the road ahead (maps program SP5a) and the courier gliding along it ──
  const stage = `${view.order.state}:${view.trip?.state ?? 'none'}:${pickedUp}`;
  const roadQuery = useOrderRoute(view.order.id, isLive(view), stage);
  const motion = useRoadGlide({ fix, polyline6: roadQuery.data?.polyline6 ?? null, stale, intervalMs: POSITION_POLL_MS, onStray: () => void roadQuery.refetch() });

  const startSV = useSharedValue<LngLat | null>(route.start);
  const waypointsSV = useSharedValue<LngLat[]>(route.waypoints);
  useEffect(() => {
    startSV.value = route.start;
    waypointsSV.value = route.waypoints;
  }, [route, startSV, waypointsSV]);

  // ── camera: the story it tells (maps program SP5b) — kitchen while it cooks, courier + kitchen,
  // courier + door (tighter when he is close), the door once delivered ──
  const phase = phaseOf(view);
  const shot = useMemo(
    () =>
      storyShot({
        phase,
        ride: view.order.type === 'ride',
        courier: fix?.pin ?? null,
        kitchen,
        door: home,
        ahead: route.start ? [route.start, ...route.waypoints] : route.waypoints,
        toDoorM: fix && home ? distanceM(fix.pin, home) : null,
        pickup: ridePickup,
      }),
    [phase, view.order.type, fix, kitchen, home, route, ridePickup],
  );
  const camera = useFollowCamera({ size, focus: shot.points, zoom: shot.zoom, pad: { top: topInset + 40, bottom: bottomInset + (searching ? 120 : 40), left: 48, right: 48 } });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    sizeSV.value = { w: width, h: height };
    setSize({ w: width, h: height });
  };

  // Zone names keep clear of every marker on this map (QA 2026-10-07).
  const labelAvoid = useLabelAvoid([fix?.pin, ridePickup, kitchen && !pickedUp ? kitchen : null, home]);

  // The courier is drawn over the pins: a name he would cover flips under its pin (QA 2026-10-07).
  const courierAt = fix?.pin ?? null;
  const kitchenLabel = view.merchant?.name ?? t('track.kitchen_pin');
  const homeLabel = t(view.order.type === 'ride' ? 'track.destination_pin' : 'track.home_pin');
  const sideOf = (at: LngLat, label: string) => placePinSide(at, label, courierAt, Boolean(minutes), camera.drawn, size);

  const vehicle = vehicleKind(view.courier?.vehicleClass ?? (view.order.type === 'ride' ? 'car' : 'bike'));
  const cam = camera.cam;

  return (
    // Map maths are physical (x grows rightwards): lay the map out LTR inside the RTL app.
    <View style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden' }]} onLayout={onLayout} accessibilityLabel={t('track.map_label')} testID="track-map">
      {size.w > 0 ? (
        <>
          <BaseMap drawn={camera.drawn} cam={cam} size={size} onUserGestureStart={camera.stopFollowing} onUserCamera={camera.setDrawn} labelAvoid={labelAvoid} />
          {/* No straight line across the river without a road route (joy f19): a heading arrow instead. */}
          <RouteLine cam={cam} size={sizeSV} glide={motion.glide} progress={motion.progress} path={motion.path} onRoad={motion.onRoad} start={startSV} waypoints={waypointsSV} color={theme.colors.accent} straight={false} />
          <HeadingArrow cam={cam} size={sizeSV} glide={motion.glide} progress={motion.progress} path={motion.path} waypoints={waypointsSV} color={theme.colors.accent} visible={!motion.onRoad} />
          {searching && nearby ? <NearbyVehicles cam={cam} size={sizeSV} data={nearby.data} kind={nearby.kind} /> : null}
          {searching && ridePickup ? <RadarPulse cam={cam} size={sizeSV} at={ridePickup} testID="ride-radar" /> : null}
          {ridePickup ? <PlacePin cam={cam} size={sizeSV} at={ridePickup} kind="pickup" label={t('ride.pickup_here')} side={sideOf(ridePickup, t('ride.pickup_here'))} testID="pin-pickup" /> : null}
          {kitchen && prepProgress !== null ? <PrepRing cam={cam} size={sizeSV} at={kitchen} progress={prepProgress} testID="prep-ring" /> : null}
          {kitchen && !pickedUp ? <PlacePin cam={cam} size={sizeSV} at={kitchen} kind="kitchen" label={kitchenLabel} side={sideOf(kitchen, kitchenLabel)} testID="pin-kitchen" /> : null}
          {home ? <PlacePin cam={cam} size={sizeSV} at={home} kind={view.order.type === 'ride' ? destinationKind : 'home'} label={homeLabel} side={sideOf(home, homeLabel)} testID="pin-home" /> : null}
          <CourierMarker cam={cam} size={sizeSV} glide={motion.glide} progress={motion.progress} path={motion.path} kind={vehicle} stale={stale} minutes={minutes} spotlight={spotlight} testID="courier-marker" />
        </>
      ) : null}
      {!camera.follow ? <RecentreChip bottom={bottomInset + theme.space[5]} onPress={camera.recentre} /> : null}
      {/* Tile credit (OSM raster today, the OSM-derived PMTiles later), clear of the sheet. */}
      <Text
        variant="caption"
        color="textMuted"
        style={{ position: 'absolute', right: theme.space[3], bottom: bottomInset + theme.space[1], fontSize: 10, lineHeight: 14, opacity: 0.8 }}
      >
        © OpenStreetMap
      </Text>
    </View>
  );
}
