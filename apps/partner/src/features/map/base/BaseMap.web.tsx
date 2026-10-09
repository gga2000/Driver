import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { useLiteMode } from '@driver/ui';
import { StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import type { GeoJSONSource, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { buildMapStyle, buildPlacedZonesGeoJSON, LAYER, RTL_TEXT_PLUGIN_URL, SOURCE } from '@driver/map';
import { fallBackToOriginalMap, goldenImages, type FallbackMap, type GoldenLight } from '@driver/map/golden';
import { courierGoldenStyle, goldenLightFor, LIGHT_CHECK_MS, MAP_URLS } from './golden-map';
import { SvgBase } from './SvgBase';
import type { BaseMapProps } from './types';
import { LandmarkLayer } from './LandmarkLayer';
import { ZoneLayer } from './ZoneLayer';
import { MAP_COLORS_NIGHT, useMapColors } from './mapColors';
import { useZoneMap } from './useZoneMap';

/**
 * Web: MapLibre GL with the Golden hour map (our own tiles, `golden-map.ts`) when its URLs are set, else
 * the `@driver/map` original street picture; the SVG base if WebGL is unavailable.
 */
export function BaseMap(props: BaseMapProps) {
  const [failed, setFailed] = useState(false);
  // Low-data mode (maps program q2): the drawn town instead of downloading map tiles.
  const lite = useLiteMode();
  if (failed || lite) return <SvgBase {...props} />;
  return <MapLibreBase {...props} onFail={() => setFailed(true)} />;
}

export const BASE_MAP_KIND: 'svg' | 'maplibre' = 'maplibre';

/**
 * Light OSM raster (dev) until the PMTiles basemap ships; zones and the background always draw.
 * The customer map has no use for the Console's garage and live-fleet layers.
 */
const CONSOLE_ONLY: ReadonlySet<string> = new Set([LAYER.garages, LAYER.tripLines, LAYER.tripStops, LAYER.drivers, LAYER.driverHalo]);
const LIGHT = buildMapStyle({ theme: 'light' });
const DARK = buildMapStyle({ theme: 'dark' });
const STYLE = { ...LIGHT, layers: LIGHT.layers.filter((l) => !CONSOLE_ONLY.has(l.id)) } as unknown as StyleSpecification;
/**
 * Night look (n2): the shared dark style (inverted, desaturated tiles) laid over the ember ground, a
 * little see-through so the streets take the warm brown instead of a cold grey.
 */
const NIGHT_STYLE = {
  ...DARK,
  layers: DARK.layers
    .filter((l) => !CONSOLE_ONLY.has(l.id))
    .map((l) =>
      l.id === LAYER.background
        ? { ...l, paint: { 'background-color': MAP_COLORS_NIGHT.background } }
        : l.id === LAYER.osm
          ? { ...l, paint: { ...(l as { paint?: object }).paint, 'raster-opacity': 0.72 } }
          : l,
    ),
} as unknown as StyleSpecification;

/**
 * The camera lives in the shared values (`cam`): every frame the map is jumped to them, so the
 * overlay (drawn from the same values) never drifts from the tiles, including during follow
 * animations. While the person drags or pinches, the map leads and writes the values instead.
 */
/** Once per page: the `pmtiles://` protocol and right-to-left shaping for the Arabic map letters. */
let goldenReady: Promise<void> | null = null;
function prepareGolden(maplibregl: typeof import('maplibre-gl')): Promise<void> {
  goldenReady ??= import('pmtiles').then(({ Protocol }) => {
    maplibregl.addProtocol('pmtiles', new Protocol().tile);
    if (maplibregl.getRTLTextPluginStatus() === 'unavailable') void maplibregl.setRTLTextPlugin(RTL_TEXT_PLUGIN_URL, true).catch(() => undefined);
  });
  return goldenReady;
}

/** The style to draw: the Golden hour map unless it fell back this session, else the original look. */
function styleFor(night: boolean, light: GoldenLight, golden: boolean): { style: StyleSpecification; golden: boolean } {
  const original = night ? NIGHT_STYLE : STYLE;
  const g = golden ? courierGoldenStyle(MAP_URLS, light, original) : null;
  return g ? { style: g, golden: true } : { style: original, golden: false };
}

function MapLibreBase({ drawn, cam, size, onUserGestureStart, onUserCamera, labelAvoid, coveredTop, coveredBottom, landmarkNameZoom, onFail }: BaseMapProps & { onFail: () => void }) {
  const zonesQuery = useZoneMap();
  const { map: mapColors, night } = useMapColors();
  const nightRef = useRef(night);
  nightRef.current = night;
  // The Golden hour light (checked again every 10 minutes); `goldenOn` turns false for good if our tiles fail.
  const [light, setLight] = useState<GoldenLight>(() => goldenLightFor(night));
  const lightRef = useRef(light);
  lightRef.current = light;
  const goldenOn = useRef(Boolean(MAP_URLS.tilesUrl && MAP_URLS.glyphsUrl));
  const zonesRef = useRef(zonesQuery.data);
  zonesRef.current = zonesQuery.data;
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const driving = useRef(false);
  const labels = useSharedValue(1);
  const cbs = useRef({ onUserGestureStart, onUserCamera, onFail });
  cbs.current = { onUserGestureStart, onUserCamera, onFail };

  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let map: MlMap | null = null;
    let stopFallback: (() => void) | null = null;
    import('maplibre-gl')
      .then((mod) => {
        const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
        if (cancelled || !container.current) return;
        return (goldenOn.current ? prepareGolden(maplibregl).catch(() => {
          goldenOn.current = false;
        }) : Promise.resolve()).then(() => maplibregl);
      })
      .then((maplibregl) => {
        if (!maplibregl || cancelled || !container.current) return;
        const first = styleFor(nightRef.current, lightRef.current, goldenOn.current);
        try {
          map = new maplibregl.Map({
            container: container.current,
            style: first.style,
            center: [cam.lng.value, cam.lat.value],
            zoom: cam.zoom.value,
            attributionControl: false,
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
            fadeDuration: 0,
          });
        } catch {
          cbs.current.onFail();
          return;
        }
        mapRef.current = map;
        const m = map;
        const putZones = () => {
          if (zonesRef.current) m.getSource<GeoJSONSource>(SOURCE.zones)?.setData(buildPlacedZonesGeoJSON(zonesRef.current));
        };
        m.once('load', putZones);
        // The palm pattern (and any other Golden hour image) for whichever light is showing.
        m.on('styleimagemissing', (e: { id: string }) => {
          const img = goldenImages(lightRef.current)[e.id];
          if (img && !m.hasImage(e.id)) m.addImage(e.id, img);
        });
        // Our tiles did not answer: the original look for the rest of this map, with the zones put back.
        if (first.golden) {
          stopFallback = fallBackToOriginalMap(m as unknown as FallbackMap, {
            onFallback: () => {
              goldenOn.current = false;
              m.setStyle(nightRef.current ? NIGHT_STYLE : STYLE);
              m.once('style.load', putZones);
            },
          });
        }
        m.touchZoomRotate.disableRotation();
        m.keyboard.disableRotation();
        // Attribution is drawn by the screen (`MapAttribution`) above the sheet, not as a MapLibre control.
        // Tiles failing (offline, blocked) is expected: the background and zones still draw.
        m.on('error', () => undefined);
        m.on('movestart', (e) => {
          if (!(e as { originalEvent?: unknown }).originalEvent) return;
          driving.current = true;
          labels.value = 0;
          cbs.current.onUserGestureStart();
        });
        m.on('move', () => {
          if (!driving.current) return;
          const c = m.getCenter();
          cam.lng.value = c.lng;
          cam.lat.value = c.lat;
          cam.zoom.value = m.getZoom();
        });
        m.on('moveend', () => {
          if (!driving.current) return;
          driving.current = false;
          labels.value = 1;
          const c = m.getCenter();
          cbs.current.onUserCamera({ lng: c.lng, lat: c.lat, zoom: m.getZoom() });
        });
        const tick = () => {
          if (!driving.current) {
            const c = m.getCenter();
            const lng = cam.lng.value;
            const lat = cam.lat.value;
            const zoom = cam.zoom.value;
            if (Math.abs(c.lng - lng) > 1e-9 || Math.abs(c.lat - lat) > 1e-9 || Math.abs(m.getZoom() - zoom) > 1e-6) m.jumpTo({ center: [lng, lat], zoom });
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })
      .catch(() => cbs.current.onFail());
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stopFallback?.();
      map?.remove();
      mapRef.current = null;
    };
    // The map is created once; the camera reaches it through the shared values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.resize();
  }, [size.w, size.h]);

  // The hour's light moves on while the map is open (Golden hour only): look again every 10 minutes.
  useEffect(() => {
    setLight(goldenLightFor(night));
    if (!goldenOn.current) return;
    const t = setInterval(() => setLight(goldenLightFor(nightRef.current)), LIGHT_CHECK_MS);
    return () => clearInterval(t);
  }, [night]);

  // Sunset, sunrise or a new light while the map is open: swap the style, then put the zones back on it.
  const shown = useRef({ night, light });
  useEffect(() => {
    const m = mapRef.current;
    if (!m || (shown.current.night === night && shown.current.light === light)) return;
    if (shown.current.night === night && !goldenOn.current) return;
    shown.current = { night, light };
    m.setStyle(styleFor(night, light, goldenOn.current).style);
    m.once('style.load', () => {
      if (zonesRef.current) m.getSource<GeoJSONSource>(SOURCE.zones)?.setData(buildPlacedZonesGeoJSON(zonesRef.current));
    });
  }, [night, light]);

  useEffect(() => {
    if (zonesQuery.data) mapRef.current?.getSource<GeoJSONSource>(SOURCE.zones)?.setData(buildPlacedZonesGeoJSON(zonesQuery.data));
  }, [zonesQuery.data]);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: mapColors.background }]}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {/* MapLibre has no glyphs until the PMTiles basemap lands: neighbourhood names come from SVG. */}
      <ZoneLayer drawn={drawn} cam={cam} size={size} fills={false} labels opacity={labels} {...(labelAvoid ? { avoid: labelAvoid } : {})} />
      {/* Landmarks (maps b3) over the tiles and under every pin the screen draws. */}
      <LandmarkLayer drawn={drawn} cam={cam} size={size} opacity={labels} coveredTop={coveredTop ?? 0} coveredBottom={coveredBottom ?? 0} {...(landmarkNameZoom !== undefined ? { nameZoom: landmarkNameZoom } : {})} {...(labelAvoid ? { avoid: labelAvoid } : {})} />
    </View>
  );
}
