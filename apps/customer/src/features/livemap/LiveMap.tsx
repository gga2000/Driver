import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { CameraRef, LayerProps, MapRef } from '@maplibre/maplibre-react-native';
import * as golden from '@driver/map/golden';
import { useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { nativeGolden, nativeGoldenImages, nativeGoldenStyle, nativeMapLibre } from '@/features/track/map/native-maplibre';
import { framePoints, type LiveOrder, type LivePin } from './logic';
import { CourierDisc, HomePin, LiveBubble, LiveDot, OrderKitchen } from './Markers';

type Pt = [number, number];

export interface LiveMapProps {
  pins: LivePin[];
  bubbles: ReadonlySet<string>;
  home: Pt;
  homeLabel: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  order: LiveOrder | null;
  topInset: number;
  bottomInset: number;
  lite: boolean;
  onFail: () => void;
}

/** Whether this build can draw the live map (a phone build with the native map and our map's files). */
export const LIVE_MAP = nativeGolden();

const TOWN_MAX_ZOOM = 16.4;
const TOWN_MIN_ZOOM = 14.6;
const ROUTE = 'live-route';
const ROUTE_PINS = 'live-route-pins';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * «العزيزية هسة» on phones (MapLibre Native), the same map as the web (LiveMap.web.tsx): the town around
 * their place with every shop as its 3D front, bubbles for shops cooking now and the soonest, dots for the
 * rest; with an order on its way, the kitchen, their courier on the street route and their door.
 * Markers are the map's own. Reduce motion jumps; lite mode is the flat map.
 */
export function LiveMap({ pins, bubbles, home, homeLabel, selectedId, onSelect, order, topInset, bottomInset, lite, onFail }: LiveMapProps) {
  const ml = nativeMapLibre()!;
  const theme = useTheme();
  const t = useT();
  const map = useRef<MapRef>(null);
  const camera = useRef<CameraRef>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [facing, setFacing] = useState<Record<string, number>>({});
  const light = useMemo(() => golden.resolveLight().light, []);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const turned = useRef(false);
  /** The last town view, so the first slow turn starts from it. */
  const townCam = useRef<{ center: Pt; zoom: number; bearing: number; pitch: number } | null>(null);

  const list = useMemo(() => pins.map((x) => ({ id: x.id, at: x.at, facing: facing[x.id], kind: golden.restaurantKindOf([x.card.cuisine, ...x.card.tags]) })), [pins, facing]);
  const shopKey = pins.map((s) => s.id).join(',');
  const style = useMemo(() => {
    const s = nativeGoldenStyle(golden, light, lite ? 'lite' : 'customer');
    const hide = golden.restaurantHouseFilter(list.map(({ id, at }) => ({ id, at })), null);
    const hidden: ReadonlySet<string> = new Set(golden.RESTAURANT_HIDES_HOUSE_LAYERS);
    const layers = s.layers.map((l) => {
      if (l.id === 'golden-places') return { ...l, layout: { ...l.layout, visibility: 'none' } };
      if (!hidden.has(l.id) || !('filter' in l || 'source' in l)) return l;
      const own = 'filter' in l ? l.filter : undefined;
      return { ...l, filter: own ? ['all', own, hide] : hide };
    });
    return { ...s, layers } as typeof s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [light, lite, shopKey]);
  const images = useMemo(() => nativeGoldenImages(golden, light), [light]);
  const scene = useMemo(() => golden.restaurantScene(list, { light, selectedId }), [list, light, selectedId]);
  const layers = useMemo(() => golden.restaurantLayers(light), [light]);
  const routeLayers = useMemo(() => golden.goldenRouteLayers({ service: 'food', light, routeSource: ROUTE, pinSource: ROUTE_PINS, id: ROUTE }), [light]);
  const houseLayers = useMemo(() => {
    const hide = golden.restaurantHouseFilter(list, selectedId);
    const ids: ReadonlySet<string> = new Set(golden.RESTAURANT_HIDES_HOUSE_LAYERS);
    return style.layers
      .filter((l) => ids.has(l.id))
      .map((l) => {
        const own = 'filter' in l ? l.filter : undefined;
        return { id: l.id, type: l.type, filter: own ? ['all', own, hide] : hide } as unknown as LayerProps;
      });
  }, [list, selectedId, style]);
  const roadLayers = useMemo(() => style.layers.filter((l) => 'source-layer' in l && l['source-layer'] === 'roads').map((l) => l.id), [style]);
  const route = useMemo<GeoJSON.FeatureCollection>(
    () => (order?.route && order.route.length > 1 ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { part: 'ahead' }, geometry: { type: 'LineString', coordinates: order.route } }] } : EMPTY),
    [order?.route],
  );

  const live = useRef({ pins, bubbles, home, selectedId, order, topInset, bottomInset, lite, size, facing, reduce: theme.reduceMotion });
  live.current = { pins, bubbles, home, selectedId, order, topInset, bottomInset, lite, size, facing, reduce: theme.reduceMotion };

  const faceStreets = () => {
    if (lite || !roadLayers.length) return;
    void map.current
      ?.queryRenderedFeatures({ layers: roadLayers })
      .then((fs) => {
        const roads: { cls: string; coords: Pt[] }[] = [];
        for (const f of fs) {
          const cls = String(f.properties?.cls ?? '');
          const g = f.geometry;
          if (g.type === 'LineString') roads.push({ cls, coords: g.coordinates as Pt[] });
          else if (g.type === 'MultiLineString') for (const line of g.coordinates) roads.push({ cls, coords: line as Pt[] });
        }
        if (!roads.length) return;
        const known = live.current.facing;
        const next: Record<string, number> = {};
        for (const s of live.current.pins) if (known[s.id] === undefined) next[s.id] = golden.faceRoad(s.at, roads);
        if (Object.keys(next).length) setFacing((f) => ({ ...f, ...next }));
      })
      .catch(() => undefined);
  };

  const frame = (animate: boolean) => {
    const s = live.current;
    if (!s.size.w) return;
    clearTimeout(settleTimer.current);
    const padding = { top: s.topInset + 24, bottom: s.bottomInset + 24, left: 32, right: 32 };
    const quiet = !animate || s.reduce || s.lite;
    const shop = s.order ? null : s.pins.find((x) => x.id === s.selectedId);
    if (!shop) {
      // Their place with the nearest named shops; the furthest drop out until the town stays close (TOWN_MIN_ZOOM).
      const points = framePoints(s.home, s.pins, s.bubbles, s.order);
      const fitOf = (pts: Pt[]) => {
        const over = golden.restaurantOverview(pts.map((at) => ({ at })));
        if (!over) return null;
        const bearing = s.lite ? 0 : over.bearing;
        const maxZoom = s.order ? over.maxZoom : TOWN_MAX_ZOOM;
        const fit = golden.fitCamera([over.bounds[0], over.bounds[1]], { width: s.size.w, height: s.size.h, padding: { ...padding, left: 110, right: 110 }, bearing, maxZoom });
        return { center: fit.center, zoom: fit.zoom, bearing, pitch: s.lite ? 0 : over.pitch };
      };
      let cam = fitOf(points);
      while (!s.order && cam && cam.zoom < TOWN_MIN_ZOOM && points.length > 1) {
        points.pop();
        cam = fitOf(points);
      }
      if (!cam) return;
      if (!s.order) townCam.current = { center: cam.center as Pt, zoom: cam.zoom, bearing: cam.bearing, pitch: cam.pitch };
      if (quiet) camera.current?.jumpTo(cam);
      else camera.current?.easeTo({ ...cam, duration: 1600, easing: 'ease' });
      return;
    }
    const at = { at: shop.at, facing: s.facing[shop.id] };
    const cam = golden.restaurantFocusCamera(at);
    if (s.lite) {
      camera.current?.jumpTo({ center: cam.center, zoom: 18, pitch: 0, bearing: 0, padding });
      return;
    }
    if (quiet) {
      camera.current?.jumpTo({ ...cam, padding });
      return;
    }
    camera.current?.flyTo({ ...cam, padding, duration: golden.RESTAURANT_FLY_MS, easing: 'fly' });
    const id = shop.id;
    settleTimer.current = setTimeout(() => {
      if (live.current.selectedId !== id || live.current.reduce) return;
      camera.current?.easeTo({ ...golden.restaurantSettledCamera(at), padding, duration: golden.RESTAURANT_SETTLE_MS, easing: 'ease' });
    }, golden.RESTAURANT_FLY_MS + 50);
  };

  useEffect(() => () => clearTimeout(settleTimer.current), []);

  useEffect(() => {
    if (!ready) return;
    frame(false);
    // On first open only: the camera turns slowly once over the town.
    const s = live.current;
    if (turned.current || s.reduce || s.lite || s.selectedId || s.order || !s.size.w) return;
    turned.current = true;
    settleTimer.current = setTimeout(() => {
      const from = townCam.current;
      if (from && !live.current.selectedId) camera.current?.easeTo({ ...from, bearing: from.bearing + 12, duration: 7000, easing: 'ease' });
    }, 600);
  }, [ready, size.w, size.h]);

  const orderId = order?.id ?? null;
  useEffect(() => {
    if (ready) frame(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, orderId]);

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const sourceOf = (l: object) => ('source' in l ? (l as { source: unknown }).source : '');
  const layerProps = (l: object) => ({ ...l, beforeId: golden.GOLDEN_FIRST_LABEL }) as unknown as LayerProps;
  const dim = Boolean(order);

  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: theme.colors.bg }]} onLayout={onLayout} testID="live-map">
      <ml.Map
        ref={map}
        style={StyleSheet.absoluteFill}
        mapStyle={style}
        attribution={false}
        logo={false}
        compass={false}
        onDidFinishLoadingMap={() => setReady(true)}
        onDidFailLoadingMap={onFail}
        onDidFinishRenderingMapFully={faceStreets}
        onRegionDidChange={faceStreets}
      >
        <ml.Camera ref={camera} maxZoom={20} initialViewState={{ center: home, zoom: 15 }} />
        <ml.Images images={images} />
        {houseLayers.map((l) => (
          <ml.Layer key={l.id} {...l} />
        ))}
        <ml.GeoJSONSource id={ROUTE} data={route}>
          {routeLayers.filter((l) => sourceOf(l) === ROUTE).map((l) => <ml.Layer key={l.id} {...layerProps(l)} />)}
        </ml.GeoJSONSource>
        {lite ? null : (
          <>
            <ml.GeoJSONSource id={golden.RESTAURANT_SOURCES.solid} data={scene.solid as GeoJSON.FeatureCollection}>
              {layers.filter((l) => sourceOf(l) === golden.RESTAURANT_SOURCES.solid).map((l) => <ml.Layer key={l.id} {...layerProps(l)} />)}
            </ml.GeoJSONSource>
            <ml.GeoJSONSource id={golden.RESTAURANT_SOURCES.soft} data={scene.soft as GeoJSON.FeatureCollection}>
              {layers.filter((l) => sourceOf(l) === golden.RESTAURANT_SOURCES.soft).map((l) => <ml.Layer key={l.id} {...layerProps(l)} />)}
            </ml.GeoJSONSource>
            <ml.GeoJSONSource id={golden.RESTAURANT_SOURCES.glow} data={scene.glow as GeoJSON.FeatureCollection}>
              {layers.filter((l) => sourceOf(l) === golden.RESTAURANT_SOURCES.glow).map((l) => <ml.Layer key={l.id} {...layerProps(l)} />)}
            </ml.GeoJSONSource>
          </>
        )}
        {pins
          .filter((p) => p.id !== selectedId)
          .map((p) => {
            const named = !dim && bubbles.has(p.id);
            return (
              <ml.Marker key={p.id} id={`live-${p.id}`} lngLat={p.at} anchor={named ? 'bottom' : 'center'}>
                <Pressable
                  onPress={() => onSelect(p.id)}
                  disabled={dim}
                  accessibilityRole="button"
                  accessibilityLabel={p.card.open && p.minutes !== null ? t('live_map.pin_label', { name: p.card.name, n: p.minutes }) : t('live_map.pin_closed', { name: p.card.name })}
                  testID={`live-pin-${p.id}`}
                  style={styles.mark}
                >
                  {named ? <LiveBubble pin={p} /> : <LiveDot pin={p} dim={dim} />}
                </Pressable>
              </ml.Marker>
            );
          })}
        {homeLabel ? (
          <ml.Marker id="live-home" lngLat={home} anchor="bottom">
            <HomePin label={homeLabel} />
          </ml.Marker>
        ) : null}
        {order?.kitchen ? (
          <ml.Marker id="live-order-kitchen" lngLat={order.kitchen.at} anchor="bottom">
            <OrderKitchen name={order.kitchen.name} cooking={order.cooking} />
          </ml.Marker>
        ) : null}
        {order?.courier ? (
          <ml.Marker id="live-courier" lngLat={order.courier} anchor="center">
            <CourierDisc />
          </ml.Marker>
        ) : null}
      </ml.Map>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44 },
});
