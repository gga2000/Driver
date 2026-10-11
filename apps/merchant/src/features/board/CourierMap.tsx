import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, TurboModuleRegistry, View, type LayoutChangeEvent } from 'react-native';
import type * as Mlrn from '@maplibre/maplibre-react-native';
import type { CameraRef, LayerProps, StyleSpecification } from '@maplibre/maplibre-react-native';
import type { LatLng } from '@driver/contracts';
import * as golden from '@driver/map/golden';
import { useLiteMode, useTheme } from '@driver/ui';
import { goldenMapUrls } from '@/features/area/golden-zones';
import { useT } from '@/lib/i18n';
import { metresBetween, nextTrails, panelCamera, pinned, trailGeoJSON, warmAt, warmNow, WARM_MS, type ComingCourier, type LngLat } from './courier-map';
import { ComingChip, CourierPin, ShopTag } from './CourierMapParts';

const URLS = goldenMapUrls({ EXPO_PUBLIC_MAP_TILES_URL: process.env.EXPO_PUBLIC_MAP_TILES_URL, EXPO_PUBLIC_MAP_GLYPHS_URL: process.env.EXPO_PUBLIC_MAP_GLYPHS_URL });

/**
 * The tablet's map (MapLibre Native), loaded only where the app was built with it: Expo Go and older
 * builds have no native map, so the panel stays away instead of crashing on import.
 */
let loaded: typeof Mlrn | null | undefined;
function nativeMapLibre(): typeof Mlrn | null {
  if (loaded !== undefined) return loaded;
  try {
    // A runtime require: importing it in a build without the native map throws at load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = TurboModuleRegistry.get('MLRNMapViewModule') ? (require('@maplibre/maplibre-react-native') as typeof Mlrn) : null;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** Whether this build can draw the courier map: our map's two files are set and the native map is in it. */
export const COURIER_MAP = !!URLS && nativeMapLibre() !== null;

export interface CourierMapProps {
  kitchen: LatLng;
  couriers: ComingCourier[];
  height: number;
}

const SHOP = 'shop';
const TRAIL = 'n16-trail';
const GLOW = 'golden-restaurant-glow';
/** Re-frame only when the nearest courier changes or moves this far (a calm camera, not one per fix). */
const REFRAME_M = 60;
/** The houses stand up from here: the panel shows a few streets, a little wider than the customer's close-ups. */
const RISE_AT = 15.6;
/** The warm's steps over the bridge (the drawing is cheap; the bridge is the cost). */
const WARM_STEP_MS = 120;

/**
 * N16 on the tablet: the Golden hour map in 3D with the shop lit, each courier's photo coming up the
 * street with his minutes, the dotted way behind him, and the shop warming once when the first is 2
 * minutes out. The web board draws the same (CourierMap.web.tsx). Without the native map or map files,
 * in low-data mode, or when the map fails, the panel isn't shown: his line on the ticket says the same.
 */
export function CourierMap(props: CourierMapProps) {
  const lite = useLiteMode();
  const [failed, setFailed] = useState(false);
  if (!COURIER_MAP || lite || failed) return null;
  return <NativeCourierMap {...props} onFail={() => setFailed(true)} />;
}

function NativeCourierMap({ kitchen, couriers, height, onFail }: CourierMapProps & { onFail: () => void }) {
  const ml = nativeMapLibre()!;
  const theme = useTheme();
  const t = useT();
  const camera = useRef<CameraRef>(null);
  const [ready, setReady] = useState(false);
  const [width, setWidth] = useState(0);
  const [glow, setGlow] = useState(0);
  const [trails, setTrails] = useState(() => new Map<string, LngLat[]>());
  const warmed = useRef(new Set<string>());
  const framed = useRef<{ orderId: string; at: LngLat } | null>(null);
  const shopAt: LngLat = useMemo(() => [kitchen.lng, kitchen.lat], [kitchen.lat, kitchen.lng]);
  const light = useMemo(() => golden.resolveLight().light, []);
  const shop = useMemo(() => [{ id: SHOP, at: shopAt }], [shopAt]);

  const style = useMemo(() => {
    const { style: s } = golden.chooseMapStyle({ tilesUrl: URLS!.tilesUrl, glyphsUrl: URLS!.glyphsUrl, mode: 'customer', light, riseAt: RISE_AT });
    const { sky: _sky, ...rest } = s as unknown as StyleSpecification & { sky?: unknown };
    const hide = golden.restaurantHouseFilter(shop, null);
    const hidden: ReadonlySet<string> = new Set(golden.RESTAURANT_HIDES_HOUSE_LAYERS);
    const layers = rest.layers.map((l) => {
      if (l.id === 'golden-places') return { ...l, layout: { ...l.layout, visibility: 'none' } };
      if (!hidden.has(l.id)) return l;
      const own = 'filter' in l ? l.filter : undefined;
      return { ...l, filter: own ? ['all', own, hide] : hide };
    });
    return { ...rest, layers } as StyleSpecification;
  }, [light, shop]);
  const images = useMemo(() => Object.fromEntries(Object.entries(golden.goldenImages(light)).map(([id, img]) => [id, golden.patternPngDataUri(img)])), [light]);
  const scene = useMemo(() => golden.restaurantScene(shop, { light, selectedId: SHOP }), [shop, light]);
  const layers = useMemo(() => golden.restaurantLayers(light), [light]);

  const live = useRef({ couriers, width, height, reduce: theme.reduceMotion });
  live.current = { couriers, width, height, reduce: theme.reduceMotion };

  const frame = (animate: boolean) => {
    const s = live.current;
    if (!s.width) return;
    const first = s.couriers[0];
    const last = framed.current;
    if (animate && last && first && last.orderId === first.orderId && metresBetween(last.at, first.at) < REFRAME_M) return;
    framed.current = first ? { orderId: first.orderId, at: first.at } : null;
    const cam = panelCamera(golden, kitchen, s.couriers, { w: s.width, h: s.height });
    if (!animate || s.reduce) camera.current?.jumpTo(cam);
    else camera.current?.easeTo({ ...cam, duration: 1200, easing: 'ease' });
  };

  // New fixes: the trail grows, the camera follows calmly, and the shop warms once at 2 minutes.
  const key = couriers.map((c) => `${c.orderId}:${c.at[0].toFixed(6)},${c.at[1].toFixed(6)}:${c.etaMinutes ?? ''}`).join('|');
  useEffect(() => {
    setTrails((prev) => nextTrails(prev, couriers));
    if (!ready) return;
    frame(true);
    const w = warmNow(warmed.current, couriers);
    warmed.current = w.warmed;
    if (!w.warm || theme.reduceMotion) return;
    const start = Date.now();
    const timer = setInterval(() => {
      const dt = Date.now() - start;
      setGlow(warmAt(dt));
      if (dt >= WARM_MS) clearInterval(timer);
    }, WARM_STEP_MS);
    return () => {
      clearInterval(timer);
      setGlow(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  useEffect(() => {
    if (ready) frame(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, width, height]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const sourceOf = (l: (typeof layers)[number]) => ('source' in l ? l.source : '');
  const layerProps = (l: (typeof layers)[number]) => {
    const p = { ...l, beforeId: golden.GOLDEN_FIRST_LABEL } as unknown as LayerProps & { paint?: Record<string, unknown> };
    // The one warm: the shop's pool of light rises over its lit resting glow and settles back.
    if (l.id === GLOW && glow > 0) return { ...p, paint: { ...p.paint, 'circle-opacity': Math.min(1, 0.5 + glow * 0.5) } } as unknown as LayerProps;
    return p as LayerProps;
  };
  const trailData = useMemo(() => trailGeoJSON(trails), [trails]);
  const initial = useMemo(() => panelCamera(golden, kitchen, couriers, { w: width || 600, h: height }), [width > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View testID="courier-map" onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={t('merchant.courier_map.label')} style={{ width: '100%', height, marginTop: theme.space[3], borderRadius: theme.radius['2xl'], overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
      {width > 0 ? (
        <ml.Map
          style={StyleSheet.absoluteFill}
          mapStyle={style}
          attribution={false}
          logo={false}
          compass={false}
          dragPan={false}
          touchZoom={false}
          doubleTapZoom={false}
          touchRotate={false}
          touchPitch={false}
          onDidFinishLoadingMap={() => setReady(true)}
          onDidFailLoadingMap={onFail}
        >
          <ml.Camera ref={camera} maxZoom={19} initialViewState={initial} />
          <ml.Images images={images} />
          <ml.GeoJSONSource id={golden.RESTAURANT_SOURCES.solid} data={scene.solid as GeoJSON.FeatureCollection}>
            {layers.filter((l) => sourceOf(l) === golden.RESTAURANT_SOURCES.solid).map((l) => <ml.Layer key={l.id} {...layerProps(l)} />)}
          </ml.GeoJSONSource>
          <ml.GeoJSONSource id={golden.RESTAURANT_SOURCES.soft} data={scene.soft as GeoJSON.FeatureCollection}>
            {layers.filter((l) => sourceOf(l) === golden.RESTAURANT_SOURCES.soft).map((l) => <ml.Layer key={l.id} {...layerProps(l)} />)}
          </ml.GeoJSONSource>
          <ml.GeoJSONSource id={golden.RESTAURANT_SOURCES.glow} data={scene.glow as GeoJSON.FeatureCollection}>
            {layers.filter((l) => sourceOf(l) === golden.RESTAURANT_SOURCES.glow).map((l) => <ml.Layer key={l.id} {...layerProps(l)} />)}
          </ml.GeoJSONSource>
          <ml.GeoJSONSource id={TRAIL} data={trailData as GeoJSON.FeatureCollection}>
            <ml.Layer
              {...({ id: TRAIL, type: 'circle', paint: { 'circle-radius': 4, 'circle-color': theme.colors.accent, 'circle-opacity': ['get', 'a'], 'circle-stroke-color': theme.colors.surface, 'circle-stroke-width': 1, 'circle-pitch-alignment': 'map' } } as unknown as LayerProps)}
            />
          </ml.GeoJSONSource>
          <ml.Marker id="n16-shop" lngLat={shopAt} anchor="bottom" offset={[0, -24]}>
            <ShopTag />
          </ml.Marker>
          {pinned(couriers).map((c) => (
            <ml.Marker key={c.orderId} id={`n16-${c.orderId}`} lngLat={c.at} anchor="bottom">
              <CourierPin courier={c} />
            </ml.Marker>
          ))}
        </ml.Map>
      ) : null}
      <ComingChip count={couriers.length} />
    </View>
  );
}
