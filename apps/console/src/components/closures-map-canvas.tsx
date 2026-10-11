'use client';

import maplibregl, { type GeoJSONSource, type LayerSpecification, type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import { ClosureReason, type ClosureView, type LatLng } from '@driver/contracts';
import { t } from '@driver/i18n';
import { AZIZIYAH_BOUNDS, AZIZIYAH_MAX_BOUNDS, MAP_COLORS, MAP_COLORS_LIGHT, SOURCE } from '@driver/map';
import { GOLDEN_FIRST_LABEL } from '@driver/map/golden';
import { closedStreetsGeoJSON, closedStreetsLayers, type ClosedStreetLike } from '@driver/map/pieces/closed-streets';
import { useEffect, useRef, useState } from 'react';
import { openConsoleMapStyle, watchGoldenMap } from '@/lib/map-runtime';

const SRC_ALL = 'closures-all';
const SRC_ACTIVE = 'closures-active';
const SRC_PREVIEW = 'closures-preview';
const LAYERS = {
  selected: 'closures-selected',
  faded: 'closures-faded',
  hit: 'closures-hit',
  previewHalo: 'closures-preview-halo',
} as const;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const FIT_PADDING_PX = 90;
const FIT_MAX_ZOOM = 17;
/** The Drawer is w-96 from the md viewport breakpoint (components/ui/overlay.tsx). */
const SHEET_WIDTH_PX = 384;
const SHEET_BREAKPOINT_PX = 768;
/** The original (non Golden hour) map has no IBM Plex glyphs: its labels use this font. */
const ORIGINAL_MAP_FONT = ['Noto Sans Regular'];

/**
 * The closed stretch itself is the shared map piece (rust and cream stripes, a barrier across each
 * end, the label), the same drawing the customer's track map uses. This page adds only the faded grey
 * for streets opened or ended today, the selection glow and the accent glow around the preview.
 */
const PAGE_COLORS = {
  light: { faded: MAP_COLORS_LIGHT.muted, accent: MAP_COLORS_LIGHT.accent },
  dark: { faded: MAP_COLORS.muted, accent: MAP_COLORS.accent },
} as const;

export interface ClosuresMapCanvasProps {
  theme: 'light' | 'dark';
  closures: readonly ClosureView[];
  selectedId: string | null;
  /** «سدّ شارع» mark mode: map taps set the start and end instead of picking a closure. */
  marking: boolean;
  from: LatLng | null;
  to: LatLng | null;
  /** The street between the taps (ops.closures.snap), drawn the way it will look once closed. */
  preview: readonly LatLng[] | null;
  onPick: (id: string) => void;
  onTap: (at: LatLng) => void;
}

function line<P extends Record<string, unknown>>(path: readonly LatLng[], props: P): Feature<LineString, P> {
  return { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: path.map((p) => [p.lng, p.lat]) } };
}

function tapDot(color: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'pointer-events-none h-4 w-4 rounded-full border-2 bg-surface shadow-card';
  el.style.borderColor = color;
  return el;
}

/** The map label: «شارع المستشفى · أشغال», or «مسدود اليوم · أشغال» without a name. */
function labelOf(s: ClosedStreetLike): string {
  const reason = ClosureReason.safeParse(s.reason);
  const why = reason.success ? t(`console.closures_reason_${reason.data}`) : '';
  return s.nameAr ? (why ? `${s.nameAr} · ${why}` : s.nameAr) : t('console.closures_map_label', { reason: why });
}

/** The piece's layers; on the original map its labels switch to a font that map has. */
function pieceLayers(source: string, theme: 'light' | 'dark', golden: boolean, id: string): LayerSpecification[] {
  return closedStreetsLayers({ source, light: theme === 'dark' ? 'night' : 'day', id }).map((l) =>
    !golden && l.type === 'symbol' ? { ...l, layout: { ...l.layout, 'text-font': ORIGINAL_MAP_FONT } } : l,
  );
}

/** Room for the side sheet: on wide maps it covers the left (end edge in RTL); on phones it is a bottom sheet. */
function fitPadding(map: MlMap) {
  const p = FIT_PADDING_PX;
  const wide = window.innerWidth >= SHEET_BREAKPOINT_PX;
  return wide ? { top: p, bottom: p, right: p, left: SHEET_WIDTH_PX + p } : { top: p, left: p, right: p, bottom: Math.round(map.getContainer().clientHeight * 0.5) };
}

function fit(map: MlMap, path: readonly LatLng[]) {
  if (path.length === 0) return;
  const lngs = path.map((p) => p.lng);
  const lats = path.map((p) => p.lat);
  map.fitBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    { padding: fitPadding(map), maxZoom: FIT_MAX_ZOOM, duration: 600 },
  );
}

/**
 * The closed-streets map: today's closures (the shared N20 drawing while closed, faded grey once
 * opened or ended; click one to open its sheet) and, in mark mode, the two taps and the street between.
 */
export default function ClosuresMapCanvas(props: ClosuresMapCanvasProps) {
  const { theme, closures, selectedId, marking, from, to, preview } = props;
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reopen, setReopen] = useState(0);
  const cb = useRef(props);
  cb.current = props;
  const tapMarkers = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const c = PAGE_COLORS[theme];
    let map: MlMap;
    const look = { theme, zoneShading: 'sequential' } as const;
    const { style, golden } = openConsoleMapStyle(look);
    try {
      map = new maplibregl.Map({
        container: el,
        style,
        bounds: AZIZIYAH_BOUNDS,
        fitBoundsOptions: { padding: 32 },
        maxBounds: AZIZIYAH_MAX_BOUNDS,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        doubleClickZoom: false,
      });
    } catch {
      setFailed(true);
      return;
    }
    const stopWatch = golden
      ? watchGoldenMap(map, look, () => {
          mapRef.current = null;
          setReopen((n) => n + 1);
        })
      : () => undefined;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    // Tile errors (offline, throttling) must not take the page down; the closures still draw.
    map.on('error', () => undefined);
    const markReady = () => {
      mapRef.current = map;
      // The seed zone hexagons would only add noise under the streets.
      for (const layer of map.getStyle().layers) {
        if ('source' in layer && layer.source === SOURCE.zones) map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
      const under = golden && map.getLayer(GOLDEN_FIRST_LABEL) ? GOLDEN_FIRST_LABEL : undefined;
      const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
      map.addSource(SRC_ALL, { type: 'geojson', data: EMPTY });
      map.addSource(SRC_ACTIVE, { type: 'geojson', data: EMPTY });
      map.addSource(SRC_PREVIEW, { type: 'geojson', data: EMPTY });
      map.addLayer({ id: LAYERS.selected, type: 'line', source: SRC_ALL, filter: ['==', ['get', 'selected'], true], layout: round, paint: { 'line-color': c.accent, 'line-width': 24, 'line-opacity': 0.4 } }, under);
      map.addLayer({ id: LAYERS.faded, type: 'line', source: SRC_ALL, filter: ['==', ['get', 'active'], false], layout: round, paint: { 'line-color': c.faded, 'line-width': 6, 'line-opacity': 0.6, 'line-dasharray': [1.2, 1] } }, under);
      map.addLayer({ id: LAYERS.previewHalo, type: 'line', source: SRC_PREVIEW, filter: ['==', ['get', 'part'], 'closed'], layout: round, paint: { 'line-color': c.accent, 'line-width': 26, 'line-opacity': 0.35 } }, under);
      for (const l of pieceLayers(SRC_PREVIEW, theme, golden, 'closures-preview')) map.addLayer(l, under);
      // The closed streets go over the preview, as the piece asks (after route-like layers).
      for (const l of pieceLayers(SRC_ACTIVE, theme, golden, 'closures-active')) map.addLayer(l, under);
      map.addLayer({ id: LAYERS.hit, type: 'line', source: SRC_ALL, layout: round, paint: { 'line-color': c.accent, 'line-width': 24, 'line-opacity': 0 } }, under);
      map.on('click', (e) => {
        if (cb.current.marking) {
          cb.current.onTap({ lat: e.lngLat.lat, lng: e.lngLat.lng });
          return;
        }
        const id: unknown = map.queryRenderedFeatures(e.point, { layers: [LAYERS.hit] })[0]?.properties['id'];
        if (typeof id === 'string') cb.current.onPick(id);
      });
      map.on('mouseenter', LAYERS.hit, () => {
        if (!cb.current.marking) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', LAYERS.hit, () => {
        if (!cb.current.marking) map.getCanvas().style.cursor = '';
      });
      setReady(true);
    };
    if (map.isStyleLoaded()) markReady();
    else map.once('style.load', markReady);
    return () => {
      stopWatch();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [theme, reopen]);

  // Crosshair while marking.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getCanvas().style.cursor = marking ? 'crosshair' : '';
  }, [ready, marking]);

  // Today's closures: the closed ones as the shared piece draws them, the rest faded grey.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getSource<GeoJSONSource>(SRC_ALL)?.setData({
      type: 'FeatureCollection',
      features: closures.map((c) => line(c.path, { id: c.id, active: c.active, selected: c.id === selectedId })),
    });
    map.getSource<GeoJSONSource>(SRC_ACTIVE)?.setData(closedStreetsGeoJSON(closures.filter((c) => c.active), labelOf) as FeatureCollection);
  }, [ready, closures, selectedId]);

  // The street between the two taps (drawn as it will look once closed), or the taps on their own.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const shown = preview && preview.length >= 2;
    map.getSource<GeoJSONSource>(SRC_PREVIEW)?.setData(shown ? (closedStreetsGeoJSON([{ id: 'preview', path: preview }], () => '') as FeatureCollection) : EMPTY);
    for (const m of tapMarkers.current) m.remove();
    tapMarkers.current = [];
    if (shown) return;
    const color = PAGE_COLORS[theme].accent;
    for (const p of [from, to]) {
      if (p) tapMarkers.current.push(new maplibregl.Marker({ element: tapDot(color) }).setLngLat([p.lng, p.lat]).addTo(map));
    }
  }, [ready, preview, from, to, theme]);

  // Fly to a closure picked from the list, and to the street once it is found.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedId) return;
    const c = cb.current.closures.find((x) => x.id === selectedId);
    if (c) fit(map, c.path);
  }, [ready, selectedId]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !preview) return;
    fit(map, preview);
  }, [ready, preview]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted" role="status">
        {t('console.map_failed')}
      </div>
    );
  }
  return <div ref={container} className="h-full w-full" />;
}
