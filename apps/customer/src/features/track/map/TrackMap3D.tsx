import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { CameraRef, LayerProps, MapRef } from '@maplibre/maplibre-react-native';
import type { CourierPosition, OrderTracking } from '@driver/contracts';
import * as golden from '@driver/map/golden';
import { slowStretchLayers } from '@driver/map/pieces';
import { Avatar, Icon, Text, useTheme, withAlpha } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';
import { distanceM, type LngLat } from '../geo';
import { SLOW_COPY } from '../late-promise';
import { litBuilding, momentOf, routeGeoJSON, routeParts, slowStretchPath, slowStretchShape } from '../map3d';
import { glidePos } from '../motion';
import { isLive, POSITION_POLL_MS, useOrderRoute } from '../queries';
import { MAP_CREDIT } from './credit';
import { LIGHT_CHECK_MS } from './golden-setup';
import { nativeGolden, nativeGoldenImages, nativeGoldenStyle, nativeMapLibre } from './native-maplibre';
import { RecentreChip } from './RecentreChip';
import { GlintLayer, StreetLifeLayers, type Road } from './StreetLifeLayers';
import { PIN, Teardrop } from './Teardrop';
import { useRoadGlide } from './useRoadGlide';

type Pt = [number, number];
type Light = ReturnType<typeof golden.resolveLight>['light'];

const SRC = { route: 'track-route', glow: 'track-glow', lit: 'track-lit', slow: 'track-slow' } as const;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
/** The courier marker and the route move this often on phones (the bridge is the cost, not the drawing). */
const COURIER_MS = 120;
const PHOTO = 38;
const RING_W = 3;

export interface TrackMap3DProps {
  view: OrderTracking;
  fix: CourierPosition | null;
  stale: boolean;
  topInset: number;
  bottomInset: number;
  /** Our map file failed: the screen shows the flat map instead. */
  onFail: () => void;
}

const pt = (p: LngLat): Pt => [p.lng, p.lat];

/**
 * The live order map in 3D on phones (MapLibre Native), the same moments as the web
 * (TrackMap3D.web.tsx): the kitchen lit while it cooks, a tilted ride over a risen town, a closer
 * tilt as he nears, the house lit on arrival. Pins are the map's own markers, so they follow tilt
 * and turn. Street life and the glint along the road ahead move too, at a pace the bridge can carry
 * (StreetLifeLayers.tsx).
 */
export function TrackMap3D({ view, fix, stale, topInset, bottomInset, onFail }: TrackMap3DProps) {
  const ml = nativeMapLibre()!;
  const theme = useTheme();
  const t = useT();
  const camera = useRef<CameraRef>(null);
  const map = useRef<MapRef>(null);
  const [ready, setReady] = useState(false);
  const [follow, setFollow] = useState(true);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [light, setLight] = useState<Light>(() => golden.resolveLight().light);
  const [courier, setCourier] = useState<{ pos: LngLat; heading: number; d: number | null } | null>(null);
  const [houses, setHouses] = useState<{ ring: Pt[]; hm: number }[]>([]);
  const [bearing, setBearing] = useState(0);
  const [roads, setRoads] = useState<Road[] | null>(null);

  const home = view.dropoff?.pin ?? view.trip?.stops.find((s) => s.mine && s.type === 'dropoff')?.target ?? null;
  const kitchen = view.merchant?.pin ?? null;
  const pickedUp = Boolean(view.order.pickedUpAt);
  const toDoorM = fix && home ? distanceM(fix.pin, home) : null;
  const moment = momentOf(view, toDoorM);
  const riding = moment === 'on_the_way' || moment === 'near';

  const stage = `${view.order.state}:${view.trip?.state ?? 'none'}:${pickedUp}`;
  const roadQuery = useOrderRoute(view.order.id, isLive(view), stage);
  const motion = useRoadGlide({ fix, polyline6: roadQuery.data?.polyline6 ?? null, stale, intervalMs: POSITION_POLL_MS, onStray: () => void roadQuery.refetch() });

  const style = useMemo(() => {
    const s = nativeGoldenStyle(golden, light, 'customer', { riseAt: golden.TRACKING_RISE_ZOOM });
    // Place names fight the risen roofs; street names stay.
    return { ...s, layers: s.layers.map((l) => (l.id === 'golden-places' ? { ...l, layout: { ...l.layout, visibility: 'none' } } : l)) } as typeof s;
  }, [light]);
  const images = useMemo(() => nativeGoldenImages(golden, light), [light]);
  const layers = useMemo(() => golden.goldenTrackingLayers({ service: 'food', light, routeSource: SRC.route, glowSource: SRC.glow, litSource: SRC.lit }), [light]);
  const roadLayers = useMemo(() => style.layers.filter((l) => 'source-layer' in l && l['source-layer'] === 'roads').map((l) => l.id), [style]);

  useEffect(() => {
    const id = setInterval(() => setLight(golden.resolveLight().light), LIGHT_CHECK_MS);
    return () => clearInterval(id);
  }, []);

  // The courier glides along the road between fixes; the phone follows him a few times a second.
  useEffect(() => {
    if (!riding) return;
    const id = setInterval(() => {
      const g = motion.glide.value;
      setCourier(g ? glidePos(g, motion.path.value, motion.progress.value) : null);
    }, COURIER_MS);
    return () => clearInterval(id);
  }, [riding, motion]);

  const live = useRef({ moment, kitchen, home, follow, topInset, bottomInset, size, courier, reduce: theme.reduceMotion });
  live.current = { moment, kitchen, home, follow, topInset, bottomInset, size, courier, reduce: theme.reduceMotion };

  /** The moment's camera, eased (1.2 s) or jumped (first frame, reduce motion). */
  const frame = (animate: boolean) => {
    const s = live.current;
    const to = s.home ?? s.kitchen;
    const from = s.kitchen ?? s.home;
    if (!to || !from || !s.size.w) return;
    const vehicle = s.moment === 'on_the_way' || s.moment === 'near' ? s.courier?.pos : undefined;
    const cam = golden.trackingCamera(s.moment, { from: pt(from), to: pt(to), ...(vehicle ? { vehicle: pt(vehicle) } : {}) });
    const padding = { top: s.topInset + 56, bottom: s.bottomInset + 56, left: 48, right: 48 };
    const fit = cam.bounds ? golden.fitCamera(cam.bounds, { width: s.size.w, height: s.size.h, padding, bearing: cam.bearing, maxZoom: cam.maxZoom }) : { center: cam.center!, zoom: cam.zoom! };
    const duration = animate && !s.reduce ? golden.TRACKING_EASE_MS : 0;
    const to3d = { center: fit.center, zoom: fit.zoom, pitch: cam.pitch, bearing: cam.bearing };
    if (duration) camera.current?.easeTo({ ...to3d, duration, easing: 'ease' });
    else camera.current?.jumpTo(to3d);
  };

  // The town's houses arrive with the tiles: light the right one once they are in.
  const findHouses = () => {
    void map.current
      ?.queryRenderedFeatures({ layers: ['golden-houses-3d'] })
      .then((fs) => {
        const out: { ring: Pt[]; hm: number }[] = [];
        for (const f of fs) {
          const g = f.geometry;
          const hm = Number((f.properties as { hm?: number } | null)?.hm ?? 6);
          if (g.type === 'Polygon') out.push({ ring: g.coordinates[0] as Pt[], hm });
          else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) out.push({ ring: poly[0] as Pt[], hm });
        }
        setHouses(out);
      })
      .catch(() => undefined);
  };

  /** The streets on screen for street life, once per camera stop (none when too far out for cars to read). */
  const findRoads = (zoom: number) => {
    if (zoom < golden.LIFE_MINZOOM - 0.3 || !roadLayers.length) {
      setRoads(null);
      return;
    }
    void map.current
      ?.queryRenderedFeatures({ layers: roadLayers })
      .then((fs) => {
        const out: Road[] = [];
        for (const f of fs) {
          const cls = String(f.properties?.cls ?? '');
          const g = f.geometry;
          if (g.type === 'LineString') out.push({ cls, coords: g.coordinates as Pt[] });
          else if (g.type === 'MultiLineString') for (const line of g.coordinates) out.push({ cls, coords: line as Pt[] });
        }
        setRoads(out);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    if (ready) frame(false);
     
  }, [size.w, size.h, ready]);

  // A new moment: ease to its camera (unless the person moved the map).
  useEffect(() => {
    if (ready && live.current.follow) frame(true);
     
  }, [moment, ready, roadQuery.data?.polyline6]);

  // Each position update: keep him and the door in the shot.
  const fixKey = fix ? `${fix.at.getTime()}` : 'none';
  useEffect(() => {
    if (ready && fix && live.current.follow && riding) frame(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixKey, ready]);

  const here = moment === 'kitchen' ? null : courier;
  const route = useMemo(
    () => routeGeoJSON(routeParts(moment, motion.path.value, { kitchen, door: home, d: here?.d ?? null, courier: here?.pos ?? null })),
    // The road comes with the route query; the courier's spot moves it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moment, kitchen, home, here?.d, here?.pos.lat, here?.pos.lng, roadQuery.data?.polyline6],
  );
  const spot = moment === 'kitchen' ? kitchen : home;
  const glow: GeoJSON.FeatureCollection = spot ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pt(spot) } }] } : EMPTY;
  const litAt = moment === 'kitchen' ? kitchen : moment === 'arrived' ? home : null;
  const lit = useMemo(() => (litAt ? litBuilding(litAt, houses) : EMPTY), [litAt, houses]);
  // N6 «ليش متأخر»: the slow stretch still ahead of him, striped, with the reason at its middle.
  const slow = roadQuery.data?.slowStretch ?? null;
  const slowShape = useMemo(
    () => (moment === 'arrived' ? null : slowStretchShape(slowStretchPath(motion.path.value, view, roadQuery.data?.from ?? null), slow, here?.d ?? 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moment, slow?.fromM, slow?.toM, here?.d, roadQuery.data?.polyline6, roadQuery.data?.from],
  );
  const slowLayers = useMemo(() => slowStretchLayers({ source: SRC.slow, light, id: 'track-slow' }), [light]);

  const recentre = () => {
    setFollow(true);
    live.current.follow = true;
    frame(true);
  };

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const ring = theme.colors.accent;
  const name = view.courier?.firstName ?? '';
  const courierSpot = riding ? (courier?.pos ?? null) : moment === 'arrived' && pickedUp ? home : null;
  const layerProps = (l: (typeof layers)[number]) => ({ ...l, beforeId: golden.GOLDEN_FIRST_LABEL }) as unknown as LayerProps;

  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: theme.colors.bg }]} onLayout={onLayout} accessibilityLabel={t('track.map_label')} testID="track-map">
      <ml.Map
        ref={map}
        style={StyleSheet.absoluteFill}
        mapStyle={style}
        attribution={false}
        logo={false}
        compass={false}
        touchRotate={false}
        touchPitch={false}
        onDidFinishLoadingMap={() => setReady(true)}
        onDidFailLoadingMap={onFail}
        onDidFinishRenderingMapFully={() => {
          findHouses();
          void map.current?.getZoom().then(findRoads).catch(() => undefined);
        }}
        onRegionWillChange={(e) => {
          if (e.nativeEvent.userInteraction) setFollow(false);
        }}
        onRegionDidChange={(e) => {
          setBearing(e.nativeEvent.bearing);
          findRoads(e.nativeEvent.zoom);
        }}
      >
        <ml.Camera ref={camera} maxZoom={19} initialViewState={kitchen ?? home ? { center: pt((kitchen ?? home)!), zoom: 16 } : { zoom: 14 }} />
        <ml.Images images={images} />
        {/* Street life under the route and pins (only from LIFE_MINZOOM). */}
        <StreetLifeLayers roads={roads} light={light} still={theme.reduceMotion} beforeId={golden.GOLDEN_FIRST_LABEL} />
        <ml.GeoJSONSource id={SRC.route} data={route} lineMetrics>
          {layers
            .filter((l) => 'source' in l && l.source === SRC.route)
            .map((l) =>
              l.id === 'track-ahead' ? (
                <GlintLayer key={l.id} layer={layerProps(l)} light={light} pulse={fixKey} rest={theme.reduceMotion || !riding} />
              ) : (
                <ml.Layer key={l.id} {...layerProps(l)} />
              ),
            )}
        </ml.GeoJSONSource>
        <ml.GeoJSONSource id={SRC.glow} data={glow}>
          {layers.filter((l) => 'source' in l && l.source === SRC.glow).map((l) => <ml.Layer key={l.id} {...layerProps(l)} />)}
        </ml.GeoJSONSource>
        <ml.GeoJSONSource id={SRC.lit} data={lit as GeoJSON.FeatureCollection}>
          {layers.filter((l) => 'source' in l && l.source === SRC.lit).map((l) => <ml.Layer key={l.id} {...layerProps(l)} />)}
        </ml.GeoJSONSource>
        <ml.GeoJSONSource id={SRC.slow} data={slowShape?.line ?? EMPTY}>
          {slowLayers.map((l) => (
            <ml.Layer key={l.id} {...({ ...l, beforeId: golden.GOLDEN_FIRST_LABEL } as unknown as LayerProps)} />
          ))}
        </ml.GeoJSONSource>
        {/* N6: why it's late, just under the middle of the striped stretch (pins rise above their point). */}
        {slow && slowShape?.mid ? (
          <ml.Marker id="slow-stretch" lngLat={pt(slowShape.mid)} anchor="top" offset={[0, 10]}>
            <View pointerEvents="none" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: theme.colors.danger }} testID="slow-stretch-chip">
              <Icon name={SLOW_COPY[slow.reason].icon} size={14} color="onDanger" strokeWidth={2.4} />
              <Text variant="caption" weight={700} color="onDanger" numberOfLines={1} tabular>
                {t(SLOW_COPY[slow.reason].map, { minutes: slow.minutes })}
              </Text>
            </View>
          </ml.Marker>
        ) : null}
        {/* Restaurant: saffron teardrop with the food icon. */}
        {moment === 'kitchen' && kitchen ? (
          <ml.Marker id="pin-kitchen" lngLat={pt(kitchen)} anchor="bottom">
            <View pointerEvents="none" testID="pin-kitchen">
              <Teardrop fill={theme.colors.accent} halo={withAlpha(theme.colors.accent, 0.25)}>
                <Icon name="food" size={18} color="text" strokeWidth={2.2} />
              </Teardrop>
            </View>
          </ml.Marker>
        ) : null}
        {/* The door: dark teardrop, home icon, cream halo. */}
        {home ? (
          <ml.Marker id="pin-home" lngLat={pt(home)} anchor="bottom">
            <View pointerEvents="none" testID="pin-home">
              <Teardrop fill={theme.colors.text} halo={withAlpha(theme.colors.surface, 0.7)}>
                <Icon name="home" size={18} color="surface" strokeWidth={2.2} />
              </Teardrop>
            </View>
          </ml.Marker>
        ) : null}
        {/* The courier: his approved photo in a ring of the service colour, a small wedge for his heading. */}
        {courierSpot ? (
          <ml.Marker id="courier" lngLat={pt(courierSpot)} anchor="center" offset={moment === 'arrived' ? [PIN, -PIN / 2] : [0, 0]}>
            <View pointerEvents="none" style={{ alignItems: 'center' }} testID="courier-marker">
              {moment === 'arrived' ? (
                <View style={{ marginBottom: 6, paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: theme.colors.text, justifyContent: 'center' }}>
                  <Text variant="caption" weight={600} color="surface" numberOfLines={1}>
                    {t('track.map_at_door')}
                  </Text>
                </View>
              ) : null}
              <View style={{ width: PHOTO, height: PHOTO, alignItems: 'center', justifyContent: 'center' }}>
                {riding && courier ? (
                  <View style={[StyleSheet.absoluteFill, { alignItems: 'center', transform: [{ rotate: `${courier.heading - bearing}deg` }] }]}>
                    <View style={{ marginTop: -7, width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderBottomWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: ring }} />
                  </View>
                ) : null}
                <View style={{ width: PHOTO, height: PHOTO, borderRadius: PHOTO / 2, borderWidth: RING_W, borderColor: stale ? theme.colors.borderStrong : ring, backgroundColor: theme.colors.surface, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                  <Avatar name={name} uri={apiPhoto(view.courier?.photoUrl) ?? undefined} size={PHOTO - RING_W * 2} />
                </View>
              </View>
            </View>
          </ml.Marker>
        ) : null}
      </ml.Map>
      {!follow ? <RecentreChip bottom={bottomInset + theme.space[5]} onPress={recentre} /> : null}
      <Text variant="caption" color="textMuted" style={{ position: 'absolute', right: theme.space[3], bottom: bottomInset + theme.space[1], fontSize: 10, lineHeight: 14, opacity: 0.8 }}>
        {MAP_CREDIT}
      </Text>
    </View>
  );
}

/** Phones draw the order map in 3D when the build has the native map and our map's files are set up. */
export const TRACK_3D = nativeGolden();
