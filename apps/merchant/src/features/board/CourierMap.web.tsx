import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import type { LatLng } from '@driver/contracts';
import { useLiteMode, useTheme } from '@driver/ui';
import { goldenMapUrls } from '@/features/area/golden-zones';
import { useT } from '@/lib/i18n';
import { metresBetween, nextTrails, panelCamera, pinned, trailGeoJSON, warmAt, warmNow, WARM_MS, type ComingCourier, type LngLat } from './courier-map';
import { ComingChip, CourierPin, ShopTag } from './CourierMapParts';

// Inlined by the build (Expo only replaces `process.env.EXPO_PUBLIC_*` written out in full).
const URLS = goldenMapUrls({ EXPO_PUBLIC_MAP_TILES_URL: process.env.EXPO_PUBLIC_MAP_TILES_URL, EXPO_PUBLIC_MAP_GLYPHS_URL: process.env.EXPO_PUBLIC_MAP_GLYPHS_URL });

/** Whether this build can draw the courier map: our map's two files are set. */
export const COURIER_MAP = !!URLS;

export interface CourierMapProps {
  kitchen: LatLng;
  couriers: ComingCourier[];
  height: number;
}

const SHOP = 'shop';
const TRAIL = 'n16-trail';
/** Re-frame only when the nearest courier changes or moves this far (a calm camera, not one per fix). */
const REFRAME_M = 60;
/** The houses stand up from here: the panel shows a few streets, a little wider than the customer's close-ups. */
const RISE_AT = 15.6;
let protocolAdded = false;

/**
 * N16 on the web board (studio and the merchant site once it has map files): the Golden hour map in 3D
 * with the shop lit, each courier's photo coming up the street with his minutes, the dotted way behind
 * him, and the shop warming once when the first is 2 minutes out. Without map files, in low-data mode,
 * or when the map fails, the panel isn't shown: his line on the ticket says the same.
 */
export function CourierMap(props: CourierMapProps) {
  const lite = useLiteMode();
  const [failed, setFailed] = useState(false);
  if (!URLS || lite || failed) return null;
  return <GoldenCourierMap {...props} urls={URLS} onFail={() => setFailed(true)} />;
}

function GoldenCourierMap({ kitchen, couriers, height, urls, onFail }: CourierMapProps & { urls: { tilesUrl: string; glyphsUrl: string }; onFail: () => void }) {
  const theme = useTheme();
  const t = useT();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const goldenRef = useRef<typeof import('@driver/map/golden') | null>(null);
  const [width, setWidth] = useState(0);
  const [ready, setReady] = useState(false);
  // Where each pin sits on screen, re-projected as the camera moves.
  const [screen, setScreen] = useState<{ shop: { x: number; y: number } | null; couriers: Record<string, { x: number; y: number }> }>({ shop: null, couriers: {} });
  const trails = useRef(new Map<string, LngLat[]>());
  const warmed = useRef(new Set<string>());
  const framed = useRef<{ orderId: string; at: LngLat } | null>(null);
  const shopAt: LngLat = useMemo(() => [kitchen.lng, kitchen.lat], [kitchen.lat, kitchen.lng]);
  const live = useRef({ couriers, shopAt, onFail, reduce: theme.reduceMotion });
  live.current = { couriers, shopAt, onFail, reduce: theme.reduceMotion };

  const project = () => {
    const m = mapRef.current;
    if (!m) return;
    const p = (at: LngLat) => {
      const s = m.project(at);
      return { x: s.x, y: s.y };
    };
    setScreen({ shop: p(live.current.shopAt), couriers: Object.fromEntries(live.current.couriers.map((c) => [c.orderId, p(c.at)])) });
  };

  const frame = (animate: boolean) => {
    const m = mapRef.current;
    const golden = goldenRef.current;
    const s = live.current;
    if (!m || !golden || !width) return;
    const first = s.couriers[0];
    const last = framed.current;
    if (animate && last && first && last.orderId === first.orderId && metresBetween(last.at, first.at) < REFRAME_M) return;
    framed.current = first ? { orderId: first.orderId, at: first.at } : null;
    const cam = panelCamera(golden, { lat: s.shopAt[1], lng: s.shopAt[0] }, s.couriers, { w: width, h: height });
    if (!animate || s.reduce) m.jumpTo(cam);
    else m.easeTo({ ...cam, duration: 1200 });
  };

  useEffect(() => {
    if (!width) return;
    let cancelled = false;
    let stopWatching = () => undefined as void;
    let map: MlMap | null = null;
    void Promise.all([import('maplibre-gl'), import('pmtiles'), import('@driver/map'), import('@driver/map/golden')])
      .then(([ml, pm, base, golden]) => {
        const maplibregl = (ml as unknown as { default?: typeof ml }).default ?? ml;
        if (cancelled || !container.current) return;
        goldenRef.current = golden;
        if (!protocolAdded) {
          protocolAdded = true;
          maplibregl.addProtocol('pmtiles', new pm.Protocol().tile);
          if (maplibregl.getRTLTextPluginStatus() === 'unavailable') void maplibregl.setRTLTextPlugin(base.RTL_TEXT_PLUGIN_URL, true);
        }
        const { light } = golden.resolveLight();
        const { style } = golden.chooseMapStyle({ tilesUrl: urls.tilesUrl, glyphsUrl: urls.glyphsUrl, mode: 'customer', light, riseAt: RISE_AT, fallback: { theme: 'light' } });
        const shop = [{ id: SHOP, at: live.current.shopAt }];
        // No house standing where the shop does.
        const hide = golden.restaurantHouseFilter(shop, null);
        const hidden: ReadonlySet<string> = new Set(golden.RESTAURANT_HIDES_HOUSE_LAYERS);
        style.layers = style.layers.map((l) => {
          if (l.id === 'golden-places') return { ...l, layout: { ...l.layout, visibility: 'none' } } as typeof l;
          if (!hidden.has(l.id)) return l;
          const own = 'filter' in l ? l.filter : undefined;
          return { ...l, filter: own ? ['all', own, hide] : hide } as typeof l;
        });
        const cam = panelCamera(golden, { lat: live.current.shopAt[1], lng: live.current.shopAt[0] }, live.current.couriers, { w: width, h: height });
        try {
          map = new maplibregl.Map({
            container: container.current,
            style,
            center: cam.center,
            zoom: cam.zoom,
            bearing: cam.bearing,
            pitch: cam.pitch,
            attributionControl: { compact: true },
            interactive: false,
            fadeDuration: 0,
          });
        } catch {
          live.current.onFail();
          return;
        }
        mapRef.current = map;
        framed.current = live.current.couriers[0] ? { orderId: live.current.couriers[0].orderId, at: live.current.couriers[0].at } : null;
        const m = map;
        for (const [id, img] of Object.entries(golden.goldenImages(light))) m.addImage(id, img);
        stopWatching = golden.fallBackToOriginalMap(m as unknown as Parameters<typeof golden.fallBackToOriginalMap>[0], { onFallback: () => live.current.onFail() });
        m.on('error', () => undefined);
        m.on('move', project);
        m.once('load', () => {
          m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
          const before = m.getLayer(golden.GOLDEN_FIRST_LABEL) ? golden.GOLDEN_FIRST_LABEL : undefined;
          // The shop, lit (the restaurant map's own model of it).
          const scene = golden.restaurantScene(shop, { light, selectedId: SHOP });
          m.addSource(golden.RESTAURANT_SOURCES.solid, { type: 'geojson', data: scene.solid as never });
          m.addSource(golden.RESTAURANT_SOURCES.soft, { type: 'geojson', data: scene.soft as never });
          m.addSource(golden.RESTAURANT_SOURCES.glow, { type: 'geojson', data: scene.glow as never });
          for (const l of golden.restaurantLayers(light)) m.addLayer(l as never, before);
          // The way he came: saffron dots, older ones fainter.
          m.addSource(TRAIL, { type: 'geojson', data: trailGeoJSON(trails.current) as never });
          m.addLayer({ id: TRAIL, type: 'circle', source: TRAIL, paint: { 'circle-radius': 4, 'circle-color': theme.colors.accent, 'circle-opacity': ['get', 'a'] as never, 'circle-stroke-color': theme.colors.surface, 'circle-stroke-width': 1, 'circle-pitch-alignment': 'map' } });
          setReady(true);
          project();
        });
      })
      .catch(() => live.current.onFail());
    return () => {
      cancelled = true;
      stopWatching();
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Built once per size; couriers update in place below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width > 0, urls.tilesUrl, urls.glyphsUrl, shopAt[0], shopAt[1]]);

  // New fixes: the trail grows, the camera follows calmly, the pins move, and the shop warms once at 2 minutes.
  const key = couriers.map((c) => `${c.orderId}:${c.at[0].toFixed(6)},${c.at[1].toFixed(6)}:${c.etaMinutes ?? ''}`).join('|');
  useEffect(() => {
    trails.current = nextTrails(trails.current, couriers);
    const m = mapRef.current;
    if (!m || !ready) return;
    m.getSource<GeoJSONSource>(TRAIL)?.setData(trailGeoJSON(trails.current) as never);
    frame(true);
    project();
    const w = warmNow(warmed.current, couriers);
    warmed.current = w.warmed;
    if (w.warm && !theme.reduceMotion) warm(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  useEffect(() => {
    if (!ready) return;
    mapRef.current?.resize();
    frame(false);
    project();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, ready]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  return (
    <View testID="courier-map" onLayout={onLayout} accessibilityRole="image" accessibilityLabel={t('merchant.courier_map.label')} style={{ width: '100%', height, marginTop: theme.space[3], borderRadius: theme.radius['2xl'], overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
      <div ref={container} data-testid="courier-map-golden" style={{ position: 'absolute', inset: 0 }} />
      {ready && screen.shop ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: screen.shop.x, top: screen.shop.y - 48, transform: [{ translateX: '-50%' }] }}>
          <ShopTag />
        </View>
      ) : null}
      {ready
        ? pinned(couriers).map((c) => {
            const p = screen.couriers[c.orderId];
            return p ? (
              <View key={c.orderId} pointerEvents="none" style={{ position: 'absolute', left: p.x, top: p.y, transform: [{ translateX: '-50%' }, { translateY: '-100%' }] }}>
                <CourierPin courier={c} />
              </View>
            ) : null;
          })
        : null}
      <ComingChip count={couriers.length} />
    </View>
  );
}

/** The one warm: the shop's pool of light rises and settles over WARM_MS, then rests lit. */
function warm(m: MlMap) {
  const layer = 'golden-restaurant-glow';
  if (!m.getLayer(layer)) return;
  const rest = m.getPaintProperty(layer, 'circle-opacity');
  const start = performance.now();
  const step = () => {
    if (!m.getLayer(layer)) return;
    const t = performance.now() - start;
    if (t >= WARM_MS) {
      m.setPaintProperty(layer, 'circle-opacity', rest as never);
      return;
    }
    m.setPaintProperty(layer, 'circle-opacity', Math.min(1, 0.5 + warmAt(t) * 0.5));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
