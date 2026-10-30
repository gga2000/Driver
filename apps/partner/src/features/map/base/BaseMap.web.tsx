import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { useLiteMode, useTheme } from '@driver/ui';
import { StyleSheet, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import type { GeoJSONSource, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { buildMapStyle, buildPlacedZonesGeoJSON, LAYER, RTL_TEXT_PLUGIN_URL, SOURCE } from '@driver/map';
import { fallBackToOriginalMap, goldenImages, type FallbackMap, type GoldenLight } from '@driver/map/golden';
import { demandGlowLayers, type DemandCell } from '@driver/map/pieces/demand';
import { closedStreetsLayers } from '@driver/map/pieces/closed-streets';
import type { ClosedGeoJSON } from '../closed';
import { courierGoldenStyle, goldenLightFor, LIGHT_CHECK_MS, MAP_URLS } from './golden-map';
import { bindHouseWindows } from './house-windows';
import { SvgBase } from './SvgBase';
import type { BaseMapProps, ClosedDrawn } from './types';
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

const GLOW = 'demand-glow';

/** Steps of the glow's soft edge: wide and faint outside, brighter toward the middle where they stack. */
const GLOW_STEPS = [1, 0.84, 0.68, 0.52, 0.36, 0.2] as const;
/** Radius of a zone's glow at full strength, metres (a zone is about 1.2 km across). */
const GLOW_REACH_M = 560;

/**
 * Each busy zone as a few stacked discs (the shared `demandGlowGeoJSON` draws one hard-edged disc per cell, which reads
 * as a sticker on a zone this big). The steps' `w` stays low so their sum, not one of them, makes the bright middle.
 */
function glowRings(cells: readonly DemandCell[]) {
  const ring = ([lng, lat]: readonly [number, number], r: number) => {
    const kx = 111320 * Math.cos((lat * Math.PI) / 180);
    return Array.from({ length: 41 }, (_, i) => {
      const a = ((i % 40) / 40) * Math.PI * 2;
      return [lng + (Math.cos(a) * r) / kx, lat + (Math.sin(a) * r) / 110540] as [number, number];
    });
  };
  return {
    type: 'FeatureCollection' as const,
    features: cells.flatMap((c) =>
      GLOW_STEPS.map((step) => ({
        type: 'Feature' as const,
        properties: { w: Math.min(1, c.weight) * (0.15 + 0.2 * (1 - step)) },
        geometry: { type: 'Polygon' as const, coordinates: [ring(c.at, GLOW_REACH_M * (0.55 + 0.45 * c.weight) * step)] },
      })),
    ),
  };
}

/**
 * N17: the busy parts of town as amber light inside the map, under its first name layer, so the streets' names
 * stay on top. Added again after every style swap (the light, the fallback); later pictures only swap the data,
 * and MapLibre cross-fades them (at once under reduce motion).
 */
function putGlow(m: MlMap, cells: readonly DemandCell[], light: GoldenLight, still: boolean): boolean {
  const data = glowRings(cells);
  const src = m.getSource<GeoJSONSource>(GLOW);
  if (src) {
    src.setData(data);
    return true;
  }
  // Not `isStyleLoaded()`: that also waits for tiles, which may never come (offline); the style itself is enough.
  try {
    const under = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
    m.addSource(GLOW, { type: 'geojson', data });
    for (const layer of demandGlowLayers({ source: GLOW, light, id: GLOW })) {
      m.addLayer(layer as Parameters<MlMap['addLayer']>[0], under);
      if (still) m.setPaintProperty(layer.id, 'fill-opacity-transition', { duration: 0, delay: 0 });
    }
    return true;
  } catch {
    // The style is still loading: its 'load' / 'style.load' draws the glow.
    return false;
  }
}

const CLOSED = 'closed-streets';

/** The closed streets' line layers go just under the first name layer: over the glow, under the names. */
function closedBefore(m: MlMap): string | undefined {
  return m.getStyle().layers.find((l) => l.type === 'symbol' && !l.id.startsWith(CLOSED))?.id;
}

/**
 * N20: the closed streets the road goes around, drawn into the map (rust and cream stripes, a barrier at each
 * end) over the busy-zone glow and under the street names; the screen draws the road, pins and him over the
 * map. The «مسدود» label only where the style has glyphs (the Golden hour map); else the screen draws it.
 * Added again after every style swap, like the glow; later roads only swap the data. Null = not drawn.
 */
function putClosed(m: MlMap, data: ClosedGeoJSON, light: GoldenLight): ClosedDrawn | null {
  const src = m.getSource<GeoJSONSource>(CLOSED);
  if (src) {
    src.setData(data as never);
    return { lines: true, labels: Boolean(m.getLayer(`${CLOSED}-label`)) };
  }
  // Nothing closed on this road and nothing drawn yet: leave the map alone.
  if (data.features.length === 0) return null;
  try {
    const glyphs = Boolean(m.getStyle().glyphs);
    const before = closedBefore(m);
    m.addSource(CLOSED, { type: 'geojson', data: data as never });
    for (const layer of closedStreetsLayers({ source: CLOSED, light, id: CLOSED })) {
      if (layer.type === 'symbol') {
        if (glyphs) m.addLayer(layer as Parameters<MlMap['addLayer']>[0]);
      } else m.addLayer(layer as Parameters<MlMap['addLayer']>[0], before);
    }
    return { lines: true, labels: glyphs };
  } catch {
    // The style is still loading: its 'styledata' draws them.
    return null;
  }
}

/** A glow added after the closed streets lands over them: put the streets back on top of it. */
function keepClosedOverGlow(m: MlMap) {
  const ids = m.getStyle().layers.map((l) => l.id);
  const lastGlow = ids.reduce((last, id, i) => (id.startsWith(GLOW) ? i : last), -1);
  const firstClosed = ids.findIndex((id) => id.startsWith(CLOSED));
  if (lastGlow < 0 || firstClosed < 0 || lastGlow < firstClosed) return;
  const before = closedBefore(m);
  for (const id of ids) if (id.startsWith(CLOSED) && !id.endsWith('-label')) m.moveLayer(id, before);
}

function MapLibreBase({ drawn, cam, size, onUserGestureStart, onUserCamera, labelAvoid, coveredTop, coveredBottom, landmarkNameZoom, glow, onGlow, closed, onClosed, onFail }: BaseMapProps & { onFail: () => void }) {
  const still = useTheme().reduceMotion;
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
  const glowRef = useRef({ cells: glow, still, onGlow });
  glowRef.current = { cells: glow, still, onGlow };
  /** The light the glow is drawn for: the Golden hour light, or day/night on the original look. */
  const glowLight = (): GoldenLight => (goldenOn.current ? lightRef.current : nightRef.current ? 'night' : 'day');
  const drawGlow = (m: MlMap) => {
    const g = glowRef.current;
    if (!g.cells) return;
    if (putGlow(m, g.cells, glowLight(), g.still)) g.onGlow?.(true);
  };
  const closedRef = useRef({ data: closed, onClosed });
  closedRef.current = { data: closed, onClosed };
  const drawClosed = (m: MlMap) => {
    const c = closedRef.current;
    if (!c.data) return;
    const drawn = putClosed(m, c.data, glowLight());
    if (drawn) c.onClosed?.(drawn);
  };
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
    let win: typeof import('@driver/map/pieces/windows') | null = null;
    Promise.all([import('maplibre-gl'), goldenOn.current ? import('@driver/map/pieces/windows').catch(() => null) : null])
      .then(([mod, w]) => {
        win = w;
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
        // Windows, doors and roof walls on the houses up close (our map only, from z17).
        const windows = win ? bindHouseWindows(m, win) : null;
        // The glow and the windows go on as soon as a style (the first, or a new light's) can take them; 'load' alone can wait on tiles.
        m.on('styledata', () => {
          if (!m.getSource(GLOW)) drawGlow(m);
          if (goldenOn.current) windows?.add(lightRef.current);
        });
        // N20: the closed streets the same way (after the glow, so a new style draws them over it).
        m.on('styledata', () => {
          if (!m.getSource(CLOSED)) drawClosed(m);
          else keepClosedOverGlow(m);
        });
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

  // A new picture of where the orders are: swap the data (the map cross-fades it).
  useEffect(() => {
    const m = mapRef.current;
    if (m && glow) drawGlow(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glow]);

  // The screen draws its own glow again if this map goes (WebGL lost, low-data mode).
  useEffect(() => () => glowRef.current.onGlow?.(false), []);

  // A new road, or one that no longer goes round anything: swap the closed streets.
  useEffect(() => {
    const m = mapRef.current;
    if (m && closed) drawClosed(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closed]);

  // The screen draws the closed streets itself if this map goes.
  useEffect(() => () => closedRef.current.onClosed?.({ lines: false, labels: false }), []);

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
