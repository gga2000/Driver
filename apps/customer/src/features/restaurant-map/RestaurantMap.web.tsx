import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { Icon, Text, useTheme, withAlpha } from '@driver/ui';
import { MAP_GLYPHS_URL, MAP_TILES_URL } from '@/lib/env';
import { useT } from '@/lib/i18n';
import { prepareGolden } from '@/features/track/map/golden-setup';
import { ensureMaplibreCss } from '@/features/track/map/maplibre-css';
import { GOLDEN_MAP } from '@/features/track/map/credit';
import type { MapShop } from './shops';

type Golden = typeof import('@driver/map/golden');
type Pt = [number, number];

export interface RestaurantMapProps {
  shops: MapShop[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Screen space the top bar and the brief cover, so the camera frames the shop in what is left. */
  topInset: number;
  bottomInset: number;
  /** Cheap phones and low-data mode: the flat map, no 3D shops, no flights. */
  lite: boolean;
  /** Our map file failed (or WebGL is missing): the screen shows the list instead. */
  onFail: () => void;
}

/** Whether this build can draw the restaurant map (web, with our map files set up). */
export const RESTAURANT_MAP = GOLDEN_MAP;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const PIN = 36;

/**
 * The restaurant map, web (Ali's idea 2026-10-09, "A · Lantern tour"; the shops are his mix of 2026-10-10):
 * every restaurant stands on the Golden hour map as its own 3D shop with a pin over it. Tapping one flies
 * the camera to its front (one flight, then one slow quarter-turn, then still); the shop lights up with a
 * lantern and light tubes. With reduce motion the map fades and the camera jumps. Pins are screen
 * elements placed from MapLibre's projection every frame, so roofs never hide them.
 */
export function RestaurantMap({ shops, selectedId, onSelect, topInset, bottomInset, lite, onFail }: RestaurantMapProps) {
  const theme = useTheme();
  const t = useT();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const goldenRef = useRef<Golden | null>(null);
  const lightRef = useRef<ReturnType<Golden['resolveLight']>['light']>('golden');
  const pins = useRef(new Map<string, HTMLElement>());
  const facing = useRef(new Map<string, number>());
  const houseFilters = useRef(new Map<string, FilterSpecification | undefined>());
  const live = useRef({ shops, selectedId, topInset, bottomInset, lite, reduce: theme.reduceMotion });
  live.current = { shops, selectedId, topInset, bottomInset, lite, reduce: theme.reduceMotion };
  const failRef = useRef(onFail);
  failRef.current = onFail;

  /** Puts every pin over its shop (hidden for the chosen one: its lantern marks it). */
  const placePins = () => {
    const m = mapRef.current;
    if (!m) return;
    const { width, height } = m.getContainer().getBoundingClientRect();
    // Names that would sit on one already shown keep only their disc (open shops come first, so they win).
    const taken: { x: number; y: number }[] = [];
    for (const s of live.current.shops) {
      const el = pins.current.get(s.id);
      if (!el) continue;
      const p = m.project(s.at);
      const off = p.x < -60 || p.y < -60 || p.x > width + 60 || p.y > height + 60;
      el.style.display = off || s.id === live.current.selectedId ? 'none' : 'flex';
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
      if (off) continue;
      const crowded = taken.some((q) => Math.abs(q.x - p.x) < 110 && Math.abs(q.y - p.y) < 34);
      const name = el.lastElementChild as HTMLElement | null;
      if (name) name.style.visibility = crowded ? 'hidden' : 'visible';
      if (!crowded) taken.push({ x: p.x, y: p.y });
    }
  };

  /** The shops' models, smoke and light pools for the current choice, and the houses they stand in for. */
  const paint = () => {
    const m = mapRef.current;
    const golden = goldenRef.current;
    if (!m || !golden || !m.getSource(golden.RESTAURANT_SOURCES.solid)) return;
    const s = live.current;
    const list = s.shops.map((x) => ({ id: x.id, at: x.at, facing: facing.current.get(x.id), kind: golden.restaurantKindOf([x.card.cuisine, ...x.card.tags]) }));
    const scene = golden.restaurantScene(list, { light: lightRef.current, selectedId: s.selectedId });
    m.getSource<GeoJSONSource>(golden.RESTAURANT_SOURCES.solid)?.setData(scene.solid);
    m.getSource<GeoJSONSource>(golden.RESTAURANT_SOURCES.soft)?.setData(scene.soft);
    m.getSource<GeoJSONSource>(golden.RESTAURANT_SOURCES.glow)?.setData(scene.glow);
    const hide = golden.restaurantHouseFilter(list, s.selectedId) as ExpressionSpecification;
    for (const id of golden.RESTAURANT_HIDES_HOUSE_LAYERS) {
      if (!m.getLayer(id)) continue;
      if (!houseFilters.current.has(id)) houseFilters.current.set(id, m.getFilter(id) ?? undefined);
      const own = houseFilters.current.get(id);
      m.setFilter(id, (own ? ['all', own, hide] : hide) as FilterSpecification);
    }
  };

  /** Turns each shop to its street once the streets around it have loaded. */
  const faceStreets = () => {
    const m = mapRef.current;
    const golden = goldenRef.current;
    if (!m || !golden) return;
    const roads: { cls: string; coords: Pt[] }[] = [];
    for (const f of m.querySourceFeatures(golden.GOLDEN_SOURCE, { sourceLayer: 'roads' })) {
      const cls = String(f.properties?.cls ?? '');
      const g = f.geometry;
      if (g.type === 'LineString') roads.push({ cls, coords: g.coordinates as Pt[] });
      else if (g.type === 'MultiLineString') for (const line of g.coordinates) roads.push({ cls, coords: line as Pt[] });
    }
    if (!roads.length) return;
    const bounds = m.getBounds();
    let changed = false;
    for (const s of live.current.shops) {
      if (facing.current.has(s.id) || !bounds.contains(s.at)) continue;
      facing.current.set(s.id, golden.faceRoad(s.at, roads));
      changed = true;
    }
    if (changed) paint();
  };

  /** The camera for the current choice: fly in to the shop, or back out over the town. */
  const frame = (animate: boolean) => {
    const m = mapRef.current;
    const golden = goldenRef.current;
    if (!m || !golden) return;
    const s = live.current;
    const padding = { top: s.topInset + 24, bottom: s.bottomInset + 24, left: 32, right: 32 };
    const quiet = !animate || s.reduce || s.lite;
    const go = (move: () => void) => {
      if (!quiet || !animate || !container.current) return move();
      // Reduce motion: a short fade instead of a flight.
      const el = container.current;
      el.style.transition = 'opacity 160ms ease-out';
      el.style.opacity = '0';
      setTimeout(() => {
        move();
        el.style.opacity = '1';
      }, 170);
    };
    const shop = s.shops.find((x) => x.id === s.selectedId);
    if (!shop) {
      const over = golden.restaurantOverview(s.shops);
      if (!over) return;
      // Fit the town flat first, then tilt: fitting with the tilt on leaves shops off the edge.
      const bearing = s.lite ? 0 : over.bearing;
      // Wider at the sides than the shops need: the names under the pins hang ~75 px each way.
      const fit = m.cameraForBounds(over.bounds, { padding: { ...padding, left: 80, right: 80 }, maxZoom: over.maxZoom, bearing });
      if (!fit) return;
      const cam = { center: fit.center, zoom: Math.min(fit.zoom ?? over.maxZoom, over.maxZoom), bearing, pitch: s.lite ? 0 : over.pitch, padding: { top: 0, bottom: 0, left: 0, right: 0 } };
      go(() => (quiet ? m.jumpTo(cam) : m.easeTo({ ...cam, duration: 1600 })));
      return;
    }
    const at = { at: shop.at, facing: facing.current.get(shop.id) };
    const cam = golden.restaurantFocusCamera(at);
    if (s.lite) {
      go(() => m.jumpTo({ center: cam.center, zoom: 18, pitch: 0, bearing: 0, padding }));
      return;
    }
    if (quiet) {
      go(() => m.jumpTo({ ...cam, padding }));
      return;
    }
    m.flyTo({ ...cam, padding, duration: golden.RESTAURANT_FLY_MS, curve: golden.RESTAURANT_FLY_CURVE, essential: true });
    const id = shop.id;
    // Once it lands: one slow turn round the shop, then still. A touch on the map stops it.
    m.once('moveend', () => {
      if (live.current.selectedId !== id || live.current.reduce) return;
      m.easeTo({ bearing: golden.restaurantSettledCamera(at).bearing, duration: golden.RESTAURANT_SETTLE_MS, easing: (x) => x * (2 - x), padding });
    });
  };

  // ── the map, created once ──
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    let stopFallback: (() => void) | undefined;
    Promise.all([import('maplibre-gl'), import('@driver/map/golden')])
      .then(async ([mod, golden]) => {
        const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
        await prepareGolden(maplibregl);
        if (cancelled || !container.current) return;
        ensureMaplibreCss();
        goldenRef.current = golden;
        lightRef.current = golden.resolveLight().light;
        const style = golden.chooseMapStyle({ tilesUrl: MAP_TILES_URL, glyphsUrl: MAP_GLYPHS_URL, mode: live.current.lite ? 'lite' : 'customer', light: lightRef.current }).style as unknown as StyleSpecification;
        const first = live.current.shops[0]?.at;
        try {
          map = new maplibregl.Map({ container: container.current, style, ...(first ? { center: first, zoom: 15 } : {}), attributionControl: false, fadeDuration: 0, maxPitch: 65 });
        } catch {
          failRef.current();
          return;
        }
        const m = map;
        mapRef.current = m;
        m.on('error', () => undefined);
        stopFallback = golden.fallBackToOriginalMap(m as never, { onFallback: () => failRef.current() });
        m.on('style.load', () => {
          for (const [id, img] of Object.entries(golden.goldenImages(lightRef.current))) {
            if (m.hasImage(id)) m.updateImage(id, img);
            else m.addImage(id, img);
          }
          // Place names fight the shops' signs and the pins; street names stay.
          if (m.getLayer('golden-places')) m.setLayoutProperty('golden-places', 'visibility', 'none');
          if (live.current.lite) return;
          for (const id of Object.values(golden.RESTAURANT_SOURCES)) m.addSource(id, { type: 'geojson', data: EMPTY });
          const before = m.getLayer(golden.GOLDEN_FIRST_LABEL) ? golden.GOLDEN_FIRST_LABEL : undefined;
          for (const layer of golden.restaurantLayers(lightRef.current)) m.addLayer(layer as never, before);
          houseFilters.current.clear();
          paint();
        });
        m.once('load', () => {
          frame(false);
          placePins();
        });
        m.on('render', placePins);
        m.on('idle', faceStreets);
      })
      .catch(() => failRef.current());
    return () => {
      cancelled = true;
      stopFallback?.();
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new choice: repaint the shops and move the camera.
  useEffect(() => {
    paint();
    placePins();
    frame(true);
     
  }, [selectedId]);

  // New data (the list refreshed): repaint without moving.
  useEffect(() => {
    paint();
    placePins();
     
  }, [shops]);

  const asPin = (id: string) => (el: unknown) => {
    if (el) pins.current.set(id, el as HTMLElement);
    else pins.current.delete(id);
  };

  return (
    <View style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden', backgroundColor: theme.colors.bg }]} testID="restaurant-map">
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {shops.map((s) => (
        <Pressable
          key={s.id}
          ref={asPin(s.id) as never}
          onPress={() => onSelect(s.id)}
          accessibilityRole="button"
          accessibilityLabel={t('restaurant_map.pin_label', { name: s.card.name, cuisine: s.card.cuisine })}
          testID={`restaurant-pin-${s.id}`}
          style={[styles.pin, { display: 'none' }]}
        >
          {/* A saffron disc with the food mark in a date-brown ring, and the name under it. */}
          <View style={{ width: PIN, height: PIN, borderRadius: PIN / 2, borderWidth: 3, borderColor: theme.colors.text, backgroundColor: s.card.open ? theme.colors.accent : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(40,24,8,0.3)' }}>
            <Icon name="food" size={17} color="text" strokeWidth={2.2} />
          </View>
          <View style={{ marginTop: 3, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: withAlpha(theme.colors.surface, 0.94), maxWidth: 150, boxShadow: '0 1px 3px rgba(40,24,8,0.2)' }}>
            <Text variant="caption" weight={700} numberOfLines={1} style={{ direction: 'rtl' }}>
              {s.card.name}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // Min 44 px tap target: the disc plus its name.
  pin: { position: 'absolute', left: 0, top: 0, alignItems: 'center', minWidth: 44, minHeight: 44 },
});
