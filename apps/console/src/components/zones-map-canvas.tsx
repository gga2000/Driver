'use client';

import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { LatLng, ZonePlacementView } from '@driver/contracts';
import { t } from '@driver/i18n';
import { AZIZIYAH_BOUNDS, AZIZIYAH_MAX_BOUNDS, MAP_COLORS, MAP_COLORS_LIGHT, SOURCE } from '@driver/map';
import { GOLDEN_FIRST_LABEL } from '@driver/map/golden';
import { useEffect, useRef, useState } from 'react';
import { openConsoleMapStyle, watchGoldenMap } from '@/lib/map-runtime';
import { midpoints, type EditorAction, type EditorState } from '@/lib/zone-editor';

const SRC_OTHERS = 'zone-edit-others';
const SRC_CURRENT = 'zone-edit-current';
const LAYERS = {
  othersFill: 'zone-edit-others-fill',
  othersLine: 'zone-edit-others-line',
  othersDraft: 'zone-edit-others-draft',
  currentFill: 'zone-edit-current-fill',
  currentLine: 'zone-edit-current-line',
} as const;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
/** Camera when a zone opens: room around the outline, never closer than street level. */
const FIT_PADDING_PX = 80;
const FIT_MAX_ZOOM = 16;

const HANDLE_CLS = {
  corner: 'h-3.5 w-3.5 cursor-grab rounded-full border-2 border-accent bg-surface shadow-card',
  mid: 'flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border border-accent bg-surface text-[11px] font-bold leading-none text-accent-text opacity-80 hover:opacity-100',
  centre: 'h-6 w-6 cursor-move rounded-full border-2 border-accent bg-accent-tint shadow-card',
  label: 'pointer-events-none whitespace-nowrap rounded-sm bg-surface px-1 text-[11px] font-medium leading-4 text-text opacity-90',
} as const;

export interface ZonesMapCanvasProps {
  theme: 'light' | 'dark';
  zones: readonly ZonePlacementView[];
  editor: EditorState;
  /** Corner, "+" and centre handles; read-only roles only see the outlines. */
  editable: boolean;
  /** The outline breaks a rule: drawn in the danger colour. */
  invalid: boolean;
  dispatch: (action: EditorAction) => void;
  onPick: (key: string) => void;
}

function polygon<P extends Record<string, unknown>>(ring: readonly LatLng[], props: P): Feature<Polygon, P> {
  const coords = ring.map((p): [number, number] => [p.lng, p.lat]);
  const first = coords[0];
  return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [first ? [...coords, first] : coords] } };
}

function handle(cls: string, text?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = cls;
  if (text) el.textContent = text;
  return el;
}

/**
 * The Zones page map: every zone's outline (AI drafts dashed, drawn ones solid; click to pick), the
 * open zone in the accent colour, and — for editors — draggable corners, "+" handles that add a corner,
 * and a centre handle that moves the whole zone. All edits go through the page's reducer.
 */
export default function ZonesMapCanvas(props: ZonesMapCanvasProps) {
  const { theme, zones, editor, editable, invalid } = props;
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Bumped when our Golden hour map fails to open: the map reopens on the original one. */
  const [reopen, setReopen] = useState(0);
  const cb = useRef(props);
  cb.current = props;
  const handles = useRef<{ corners: maplibregl.Marker[]; mids: maplibregl.Marker[]; centre: maplibregl.Marker | null }>({ corners: [], mids: [], centre: null });
  const labels = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const palette = theme === 'dark' ? MAP_COLORS : MAP_COLORS_LIGHT;
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
          // The old map is loading the original style now: nothing may draw on it until the reopen.
          mapRef.current = null;
          setReopen((n) => n + 1);
        })
      : () => undefined;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    // Tile errors (offline, OSM throttling) must not take the page down; the outlines still draw.
    map.on('error', () => undefined);
    // Drawn on only once its style is in, so a map being replaced (theme, fallback) is never drawn on.
    const markReady = () => {
      mapRef.current = map;
      // The style's own zone layers show the seed hexagons; this page draws the saved outlines instead.
      for (const layer of map.getStyle().layers) {
        if ('source' in layer && layer.source === SOURCE.zones) map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
      // On the Golden hour map the outlines go under the street names, so they stay readable.
      const under = golden && map.getLayer(GOLDEN_FIRST_LABEL) ? GOLDEN_FIRST_LABEL : undefined;
      map.addSource(SRC_OTHERS, { type: 'geojson', data: EMPTY });
      map.addSource(SRC_CURRENT, { type: 'geojson', data: EMPTY });
      map.addLayer({ id: LAYERS.othersFill, type: 'fill', source: SRC_OTHERS, paint: { 'fill-color': palette.muted, 'fill-opacity': ['case', ['==', ['get', 'placement'], 'draft'], 0.05, 0.14] } }, under);
      map.addLayer({ id: LAYERS.othersLine, type: 'line', source: SRC_OTHERS, filter: ['!=', ['get', 'placement'], 'draft'], paint: { 'line-color': palette.muted, 'line-width': 1.5 } }, under);
      map.addLayer({ id: LAYERS.othersDraft, type: 'line', source: SRC_OTHERS, filter: ['==', ['get', 'placement'], 'draft'], paint: { 'line-color': palette.muted, 'line-width': 1, 'line-dasharray': [2, 2] } }, under);
      map.addLayer({ id: LAYERS.currentFill, type: 'fill', source: SRC_CURRENT, paint: { 'fill-color': ['case', ['get', 'invalid'], palette.danger, palette.accent], 'fill-opacity': 0.2 } }, under);
      map.addLayer({ id: LAYERS.currentLine, type: 'line', source: SRC_CURRENT, paint: { 'line-color': ['case', ['get', 'invalid'], palette.danger, palette.accent], 'line-width': 2.5 } }, under);
      map.on('click', LAYERS.othersFill, (e) => {
        const key: unknown = e.features?.[0]?.properties['key'];
        if (typeof key === 'string') cb.current.onPick(key);
      });
      map.on('mouseenter', LAYERS.othersFill, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', LAYERS.othersFill, () => {
        map.getCanvas().style.cursor = '';
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

  // Other zones (outline + name label).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const others = zones.filter((z) => z.key !== editor.key);
    map.getSource<GeoJSONSource>(SRC_OTHERS)?.setData({ type: 'FeatureCollection', features: others.map((z) => polygon(z.ring, { key: z.key, placement: z.placement })) });
    for (const m of labels.current) m.remove();
    labels.current = others.map((z) => new maplibregl.Marker({ element: handle(HANDLE_CLS.label, z.name_ar) }).setLngLat([z.centre.lng, z.centre.lat]).addTo(map));
  }, [ready, zones, editor.key]);

  // The open zone's outline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const data: FeatureCollection = editor.key && editor.ring.length > 0 ? { type: 'FeatureCollection', features: [polygon(editor.ring, { invalid })] } : EMPTY;
    map.getSource<GeoJSONSource>(SRC_CURRENT)?.setData(data);
  }, [ready, editor.key, editor.ring, invalid]);

  // Handles: rebuilt only when the zone, its corner count or the edit right changes; dragging just moves them.
  const cornerCount = editor.ring.length;
  useEffect(() => {
    const map = mapRef.current;
    const clear = () => {
      for (const m of [...handles.current.corners, ...handles.current.mids]) m.remove();
      handles.current.centre?.remove();
      handles.current = { corners: [], mids: [], centre: null };
    };
    clear();
    const ed = cb.current.editor;
    if (!map || !ready || !editable || !ed.key) return clear;
    ed.ring.forEach((p, i) => {
      const el = handle(HANDLE_CLS.corner);
      const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([p.lng, p.lat]).addTo(map);
      m.on('dragstart', () => cb.current.dispatch({ type: 'begin' }));
      m.on('drag', () => {
        const at = m.getLngLat();
        cb.current.dispatch({ type: 'moveVertex', index: i, to: { lat: at.lat, lng: at.lng } });
      });
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        cb.current.dispatch({ type: 'select', index: i });
      });
      handles.current.corners.push(m);
    });
    midpoints(ed.ring).forEach((p, i) => {
      const el = handle(HANDLE_CLS.mid, '+');
      el.title = t('console.zones_help');
      const m = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).addTo(map);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const at = midpoints(cb.current.editor.ring)[i];
        if (at) cb.current.dispatch({ type: 'insertVertex', after: i, at });
      });
      handles.current.mids.push(m);
    });
    const centre = new maplibregl.Marker({ element: handle(HANDLE_CLS.centre), draggable: true }).setLngLat([ed.centre.lng, ed.centre.lat]).addTo(map);
    centre.on('dragstart', () => cb.current.dispatch({ type: 'begin' }));
    centre.on('drag', () => {
      const at = centre.getLngLat();
      cb.current.dispatch({ type: 'moveShape', to: { lat: at.lat, lng: at.lng } });
    });
    handles.current.centre = centre;
    return clear;
  }, [ready, editor.key, cornerCount, editable]);

  // Keep the handles on the outline while it changes.
  useEffect(() => {
    const h = handles.current;
    editor.ring.forEach((p, i) => {
      const m = h.corners[i];
      if (!m) return;
      m.setLngLat([p.lng, p.lat]);
      // Toggle only our fill class: MapLibre positions the marker through its own classes on this element.
      const on = i === editor.selected;
      m.getElement().classList.toggle('bg-accent', on);
      m.getElement().classList.toggle('bg-surface', !on);
    });
    midpoints(editor.ring).forEach((p, i) => h.mids[i]?.setLngLat([p.lng, p.lat]));
    h.centre?.setLngLat([editor.centre.lng, editor.centre.lat]);
  }, [editor.ring, editor.centre, editor.selected]);

  // Fly to a zone when it opens.
  useEffect(() => {
    const map = mapRef.current;
    const ring = cb.current.editor.ring;
    if (!map || !ready || !editor.key || ring.length === 0) return;
    const lngs = ring.map((p) => p.lng);
    const lats = ring.map((p) => p.lat);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: FIT_PADDING_PX, maxZoom: FIT_MAX_ZOOM, duration: 600 },
    );
  }, [ready, editor.key]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted" role="status">
        {t('console.map_failed')}
      </div>
    );
  }
  return <div ref={container} className="h-full w-full" />;
}
