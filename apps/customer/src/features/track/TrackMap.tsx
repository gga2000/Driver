import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { cancelAnimation, Easing, runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';
import type { CourierPosition, OrderTracking } from '@driver/contracts';
import { decodePolyline } from '@driver/map';
import { Chip, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { fitCamera, mercX, mercY, project, type Camera, type LngLat, type Size } from './geo';
import { BaseMap } from './map/BaseMap';
import { CourierMarker, PlacePin, RadarPulse, RouteLine } from './map/Overlay';
import { vehicleKind } from './map/Vehicle';
import { buildPath, glidePos, planGlide, projectOnPath, REROUTE_OFF_M, tailSpan, type Glide, type Path } from './motion';
import { isLive, POSITION_POLL_MS, useOrderRoute } from './queries';
import { color } from '@driver/design-tokens';

/** Ask for a new road at most this often when he keeps straying from it. */
const REROUTE_MIN_GAP_MS = 15_000;
const AZIZIYAH: Camera = { lat: 32.9085, lng: 45.0655, zoom: 13.5 };
const FOLLOW_MS = 800;

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
export function TrackMap({ view, fix, stale, topInset, bottomInset, searching = false, minutes = null }: TrackMapProps) {
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

  // ── the road ahead (maps program SP5a) ──
  const stage = `${view.order.state}:${view.trip?.state ?? 'none'}:${pickedUp}`;
  const roadQuery = useOrderRoute(view.order.id, isLive(view), stage);
  const polyline = roadQuery.data?.polyline6 ?? null;
  const path = useMemo<Path | null>(() => (polyline ? buildPath(decodePolyline(polyline)) : null), [polyline]);
  const pathSV = useSharedValue<Path | null>(null);
  const pathRef = useRef<Path | null>(null);
  const lastReroute = useRef(0);

  // ── courier glide ──
  const glide = useSharedValue<Glide | null>(null);
  const progress = useSharedValue(1);

  // A new road: finish where the marker is, as a still glide, and plan the next fix on the new road.
  useEffect(() => {
    const g = glide.value;
    if (g) {
      const here = glidePos(g, pathRef.current, progress.value);
      glide.value = { kind: 'line', from: here.pos, to: here.pos, fromHeading: here.heading, toHeading: here.heading };
      progress.value = 1;
    }
    pathRef.current = path;
    pathSV.value = path;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const fixKey = fix ? `${fix.at.getTime()}:${fix.pin.lat}:${fix.pin.lng}` : 'none';
  useEffect(() => {
    if (!fix) {
      glide.value = null;
      return;
    }
    const target = { lat: fix.pin.lat, lng: fix.pin.lng, bearing: fix.bearing, speedKmh: fix.speedKmh };
    const g = glide.value;
    if (!g) {
      const h = fix.bearing ?? 0;
      glide.value = { kind: 'line', from: target, to: target, fromHeading: h, toHeading: h };
      progress.value = 1;
      return;
    }
    const road = pathRef.current;
    const next = planGlide(road, glidePos(g, road, progress.value), target, POSITION_POLL_MS);
    glide.value = next;
    // Glide over one poll interval, then (when moving) keep going for the dead-reckoning tail.
    const span = 1 + (stale ? 0 : tailSpan(next, POSITION_POLL_MS));
    progress.value = 0;
    progress.value = withTiming(span, { duration: POSITION_POLL_MS * span, easing: Easing.linear });
    // He left the road we drew: ask for a new one (not more than every 15 s).
    const now = Date.now();
    if (road && projectOnPath(road, target).offM > REROUTE_OFF_M && now - lastReroute.current > REROUTE_MIN_GAP_MS) {
      lastReroute.current = now;
      void roadQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixKey]);

  // Signal lost: stop dead reckoning where he is.
  useEffect(() => {
    if (!stale) return;
    cancelAnimation(progress);
  }, [stale, progress]);

  const startSV = useSharedValue<LngLat | null>(route.start);
  const waypointsSV = useSharedValue<LngLat[]>(route.waypoints);
  useEffect(() => {
    startSV.value = route.start;
    waypointsSV.value = route.waypoints;
  }, [route, startSV, waypointsSV]);

  // ── camera ──
  const lng = useSharedValue(AZIZIYAH.lng);
  const lat = useSharedValue(AZIZIYAH.lat);
  const zoom = useSharedValue(AZIZIYAH.zoom);
  const cam = useMemo(() => ({ lng, lat, zoom }), [lng, lat, zoom]);
  const [drawn, setDrawn] = useState<Camera>(AZIZIYAH);
  const [follow, setFollow] = useState(true);
  const placed = useRef(false);

  const focus = useMemo(() => {
    const pts: LngLat[] = [];
    if (fix) pts.push(fix.pin);
    pts.push(...route.waypoints.slice(0, pickedUp ? 1 : 2));
    if (!fix && route.start) pts.push(route.start);
    if (pts.length === 0 && home) pts.push(home);
    return pts;
  }, [fix, route, pickedUp, home]);
  const focusKey = focus.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');

  const frame = useCallback(
    (force: boolean) => {
      if (size.w === 0 || focus.length === 0) return;
      const pad = { top: topInset + 40, bottom: bottomInset + (searching ? 120 : 40), left: 48, right: 48 };
      const target = fitCamera(focus, size, pad, [12.5, 16.5]);
      if (!placed.current) {
        placed.current = true;
        lng.value = target.lng;
        lat.value = target.lat;
        zoom.value = target.zoom;
        setDrawn(target);
        return;
      }
      // Follow without seasickness: move only when the frame is off by a noticeable amount — or when
      // the courier or his next stop is about to leave the visible map (half the padding as margin).
      const z = zoom.value;
      const dx = Math.abs(mercX(target.lng, z) - mercX(lng.value, z));
      const dy = Math.abs(mercY(target.lat, z) - mercY(lat.value, z));
      const now = { lng: lng.value, lat: lat.value, zoom: z };
      const inView = focus.every((p) => {
        const at = project(p.lat, p.lng, now, size);
        return at.x >= pad.left / 2 && at.x <= size.w - pad.right / 2 && at.y >= pad.top / 2 && at.y <= size.h - pad.bottom / 2;
      });
      if (!force && inView && dx < size.w * 0.12 && dy < size.h * 0.1 && Math.abs(target.zoom - z) < 0.4) return;
      const ease = { duration: FOLLOW_MS, easing: Easing.inOut(Easing.cubic) };
      lng.value = withTiming(target.lng, ease);
      lat.value = withTiming(target.lat, ease);
      zoom.value = withTiming(target.zoom, ease, (done) => {
        if (done) runOnJS(setDrawn)(target);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [size, focusKey, topInset, bottomInset, searching],
  );

  useEffect(() => {
    if (follow) frame(false);
  }, [frame, follow]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    sizeSV.value = { w: width, h: height };
    setSize({ w: width, h: height });
  };

  const recentre = () => {
    setFollow(true);
    frame(true);
  };

  const vehicle = vehicleKind(view.courier?.vehicleClass ?? (view.order.type === 'ride' ? 'car' : 'bike'));

  return (
    // Map maths are physical (x grows rightwards): lay the map out LTR inside the RTL app.
    <View style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden' }]} onLayout={onLayout} accessibilityLabel={t('track.map_label')} testID="track-map">
      {size.w > 0 ? (
        <>
          <BaseMap drawn={drawn} cam={cam} size={size} onUserGestureStart={() => setFollow(false)} onUserCamera={setDrawn} />
          <RouteLine cam={cam} size={sizeSV} glide={glide} progress={progress} path={pathSV} onRoad={path !== null} start={startSV} waypoints={waypointsSV} color={theme.colors.accent} />
          {searching && ridePickup ? <RadarPulse cam={cam} size={sizeSV} at={ridePickup} testID="ride-radar" /> : null}
          {ridePickup ? <PlacePin cam={cam} size={sizeSV} at={ridePickup} kind="pickup" label={t('ride.pickup_here')} testID="pin-pickup" /> : null}
          {kitchen && !pickedUp ? <PlacePin cam={cam} size={sizeSV} at={kitchen} kind="kitchen" label={view.merchant?.name ?? t('track.kitchen_pin')} testID="pin-kitchen" /> : null}
          {home ? <PlacePin cam={cam} size={sizeSV} at={home} kind="home" label={t(view.order.type === 'ride' ? 'track.destination_pin' : 'track.home_pin')} testID="pin-home" /> : null}
          <CourierMarker cam={cam} size={sizeSV} glide={glide} progress={progress} path={pathSV} kind={vehicle} stale={stale} minutes={minutes} testID="courier-marker" />
        </>
      ) : null}
      {!follow ? (
        <View
          style={{
            position: 'absolute',
            bottom: bottomInset + theme.space[5],
            left: theme.space[4],
            borderRadius: theme.radius.pill,
            backgroundColor: theme.colors.surface,
            shadowColor: color.neutral[1000],
            shadowOpacity: 0.14,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 },
            elevation: 4,
          }}
        >
          <Chip label={t('track.recenter')} icon="location-arrow" onPress={recentre} testID="recenter" />
        </View>
      ) : null}
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
