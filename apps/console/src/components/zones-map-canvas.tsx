'use client';

import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { LatLng, ZonePlacementView } from '@driver/contracts';
import { t } from '@driver/i18n';
import { AZIZIYAH_BOUNDS, AZIZIYAH_MAX_BOUNDS, glyphSvgMarkup, landmarkGlyph, MAP_COLORS, MAP_COLORS_LIGHT, SOURCE } from '@driver/map';
import { GOLDEN_FIRST_LABEL } from '@driver/map/golden';
import { useEffect, useRef, useState } from 'react';
import { openConsoleMapStyle, watchGoldenMap } from '@/lib/map-runtime';
import { pinsInBox, type EditorPin } from '@/lib/map-editor';
import { midpoints, snapCorner, type EditorAction, type EditorState } from '@/lib/zone-editor';

const SRC_OTHERS = 'zone-edit-others';
const SRC_CURRENT = 'zone-edit-current';
const SRC_LINK = 'map-edit-link';
const LAYERS = {
  othersFill: 'zone-edit-others-fill',
  othersLine: 'zone-edit-others-line',
  othersDraft: 'zone-edit-others-draft',
  currentFill: 'zone-edit-current-fill',
  currentLine: 'zone-edit-current-line',
  link: 'map-edit-link-line',
} as const;
/** Press and hold this long on the map (without moving) to add a place there. */
const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP_PX = 6;
/** The tilted look (Ali loves the 3D map): pitch and a slight turn, eased once. */
const TILT = { pitch: 55, bearing: -12 } as const;
/** A restaurant's mark: a bowl with steam, drawn on the same 24-px grid as the landmark glyphs. */
const BOWL_SVG = '<path d="M3.5 12.5h17a8.5 8.5 0 0 1-17 0Z"/><path d="M9 8.5c0-1.2 1.2-1.3 1.2-2.5M13.5 8.5c0-1.2 1.2-1.3 1.2-2.5"/>';
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
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
  /** Restaurants, landmarks or a review card's before and after (map editor layers). */
  pins?: readonly EditorPin[];
  selectedPins?: ReadonlySet<string>;
  /** A dashed line from where a place is to where a fix says it is. */
  link?: { from: LatLng; to: LatLng } | null;
  /** Fly to these points whenever `key` changes. */
  focus?: { key: string; points: readonly LatLng[] } | null;
  /** Areas' name tags (off while pins are shown, so names never sit on top of each other). */
  zoneLabels?: boolean;
  tilt?: boolean;
  /** The next click on the map sets a place (a restaurant with no pin yet). */
  placing?: boolean;
  onPinPick?: (key: string, additive: boolean) => void;
  /** A pin dropped somewhere new (with a selection, the page moves the rest by the same step). */
  onPinDrop?: (key: string, to: LatLng) => void;
  onRename?: (key: string, name: string) => void;
  /** Press and hold (or right-click) on the map: add a place here. */
  onAddAt?: (at: LatLng, screen: { x: number; y: number }) => void;
  onMapClick?: (at: LatLng) => void;
  onBoxSelect?: (keys: string[]) => void;
}

function pinElement(p: EditorPin, selected: boolean): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'map-edit-pin';
  el.dataset['tone'] = p.tone;
  el.dataset['kind'] = p.kind;
  if (selected) el.dataset['selected'] = '';
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', p.name);
  el.tabIndex = 0;
  const dot = document.createElement('span');
  dot.className = 'map-edit-dot';
  dot.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${p.category === 'restaurant' ? BOWL_SVG : glyphSvgMarkup(landmarkGlyph(p.category))}</svg>`;
  const label = document.createElement('span');
  label.className = 'map-edit-label';
  label.textContent = p.tone === 'before' ? `${p.name} · ${t('console.mapedit_before')}` : p.tone === 'after' ? `${p.name} · ${t('console.mapedit_after')}` : p.name;
  if (p.renamable) label.title = t('console.mapedit_rename_hint');
  el.append(dot, label);
  return el;
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
  /** Held Alt (⌥) lets a corner go anywhere, without snapping to the area next door. */
  const altDown = useRef(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      altDown.current = e.altKey;
    };
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    return () => {
      window.removeEventListener('keydown', on);
      window.removeEventListener('keyup', on);
    };
  }, []);

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
      map.addSource(SRC_LINK, { type: 'geojson', data: EMPTY });
      map.addLayer({ id: LAYERS.link, type: 'line', source: SRC_LINK, paint: { 'line-color': palette.accent, 'line-width': 2.5, 'line-dasharray': [2, 1.5] } });
      // Shift + drag picks several pins (the box replaces MapLibre's box zoom).
      map.boxZoom.disable();
      wireGestures(map);
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
    // Press and hold (or right-click) to add a place; Shift + drag to pick several; a click while placing.
    const wireGestures = (m: MlMap) => {
      let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
      let box: { start: maplibregl.Point; el: HTMLDivElement } | null = null;
      const cancelPress = () => {
        if (press) clearTimeout(press.timer);
        press = null;
      };
      const canvas = m.getCanvasContainer();
      m.on('mousedown', (e) => {
        if (e.originalEvent.button !== 0) return;
        if (e.originalEvent.shiftKey && cb.current.onBoxSelect) {
          e.preventDefault();
          m.dragPan.disable();
          const el = document.createElement('div');
          el.className = 'map-edit-box';
          canvas.appendChild(el);
          box = { start: e.point, el };
          return;
        }
        if (!cb.current.onAddAt) return;
        const at = e.lngLat;
        const screen = { x: e.point.x, y: e.point.y };
        press = { x: e.point.x, y: e.point.y, timer: setTimeout(() => {
          press = null;
          cb.current.onAddAt?.({ lat: at.lat, lng: at.lng }, screen);
        }, LONG_PRESS_MS) };
      });
      m.on('mousemove', (e) => {
        if (press && Math.hypot(e.point.x - press.x, e.point.y - press.y) > LONG_PRESS_SLOP_PX) cancelPress();
        if (box) {
          const { start, el } = box;
          Object.assign(el.style, { left: `${Math.min(start.x, e.point.x)}px`, top: `${Math.min(start.y, e.point.y)}px`, width: `${Math.abs(e.point.x - start.x)}px`, height: `${Math.abs(e.point.y - start.y)}px` });
        }
      });
      m.on('mouseup', (e) => {
        cancelPress();
        if (!box) return;
        const { start, el } = box;
        box = null;
        el.remove();
        m.dragPan.enable();
        const a = m.unproject(start);
        const b = m.unproject(e.point);
        cb.current.onBoxSelect?.(pinsInBox(cb.current.pins ?? [], { lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }));
      });
      m.on('dragstart', cancelPress);
      m.on('zoomstart', cancelPress);
      m.on('contextmenu', (e) => {
        if (!cb.current.onAddAt || cb.current.tilt) return;
        e.preventDefault();
        cb.current.onAddAt({ lat: e.lngLat.lat, lng: e.lngLat.lng }, { x: e.point.x, y: e.point.y });
      });
      m.on('click', (e) => {
        if (cb.current.placing) cb.current.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
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
    labels.current = props.zoneLabels === false ? [] : others.map((z) => new maplibregl.Marker({ element: handle(HANDLE_CLS.label, z.name_ar) }).setLngLat([z.centre.lng, z.centre.lat]).addTo(map));
  }, [ready, zones, editor.key, props.zoneLabels]);

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
        const ll = m.getLngLat();
        // Borders meet (Ali, 2026-10-20): a corner near a drawn neighbour lands on its corner or edge. Alt drags free.
        const neighbours = altDown.current ? [] : cb.current.zones.filter((z) => z.key !== cb.current.editor.key && z.placement !== 'draft').map((z) => z.ring);
        const { at, snapped } = snapCorner({ lat: ll.lat, lng: ll.lng }, neighbours, (q) => map.project([q.lng, q.lat]), (q) => {
          const u = map.unproject([q.x, q.y]);
          return { lat: u.lat, lng: u.lng };
        });
        el.classList.toggle('ring-4', snapped !== null);
        el.classList.toggle('ring-accent/40', snapped !== null);
        cb.current.dispatch({ type: 'moveVertex', index: i, to: at });
      });
      m.on('dragend', () => {
        el.classList.remove('ring-4', 'ring-accent/40');
        const p = cb.current.editor.ring[i];
        if (p) m.setLngLat([p.lng, p.lat]);
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

  // Pins (map editor): rebuilt when the list or the selection changes; dragging only moves them.
  const pinMarkers = useRef(new Map<string, { marker: maplibregl.Marker; pin: EditorPin }>());
  const declutterRef = useRef<(() => void) | null>(null);
  const pins = props.pins;
  const selectedPins = props.selectedPins;
  useEffect(() => {
    const map = mapRef.current;
    const store = pinMarkers.current;
    for (const { marker } of store.values()) marker.remove();
    store.clear();
    if (!map || !ready || !pins) return;
    for (const p of pins) {
      const el = pinElement(p, cb.current.selectedPins?.has(p.key) ?? false);
      const marker = new maplibregl.Marker({ element: el, draggable: p.draggable }).setLngLat([p.pin.lng, p.pin.lat]).addTo(map);
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        cb.current.onPinPick?.(p.key, ev.shiftKey || ev.metaKey || ev.ctrlKey);
      });
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && ev.target === el) cb.current.onPinPick?.(p.key, ev.shiftKey);
      });
      const label = el.querySelector<HTMLSpanElement>('.map-edit-label');
      if (p.renamable && label) {
        label.addEventListener('dblclick', (ev) => {
          ev.stopPropagation();
          const input = document.createElement('input');
          input.className = 'map-edit-rename';
          input.value = p.name;
          input.setAttribute('aria-label', t('console.mapedit_name'));
          label.replaceWith(input);
          input.focus();
          input.select();
          let done = false;
          const finish = (save: boolean) => {
            if (done) return;
            done = true;
            const name = input.value.trim();
            input.replaceWith(label);
            if (save && name && name !== p.name) cb.current.onRename?.(p.key, name);
          };
          input.addEventListener('keydown', (k) => {
            k.stopPropagation();
            if (k.key === 'Enter') finish(true);
            else if (k.key === 'Escape') finish(false);
          });
          input.addEventListener('blur', () => finish(true));
          input.addEventListener('mousedown', (m) => m.stopPropagation());
        });
      }
      if (p.draggable) {
        // A selected pin carries the rest of the selection with it while it moves.
        marker.on('drag', () => {
          const at = marker.getLngLat();
          if (!(cb.current.selectedPins?.has(p.key) ?? false)) return;
          const dLat = at.lat - p.pin.lat;
          const dLng = at.lng - p.pin.lng;
          for (const [key, other] of store) {
            if (key !== p.key && cb.current.selectedPins?.has(key) && other.pin.draggable) other.marker.setLngLat([other.pin.pin.lng + dLng, other.pin.pin.lat + dLat]);
          }
        });
        marker.on('dragend', () => {
          const at = marker.getLngLat();
          cb.current.onPinDrop?.(p.key, { lat: at.lat, lng: at.lng });
        });
      }
      store.set(p.key, { marker, pin: p });
    }
    // Names that would sit on top of each other: the picked ones and the first in the list win, the rest
    // show again when the map zooms in far enough to part them.
    const declutter = () => {
      const taken: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
      const picked = cb.current.selectedPins;
      const order = [...store.values()].sort((a, b) => Number(picked?.has(b.pin.key) ?? false) - Number(picked?.has(a.pin.key) ?? false));
      for (const { marker, pin } of order) {
        const label = marker.getElement().querySelector<HTMLElement>('.map-edit-label');
        if (!label) continue;
        const at = map.project([pin.pin.lng, pin.pin.lat]);
        const half = label.offsetWidth / 2 + 3;
        const box = { x0: at.x - half, x1: at.x + half, y0: at.y + 4, y1: at.y + 4 + label.offsetHeight + 4 };
        const hit = taken.some((o) => box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0);
        if (hit) label.dataset['collide'] = '';
        else delete label.dataset['collide'];
        if (!hit) taken.push(box);
      }
    };
    declutter();
    declutterRef.current = declutter;
    map.on('moveend', declutter);
    return () => {
      map.off('moveend', declutter);
      declutterRef.current = null;
      for (const { marker } of store.values()) marker.remove();
      store.clear();
    };
  }, [ready, pins]);

  // Picking only restyles the pins (rebuilding them would lose a double-click on a name half way).
  useEffect(() => {
    for (const { marker, pin } of pinMarkers.current.values()) {
      const el = marker.getElement();
      if (selectedPins?.has(pin.key)) el.dataset['selected'] = '';
      else delete el.dataset['selected'];
    }
    declutterRef.current?.();
  }, [selectedPins, pins]);

  // A review card's line from where the place is to where the fix says.
  const link = props.link;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const data: FeatureCollection = link
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[link.from.lng, link.from.lat], [link.to.lng, link.to.lat]] } }] }
      : EMPTY;
    map.getSource<GeoJSONSource>(SRC_LINK)?.setData(data);
  }, [ready, link]);

  // Fly to what was picked (a place, or a fix's before and after).
  const focusKey = props.focus?.key ?? null;
  useEffect(() => {
    const map = mapRef.current;
    const points = cb.current.focus?.points ?? [];
    if (!map || !ready || !focusKey || points.length === 0) return;
    const duration = reduceMotion() ? 0 : 600;
    if (points.length === 1) {
      map.flyTo({ center: [points[0]!.lng, points[0]!.lat], zoom: Math.max(map.getZoom(), 16.5), duration });
      return;
    }
    const lngs = points.map((p) => p.lng);
    const lats = points.map((p) => p.lat);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 140, maxZoom: 19, duration });
  }, [ready, focusKey]);

  // The 3D look: tilted and turned a little, and the right button turns it.
  const tilt = props.tilt ?? false;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (tilt) map.dragRotate.enable();
    else map.dragRotate.disable();
    map.easeTo({ pitch: tilt ? TILT.pitch : 0, bearing: tilt ? TILT.bearing : 0, duration: reduceMotion() ? 0 : 700 });
  }, [ready, tilt]);

  const placing = props.placing ?? false;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getCanvas().style.cursor = placing ? 'crosshair' : '';
  }, [ready, placing]);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted" role="status">
        {t('console.map_failed')}
      </div>
    );
  }
  return <div ref={container} className="h-full w-full" />;
}
