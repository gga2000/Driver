'use client';

import maplibregl, { type GeoJSONSource, type Map as MlMap, type MapGeoJSONFeature, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AZIZIYAH_ZONES, LANDMARK_FEED_RULES, type DemandLevel, type LandmarkCategory } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useQuery } from '@tanstack/react-query';
import {
  AZIZIYAH_BOUNDS,
  AZIZIYAH_MAX_BOUNDS,
  buildMapStyle,
  buildPlacedZonesGeoJSON,
  buildZonesGeoJSON,
  GARAGES,
  glyphSvgMarkup,
  labelDigits,
  LANDMARK_PRIORITY,
  LANDMARK_RULES,
  landmarkGlyph,
  LAYER,
  MAP_COLORS,
  MAP_COLORS_LIGHT,
  SOURCE,
} from '@driver/map';
import { useTRPC } from '@/lib/trpc';
import { MARKER_SHAPES } from '@/lib/marker-shapes';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TRIP_DRAG_TYPE, type LiveGeoJSON, type OrderTag } from '@/lib/live-map';
import { around, overlaps, placeLabels, stackTags, type Box, type LabelIn } from '@/lib/map-labels';
import { ZonesSvg } from './zones-svg';
import { FLEET_RULES, glideAt, isQuiet, type LngLatTuple } from '@/lib/fleet-motion';

/** The person asked the system for less motion: pins jump to each fix. */
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export type MapSelection =
  | { kind: 'driver'; id: string; tripId: string }
  | { kind: 'trip'; id: string }
  | { kind: 'zone'; id: string }
  | { kind: 'garage'; id: string };

export type MapHoverTarget = { kind: 'driver'; id: string } | { kind: 'order'; id: string };


export interface LiveMapCanvasProps {
  live: LiveGeoJSON;
  selected: MapSelection | null;
  onSelect: (s: MapSelection | null) => void;
  /** Bump to fit the map back to Aziziyah. */
  fitKey: number;
  /** Centre the map here (list selection). */
  focus: { lng: number; lat: number } | null;
  theme: 'light' | 'dark';
  /** Waiting orders pinned at their pickup. */
  orders?: readonly OrderTag[] | undefined;
  /** "#2009" for an order tag's first trip. */
  orderText?: ((tripId: string) => string) | undefined;
  /** `focus`: only the focused trip's route is drawn (default); `all`: every active route, quietly. */
  routes?: 'all' | 'focus' | undefined;
  focusTripId?: string | null | undefined;
  /** Candidate drivers of the selected card → their number 1–5. */
  candidates?: ReadonlyMap<string, number> | undefined;
  picked?: string | null | undefined;
  /** Keep this driver centred as he moves. */
  followId?: string | null | undefined;
  /** The person dragged the map (ends a follow). */
  onUserMove?: (() => void) | undefined;
  /** Name shown beside candidate / selected / followed drivers. */
  driverLabel?: ((driverId: string) => string | null) | undefined;
  renderHover?: ((h: MapHoverTarget) => ReactNode) | undefined;
  onDropTrip?: ((tripId: string, driverId: string) => void) | undefined;
  /** Couriers carrying an order predicted to be late (maps program o4): a pulsing ring. */
  atRiskDrivers?: ReadonlySet<string> | undefined;
  /** Busy zones (maps program o5): filled in the accent, strong where orders outnumber drivers. */
  heat?: ReadonlyArray<{ zoneId: string; level: DemandLevel }> | undefined;
}

/** The busy-zone fill (maps program o5). */
const HEAT_SOURCE = 'ops-heat';
const HEAT_LAYER = 'ops-heat-fill';
const HEAT_OUTLINE = 'ops-heat-line';

const CLICKABLE = [LAYER.tripStops, LAYER.tripLines, LAYER.garages, LAYER.zoneFill];
/** Zone names show from this zoom (they crowd the centre below it). */
const ZONE_LABEL_ZOOM = 12.2;

function toSelection(f: MapGeoJSONFeature): MapSelection | null {
  const p = f.properties as Record<string, unknown>;
  switch (f.layer.id) {
    case LAYER.tripLines:
    case LAYER.tripStops:
      return { kind: 'trip', id: String(p['tripId']) };
    case LAYER.garages:
      return { kind: 'garage', id: String(p['key']) };
    case LAYER.zoneFill:
      return { kind: 'zone', id: String(p['id']) };
    default:
      return null;
  }
}

/** The camera survives a theme switch (the map is rebuilt with the other style). */
let lastCamera: { center: [number, number]; zoom: number } | null = null;

/** A theme role as an `rgb(r, g, b)` string MapLibre can parse (the CSS variable holds channels). */
function roleColor(el: Element, role: string): string {
  const raw = getComputedStyle(el).getPropertyValue(`--c-${role}`).trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts.length === 3 ? `rgb(${parts.join(', ')})` : 'gray';
}

interface PinEntry {
  marker: maplibregl.Marker;
  el: HTMLDivElement;
  look: string;
  lngLat: [number, number];
  /** Moving to `lngLat` from here since `start` (maps program o1). */
  glide?: { from: LngLatTuple; start: number };
}
interface TagEntry extends PinEntry {
  /** Orders at this spot. */
  count: number;
  /** Position in the urgency order (0 = most urgent; the selected card's tag is −1). */
  rank: number;
  text: HTMLSpanElement;
  more: HTMLSpanElement;
}
interface LabelEntry {
  marker: maplibregl.Marker;
  el: HTMLDivElement;
  lngLat: [number, number];
  kind: 'zone' | 'garage' | 'driver' | 'landmark';
  size: { w: number; h: number } | null;
}
/** A landmark badge (maps program b3): drawn on its spot, its name a `landmark` label beside it. */
interface LandmarkEntry {
  marker: maplibregl.Marker;
  el: HTMLDivElement;
  lngLat: [number, number];
  category: LandmarkCategory;
  shown: boolean;
}

/**
 * The live MapLibre map shared by /map and /dispatch (client only; loaded with `ssr: false`). Zones
 * and garages come from the @driver/map style (sequential tier bands, light or dark with the theme);
 * routes are the style's trip layers, filtered and coloured here; drivers, waiting orders and every
 * label are HTML markers so Arabic shapes natively, state is drawn as shape + colour, and labels are
 * placed without collisions on every move.
 */
export default function LiveMapCanvas(props: LiveMapCanvasProps) {
  const { live, selected, fitKey, focus, theme, orders, routes = 'focus', focusTripId, candidates, picked, followId } = props;
  const trpc = useTRPC();
  const zonesQuery = useQuery(trpc.ops.zones.map.queryOptions({ cityId: 'aziziyah' }, { refetchInterval: 30_000 }));
  const landmarksQuery = useQuery(trpc.places.landmarkFeed.queryOptions({ cityId: 'aziziyah' }, { staleTime: LANDMARK_FEED_RULES.maxAgeS * 1000 }));
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const cb = useRef(props);
  cb.current = props;
  const pinsRef = useRef(new Map<string, PinEntry>());
  const ordersRef = useRef(new Map<string, TagEntry>());
  const labelsRef = useRef(new Map<string, LabelEntry>());
  const landmarksRef = useRef(new Map<string, LandmarkEntry>());
  const layoutRef = useRef<() => void>(() => undefined);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<(MapHoverTarget & { x: number; y: number }) | null>(null);

  // ── map (rebuilt when the theme changes) ──
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: el,
        style: buildMapStyle({ theme, zoneShading: 'sequential' }) as StyleSpecification,
        ...(lastCamera ? { center: lastCamera.center, zoom: lastCamera.zoom } : { bounds: AZIZIYAH_BOUNDS, fitBoundsOptions: { padding: 32 } }),
        maxBounds: AZIZIYAH_MAX_BOUNDS,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch {
      setFailed(true);
      return;
    }
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

    const labels = labelsRef.current;
    const addLabel = (key: string, kind: LabelEntry['kind'], text: string, lngLat: [number, number]) => {
      const node = document.createElement('div');
      node.className = 'ops-label';
      node.dataset['kind'] = kind;
      node.textContent = text;
      node.setAttribute('aria-hidden', 'true');
      const marker = new maplibregl.Marker({ element: node, anchor: 'top-left' }).setLngLat(lngLat).addTo(map);
      labels.set(key, { marker, el: node, lngLat, kind, size: null });
    };
    for (const z of AZIZIYAH_ZONES) addLabel(`zone:${z.id}`, 'zone', labelDigits(z.name_ar), [z.lng, z.lat]);
    for (const g of GARAGES.filter((x) => x.inCity)) addLabel(`garage:${g.key}`, 'garage', labelDigits(g.name_ar), [g.lng, g.lat]);

    // Label layout: greedy, collision-free, recomputed on every frame the camera moves.
    let raf = 0;
    const layout = () => {
      raf = 0;
      const m = mapRef.current;
      if (!m) return;
      const { clientWidth: w, clientHeight: h } = el;
      const zoom = m.getZoom();
      const obstacles: Box[] = [];
      for (const p of pinsRef.current.values()) {
        const pt = m.project(p.lngLat);
        // A numbered candidate carries its badge on the corner: a bigger box keeps names off it.
        obstacles.push(around(pt.x, pt.y, 'rank' in p.el.dataset ? 38 : 26));
      }
      // Order tags that would overlap fold into the most urgent one ("#4816 +3").
      const tagBoxes = new Map<string, Box>();
      for (const [key, o] of ordersRef.current) {
        const pt = m.project(o.lngLat);
        const ow = o.el.offsetWidth || 56;
        tagBoxes.set(key, { x: pt.x - ow / 2, y: pt.y - 30, w: ow, h: 24 });
      }
      const stacked = stackTags([...ordersRef.current].map(([key, o]) => ({ id: key, box: tagBoxes.get(key)!, count: o.count, rank: o.rank })));
      for (const [key, o] of ordersRef.current) {
        const s = stacked.get(key);
        const shown = s?.shown ?? true;
        o.el.style.visibility = shown ? '' : 'hidden';
        const more = (s?.total ?? o.count) - 1;
        o.more.textContent = shown && more > 0 ? `+${more}` : '';
        o.more.hidden = !(shown && more > 0);
        if (shown) obstacles.push(tagBoxes.get(key)!);
      }
      // Landmark badges (maps program b3) from zoom 15, never on a driver or an order tag: the most
      // useful first (mosque, bridge, market…); a badge shown becomes an obstacle for every name.
      const showLandmarks = zoom >= LANDMARK_RULES.minZoom;
      const badges: Box[] = [];
      const byPriority = [...landmarksRef.current].sort(([a, x], [b, y]) => LANDMARK_PRIORITY[y.category] - LANDMARK_PRIORITY[x.category] || a.localeCompare(b));
      for (const [, lm] of byPriority) {
        const pt = m.project(lm.lngLat);
        const box = around(pt.x, pt.y, LANDMARK_RULES.iconPx);
        const inView = pt.x >= 0 && pt.y >= 0 && pt.x <= w && pt.y <= h;
        lm.shown = showLandmarks && inView && !obstacles.some((o) => overlaps(o, box, LANDMARK_RULES.spacingPx)) && !badges.some((b) => overlaps(b, box, LANDMARK_RULES.spacingPx));
        if (lm.shown) {
          delete lm.el.dataset['hidden'];
          badges.push(box);
        } else lm.el.dataset['hidden'] = '';
      }
      obstacles.push(...badges);
      const want: LabelIn[] = [];
      for (const [key, l] of labelsRef.current) {
        if ((l.kind === 'zone' && zoom < ZONE_LABEL_ZOOM) || (l.kind === 'landmark' && (zoom < LANDMARK_RULES.nameZoom || !landmarksRef.current.get(key.slice('landmark:'.length))?.shown))) {
          l.el.dataset['hidden'] = '';
          continue;
        }
        if (!l.size) {
          delete l.el.dataset['hidden'];
          l.size = { w: l.el.offsetWidth, h: l.el.offsetHeight };
        }
        const pt = m.project(l.lngLat);
        want.push({
          id: key,
          x: pt.x,
          y: pt.y,
          w: l.size.w,
          h: l.size.h,
          priority: l.kind === 'driver' ? 6 : l.kind === 'garage' ? 3 : l.kind === 'landmark' ? 2 : 1,
          gap: l.kind === 'zone' ? 2 : l.kind === 'garage' ? 9 : l.kind === 'landmark' ? LANDMARK_RULES.iconPx / 2 + 2 : 15,
        });
      }
      const placed = placeLabels(want, obstacles, { w, h });
      for (const [key, spot] of placed) {
        const l = labelsRef.current.get(key);
        if (!l) continue;
        if (!spot) {
          l.el.dataset['hidden'] = '';
          continue;
        }
        delete l.el.dataset['hidden'];
        l.marker.setOffset([spot.dx, spot.dy]);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(layout);
    };
    layoutRef.current = schedule;
    map.on('move', schedule);
    map.on('resize', schedule);
    map.on('moveend', () => {
      const c = map.getCenter();
      lastCamera = { center: [c.lng, c.lat], zoom: map.getZoom() };
    });
    map.on('dragstart', () => cb.current.onUserMove?.());
    map.on('movestart', () => setHover(null));

    let hoverZone: number | string | undefined;
    map.on('mousemove', (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: CLICKABLE });
      map.getCanvas().style.cursor = hits.length ? 'pointer' : '';
      const zone = hits.find((h) => h.layer.id === LAYER.zoneFill);
      if (hoverZone !== undefined && hoverZone !== zone?.id) map.setFeatureState({ source: SOURCE.zones, id: hoverZone }, { hover: false });
      hoverZone = zone?.id;
      if (hoverZone !== undefined) map.setFeatureState({ source: SOURCE.zones, id: hoverZone }, { hover: true });
    });
    map.on('click', (e) => {
      if ((e.originalEvent.target as HTMLElement | null)?.closest('.ops-pin, .ops-order')) return;
      const [top] = map.queryRenderedFeatures(e.point, { layers: CLICKABLE });
      cb.current.onSelect(top ? toSelection(top) : null);
    });
    // Live data may flow once the style is parsed, not on `load` (that waits for every basemap tile,
    // which never comes while OSM is slow or unreachable).
    const markReady = () => {
      // HTML markers replace the style's circle drivers.
      for (const id of [LAYER.drivers, LAYER.driverHalo]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
      setReady(true);
      schedule();
    };
    if (map.isStyleLoaded()) markReady();
    else map.once('style.load', markReady);
    // Tile errors (offline, OSM throttling) must not take the console down; the zones still draw.
    map.on('error', () => undefined);

    const pins = pinsRef.current;
    const tags = ordersRef.current;
    const landmarks = landmarksRef.current;
    return () => {
      if (raf) cancelAnimationFrame(raf);
      for (const lm of landmarks.values()) lm.marker.remove();
      landmarks.clear();
      for (const store of [pins, tags]) {
        for (const p of store.values()) p.marker.remove();
        store.clear();
      }
      for (const l of labels.values()) l.marker.remove();
      labels.clear();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [theme]);

  useEffect(() => {
    const map = mapRef.current;
    const zones = zonesQuery.data;
    if (!map || !ready || !zones) return;
    map.getSource<GeoJSONSource>(SOURCE.zones)?.setData(buildPlacedZonesGeoJSON(zones));
    for (const [key, label] of labelsRef.current) {
      if (label.kind === 'zone') { label.marker.remove(); labelsRef.current.delete(key); }
    }
    for (const z of zones) {
      const node = document.createElement('div');
      node.className = 'ops-label';
      node.dataset['kind'] = 'zone';
      node.textContent = labelDigits(z.name_ar);
      node.setAttribute('aria-hidden', 'true');
      const lngLat: [number, number] = [z.centre.lng, z.centre.lat];
      const marker = new maplibregl.Marker({ element: node, anchor: 'top-left' }).setLngLat(lngLat).addTo(map);
      labelsRef.current.set(`zone:${z.key}`, { marker, el: node, lngLat, kind: 'zone', size: null });
    }
    layoutRef.current();
  }, [ready, zonesQuery.data]);

  // ── landmarks (maps program b3): a badge on each spot, the name as a placed label; garages are the
  // garage layer's already ──
  useEffect(() => {
    const map = mapRef.current;
    const feed = landmarksQuery.data;
    if (!map || !ready || !feed?.changed) return;
    const store = landmarksRef.current;
    for (const lm of store.values()) lm.marker.remove();
    store.clear();
    for (const [key, label] of labelsRef.current) {
      if (label.kind === 'landmark') {
        label.marker.remove();
        labelsRef.current.delete(key);
      }
    }
    // Markers paint in DOM order: landmarks go right after the map canvas, under every driver and tag.
    const canvas = map.getCanvas();
    const behind = (el: HTMLElement) => canvas.parentElement?.insertBefore(el, canvas.nextSibling);
    for (const l of feed.landmarks) {
      if (l.category === 'garage') continue;
      const lngLat: [number, number] = [l.pin.lng, l.pin.lat];
      const badge = document.createElement('div');
      badge.className = 'ops-landmark';
      badge.dataset['category'] = l.category;
      badge.dataset['hidden'] = '';
      badge.setAttribute('aria-hidden', 'true');
      badge.innerHTML = `<svg viewBox="0 0 24 24">${glyphSvgMarkup(landmarkGlyph(l.category))}</svg>`;
      store.set(l.id, { marker: new maplibregl.Marker({ element: badge }).setLngLat(lngLat).addTo(map), el: badge, lngLat, category: l.category, shown: false });
      behind(badge);
      const name = document.createElement('div');
      name.className = 'ops-label';
      name.dataset['kind'] = 'landmark';
      name.dataset['hidden'] = '';
      name.textContent = labelDigits(l.name_ar);
      name.setAttribute('aria-hidden', 'true');
      labelsRef.current.set(`landmark:${l.id}`, { marker: new maplibregl.Marker({ element: name, anchor: 'top-left' }).setLngLat(lngLat).addTo(map), el: name, lngLat, kind: 'landmark', size: null });
      behind(name);
    }
    layoutRef.current();
  }, [ready, landmarksQuery.data]);

  // ── busy zones (maps program o5): a fill over the zones, from the shapes on the map ──
  const heat = props.heat;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const level = new Map((heat ?? []).filter((h) => h.level !== 'calm').map((h) => [h.zoneId, h.level]));
    const shapes = zonesQuery.data ? buildPlacedZonesGeoJSON(zonesQuery.data) : buildZonesGeoJSON();
    const data = { type: 'FeatureCollection' as const, features: shapes.features.filter((f) => level.has(f.properties.id)).map((f) => ({ ...f, properties: { ...f.properties, level: level.get(f.properties.id) } })) };
    const source = map.getSource<GeoJSONSource>(HEAT_SOURCE);
    if (source) source.setData(data);
    else {
      map.addSource(HEAT_SOURCE, { type: 'geojson', data });
      const accent = theme === 'light' ? MAP_COLORS_LIGHT.accent : MAP_COLORS.accent;
      map.addLayer(
        { id: HEAT_LAYER, type: 'fill', source: HEAT_SOURCE, paint: { 'fill-color': accent, 'fill-opacity': ['match', ['get', 'level'], 'hot', 0.36, 0.16] } },
        map.getLayer(LAYER.zoneLine) ? LAYER.zoneLine : undefined,
      );
      // A bold outline, so a busy zone reads apart from the tier wash under it.
      map.addLayer({ id: HEAT_OUTLINE, type: 'line', source: HEAT_SOURCE, paint: { 'line-color': accent, 'line-width': ['match', ['get', 'level'], 'hot', 3, 1.5], 'line-opacity': 0.95 } });
    }
  }, [ready, heat, zonesQuery.data, theme]);

  // ── routes (style layers) ──
  useEffect(() => {
    const map = mapRef.current;
    const el = container.current;
    if (!map || !ready || !el) return;
    (map.getSource(SOURCE.trips) as GeoJSONSource | undefined)?.setData(live.trips);
    (map.getSource(SOURCE.stops) as GeoJSONSource | undefined)?.setData(live.stops);
    const focusId = focusTripId ?? (selected?.kind === 'trip' ? selected.id : selected?.kind === 'driver' ? selected.tripId : '') ?? '';
    const isFocus = ['==', ['get', 'tripId'], focusId];
    const only = routes === 'focus' ? (isFocus as never) : null;
    map.setFilter(LAYER.tripLines, only);
    map.setFilter(LAYER.tripStops, only);
    map.setPaintProperty(LAYER.tripLines, 'line-color', ['case', isFocus, roleColor(el, 'accent-text'), ['get', 'red'], roleColor(el, 'bad-solid'), roleColor(el, 'line-strong')] as never);
    map.setPaintProperty(LAYER.tripLines, 'line-width', ['case', isFocus, 3.5, 1.5] as never);
    map.setPaintProperty(LAYER.tripLines, 'line-opacity', ['case', isFocus, 1, 0.55] as never);
    map.setPaintProperty(LAYER.tripStops, 'circle-color', ['case', ['==', ['get', 'type'], 'pickup'], roleColor(el, 'text'), roleColor(el, 'surface')] as never);
    map.setPaintProperty(LAYER.tripStops, 'circle-stroke-color', roleColor(el, 'text'));
    map.setPaintProperty(LAYER.tripStops, 'circle-radius', ['case', isFocus, 5, 3] as never);
  }, [live.trips, live.stops, ready, routes, focusTripId, selected, theme]);

  // ── pin glides (maps program o1): one animation loop for every pin on the move ──
  const glideRaf = useRef(0);
  const startGlides = () => {
    if (glideRaf.current) return;
    const step = (now: number) => {
      glideRaf.current = 0;
      let moving = false;
      for (const e of pinsRef.current.values()) {
        if (!e.glide) continue;
        const k = (now - e.glide.start) / FLEET_RULES.glideMs;
        e.marker.setLngLat(k >= 1 ? e.lngLat : glideAt(e.glide.from, e.lngLat, k));
        if (k >= 1) delete e.glide;
        else moving = true;
      }
      if (moving) glideRaf.current = requestAnimationFrame(step);
    };
    glideRaf.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(glideRaf.current), []);

  // ── driver markers ──
  const atRiskDrivers = props.atRiskDrivers;
  const selectedDriver = selected?.kind === 'driver' ? selected.id : null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const store = pinsRef.current;
    const seen = new Set<string>();
    const named = new Set<string>();
    for (const f of live.drivers.features) {
      const p = f.properties;
      const id = p.driverId;
      seen.add(id);
      const lngLat = f.geometry.coordinates as [number, number];
      const rank = candidates?.get(id);
      const isPicked = picked === id;
      const isSel = selectedDriver === id || followId === id;
      const dim = candidates && candidates.size > 0 && rank === undefined && !isSel;
      const look = `${p.state}|${rank ?? ''}|${isPicked}|${isSel}|${dim}|${p.approx}`;
      let entry = store.get(id);
      if (!entry) {
        const node = document.createElement('div');
        node.className = 'ops-pin';
        node.dataset['driverMarker'] = id;
        node.addEventListener('mouseenter', () => {
          const box = node.getBoundingClientRect();
          const host = container.current?.getBoundingClientRect();
          if (host) setHover({ kind: 'driver', id, x: box.left - host.left + box.width / 2, y: box.top - host.top });
        });
        node.addEventListener('mouseleave', () => setHover((h) => (h?.kind === 'driver' && h.id === id ? null : h)));
        node.addEventListener('click', (e) => {
          e.stopPropagation();
          const tripId = node.dataset['tripId'] ?? '';
          cb.current.onSelect({ kind: 'driver', id, tripId });
        });
        node.addEventListener('dragover', (e) => {
          if (!cb.current.onDropTrip || !e.dataTransfer?.types.includes(TRIP_DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          node.classList.add('is-drop');
        });
        node.addEventListener('dragleave', () => node.classList.remove('is-drop'));
        node.addEventListener('drop', (e) => {
          node.classList.remove('is-drop');
          const tripId = e.dataTransfer?.getData(TRIP_DRAG_TYPE);
          if (!tripId) return;
          e.preventDefault();
          cb.current.onDropTrip?.(tripId, id);
        });
        const marker = new maplibregl.Marker({ element: node }).setLngLat(lngLat).addTo(map);
        entry = { marker, el: node, look: '', lngLat };
        store.set(id, entry);
      }
      entry.el.dataset['tripId'] = p.tripId;
      if (entry.lngLat[0] !== lngLat[0] || entry.lngLat[1] !== lngLat[1]) {
        // Maps program o1: glide from where the pin is drawn to the new fix instead of jumping.
        if (reduceMotion()) entry.marker.setLngLat(lngLat);
        else {
          const at = entry.marker.getLngLat();
          entry.glide = { from: [at.lng, at.lat], start: performance.now() };
          startGlides();
        }
        entry.lngLat = lngLat;
      }
      // Heading arrow, quiet fade and the at-risk ring (maps program o1, o4): outside `look`, they change on their own.
      const heading = typeof p.heading === 'number' ? Math.round(p.heading) : null;
      entry.el.style.setProperty('--heading', heading === null ? '' : `${heading}deg`);
      if (heading === null) delete entry.el.dataset['heading'];
      else entry.el.dataset['heading'] = '';
      if (isQuiet(p.seenAt ?? null, Date.now())) entry.el.dataset['quiet'] = '';
      else delete entry.el.dataset['quiet'];
      if (atRiskDrivers?.has(id)) entry.el.dataset['risk'] = '';
      else delete entry.el.dataset['risk'];
      if (entry.look !== look) {
        entry.look = look;
        entry.el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${MARKER_SHAPES[p.state]}</svg>${rank ? `<span class="ops-rank">${rank}</span>` : ''}`;
        entry.el.classList.toggle('is-selected', isSel);
        const ds = entry.el.dataset;
        const flag = (k: string, on: boolean) => {
          if (on) ds[k] = '';
          else delete ds[k];
        };
        flag('rank', rank !== undefined);
        flag('picked', isPicked);
        flag('dim', Boolean(dim));
        flag('approx', p.approx);
        entry.el.style.zIndex = isPicked ? '8' : rank ? '7' : isSel ? '6' : '';
      }
      if (rank !== undefined || isSel) named.add(id);
    }
    for (const [id, e] of store) {
      if (seen.has(id)) continue;
      e.marker.remove();
      store.delete(id);
    }
    // Name labels for the drivers that matter right now (candidates, the selected one, the followed one).
    const labels = labelsRef.current;
    for (const [key, l] of labels) {
      if (l.kind !== 'driver') continue;
      const id = key.slice('driver:'.length);
      if (named.has(id)) continue;
      l.marker.remove();
      labels.delete(key);
    }
    for (const id of named) {
      const text = cb.current.driverLabel?.(id) ?? null;
      const at = store.get(id)?.lngLat;
      if (!text || !at) continue;
      const key = `driver:${id}`;
      const cur = labels.get(key);
      if (cur) {
        if (cur.el.textContent !== text) {
          cur.el.textContent = text;
          cur.size = null;
        }
        cur.lngLat = at;
        cur.marker.setLngLat(at);
        continue;
      }
      const node = document.createElement('div');
      node.className = 'ops-label';
      node.dataset['kind'] = 'driver';
      node.textContent = text;
      node.setAttribute('aria-hidden', 'true');
      const marker = new maplibregl.Marker({ element: node, anchor: 'top-left' }).setLngLat(at).addTo(map);
      marker.getElement().style.zIndex = '9';
      labels.set(key, { marker, el: node, lngLat: at, kind: 'driver', size: null });
    }
    layoutRef.current();
  }, [live.drivers, ready, candidates, picked, selectedDriver, followId, theme, atRiskDrivers]);

  // ── waiting orders ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const store = ordersRef.current;
    const seen = new Set<string>();
    const focusId = focusTripId ?? (selected?.kind === 'trip' ? selected.id : null);
    (orders ?? []).forEach((tag, index) => {
      seen.add(tag.key);
      const lngLat: [number, number] = [tag.lng, tag.lat];
      const first = tag.tripIds[0]!;
      const isSel = focusId !== null && tag.tripIds.includes(focusId);
      const text = cb.current.orderText?.(isSel && focusId ? focusId : first) ?? '';
      const look = `${text}|${tag.tone}|${isSel}`;
      let entry = store.get(tag.key);
      if (!entry) {
        const node = document.createElement('div');
        node.className = 'ops-order';
        node.addEventListener('mouseenter', () => {
          const box = node.getBoundingClientRect();
          const host = container.current?.getBoundingClientRect();
          const trip = node.dataset['tripId'];
          if (host && trip) setHover({ kind: 'order', id: trip, x: box.left - host.left + box.width / 2, y: box.top - host.top });
        });
        node.addEventListener('mouseleave', () => setHover((h) => (h?.kind === 'order' ? null : h)));
        node.addEventListener('click', (e) => {
          e.stopPropagation();
          const trip = node.dataset['tripId'];
          if (trip) cb.current.onSelect({ kind: 'trip', id: trip });
        });
        const textEl = document.createElement('span');
        const moreEl = document.createElement('span');
        moreEl.className = 'ops-order-more';
        moreEl.dir = 'ltr';
        node.append(textEl, moreEl);
        const marker = new maplibregl.Marker({ element: node, anchor: 'bottom', offset: [0, -6] }).setLngLat(lngLat).addTo(map);
        entry = { marker, el: node, look: '', lngLat, count: 1, rank: 0, text: textEl, more: moreEl };
        store.set(tag.key, entry);
      }
      entry.el.dataset['tripId'] = isSel && focusId ? focusId : first;
      entry.count = tag.tripIds.length;
      entry.rank = isSel ? -1 : index;
      if (entry.look !== look) {
        entry.look = look;
        entry.el.dataset['tone'] = tag.tone;
        entry.el.classList.toggle('is-selected', isSel);
        entry.el.style.zIndex = isSel ? '5' : tag.tone === 'bad' ? '1' : '';
        entry.text.textContent = text;
      }
    });
    for (const [key, e] of store) {
      if (seen.has(key)) continue;
      e.marker.remove();
      store.delete(key);
    }
    layoutRef.current();
  }, [orders, ready, focusTripId, selected, theme]);

  // ── camera ──
  useEffect(() => {
    if (fitKey > 0) mapRef.current?.fitBounds(AZIZIYAH_BOUNDS, { padding: 32 });
  }, [fitKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (focus && map) map.easeTo({ center: [focus.lng, focus.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
  }, [focus]);

  // Follow a driver: keep him centred on every position update.
  const followAt = followId ? live.drivers.features.find((f) => f.properties.driverId === followId)?.geometry.coordinates : undefined;
  const followLng = followAt?.[0];
  const followLat = followAt?.[1];
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || followLng === undefined || followLat === undefined) return;
    map.easeTo({ center: [followLng, followLat], zoom: Math.max(map.getZoom(), 15), duration: 800 });
  }, [followId, followLng, followLat, ready]);

  if (failed) {
    return (
      <div className="flex h-full flex-col">
        <p role="status" className="px-3 py-2 text-sm text-muted">
          {t('console.map_failed')}
        </p>
        <ZonesSvg className="min-h-0 flex-1" placements={zonesQuery.data} />
      </div>
    );
  }

  const card = hover && props.renderHover ? props.renderHover(hover) : null;
  const host = container.current;
  const flipDown = hover ? hover.y < 170 : false;
  const left = hover && host ? Math.min(Math.max(hover.x, 150), host.clientWidth - 150) : 0;
  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" role="region" aria-label={t('console.map_title')} />
      {hover && card ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-30 w-[280px] -translate-x-1/2 animate-pop-in rounded-lg border border-line bg-raised p-3 text-sm shadow-pop"
          style={{ left, top: flipDown ? hover.y + 34 : undefined, bottom: flipDown ? undefined : (host?.clientHeight ?? 0) - hover.y + 8 }}
        >
          {card}
        </div>
      ) : null}
    </div>
  );
}
