import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { useTheme } from '@driver/ui';
import { MAP_GLYPHS_URL, MAP_TILES_URL } from '@/lib/env';
import { useT } from '@/lib/i18n';
import { prepareGolden } from '@/features/track/map/golden-setup';
import { ensureMaplibreCss } from '@/features/track/map/maplibre-css';
import { GOLDEN_MAP } from '@/features/track/map/credit';
import { framePoints, type LiveOrder, type LivePin } from './logic';
import { CourierDisc, HomePin, LiveBubble, LiveDot, OrderKitchen } from './Markers';

type Golden = typeof import('@driver/map/golden');
type Pt = [number, number];

export interface LiveMapProps {
  pins: LivePin[];
  /** Shops that show their name and minutes; the rest are dots. */
  bubbles: ReadonlySet<string>;
  /** Their place ([lng, lat]) and its label («بيتك»); no label when the map opened on the town centre. */
  home: Pt;
  homeLabel: string | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Their own food order on its way: the map turns into it and every shop goes quiet. */
  order: LiveOrder | null;
  topInset: number;
  bottomInset: number;
  /** Cheap phones and low-data mode: the flat map, no 3D shops, no flights. */
  lite: boolean;
  onFail: () => void;
  /** Home's hero: a picture of the town that doesn't take touches (the screen around it opens /live). */
  still?: boolean;
  /** Home's own hour (its `?now=`, Ramadan) instead of the sun: true is the night map, false the day map. */
  night?: boolean;
}

/** Whether this build can draw the live map (web, with our map files set up). */
export const LIVE_MAP = GOLDEN_MAP;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const ROUTE = 'live-route';
const ROUTE_PINS = 'live-route-pins';
/** Town view: close enough to read the street the shops stand on. */
const TOWN_MAX_ZOOM = 16.4;
/** …and never further out than this, so the 3D fronts stand up (far shops are a pan away). */
const TOWN_MIN_ZOOM = 14.6;
/** Home's hero is a short strip: closer, with their place and the two nearest named shops. */
const HERO_MIN_ZOOM = 15.6;
const HERO_SHOPS = 2;
/** Their place's pin and the bubbles hang above their point: the hero frames the points this much lower (twice the half-height, so the pin itself sits mid-strip). */
const PIN_LIFT = 56;

/** The middle of a [[w, s], [e, n]] box. */
const midOf = ([[w, so], [e, n]]: [Pt, Pt]): Pt => [(w + e) / 2, (so + n) / 2];

const routeData = (route: Pt[] | null): GeoJSON.FeatureCollection =>
  route && route.length > 1 ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { part: 'ahead' }, geometry: { type: 'LineString', coordinates: route } }] } : EMPTY;

/**
 * «العزيزية هسة» on the web (Ali, 2026-10-28): the Golden hour town around their place, every shop
 * standing as its own 3D front. Shops cooking now and the soonest ones carry their name and minutes;
 * the rest are quiet dots. With an order on its way the map shows that order only: the kitchen, their
 * courier on the street route, and their door. A chosen shop is flown to (one flight, one slow turn).
 * Markers are screen elements placed from the map's projection every frame, so roofs never hide them.
 * Reduce motion fades instead of flying; lite mode is the flat map with the same markers.
 */
export function LiveMap({ pins, bubbles, home, homeLabel, selectedId, onSelect, order, topInset, bottomInset, lite, onFail, still = false, night }: LiveMapProps) {
  const theme = useTheme();
  const t = useT();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const goldenRef = useRef<Golden | null>(null);
  const lightRef = useRef<ReturnType<Golden['resolveLight']>['light']>('golden');
  const marks = useRef(new Map<string, HTMLElement>());
  const facing = useRef(new Map<string, number>());
  const houseFilters = useRef(new Map<string, FilterSpecification | undefined>());
  const turned = useRef(false);
  const live = useRef({ pins, bubbles, home, selectedId, order, topInset, bottomInset, lite, still, reduce: theme.reduceMotion });
  live.current = { pins, bubbles, home, selectedId, order, topInset, bottomInset, lite, still, reduce: theme.reduceMotion };
  const failRef = useRef(onFail);
  failRef.current = onFail;

  /** Where each marker stands, by key, most important first: their order, their place, then named shops in bubble order. */
  const anchors = (): [string, Pt][] => {
    const s = live.current;
    const out: [string, Pt][] = [];
    if (s.order?.courier) out.push(['courier', s.order.courier]);
    if (s.order?.kitchen) out.push(['kitchen', s.order.kitchen.at]);
    out.push(['home', s.home]);
    const shops = s.pins.filter((p) => p.id !== s.selectedId);
    const named = shops.filter((p) => s.bubbles.has(p.id)).sort((a, b) => rank(a.id) - rank(b.id));
    for (const p of [...named, ...shops.filter((x) => !s.bubbles.has(x.id))]) out.push([`shop:${p.id}`, p.at]);
    return out;
  };
  const rank = (id: string) => [...live.current.bubbles].indexOf(id);

  /**
   * Puts every marker over its place. A shop's bubble that would cover one already placed (their place,
   * the order, a busier shop) shows as its dot instead, so names never pile up when the town is far.
   */
  const placeMarks = () => {
    const m = mapRef.current;
    if (!m) return;
    const { width, height } = m.getContainer().getBoundingClientRect();
    const s = live.current;
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const hits = (b: (typeof taken)[number]) => taken.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);
    const shown = new Set<string>();
    for (const [key, at] of anchors()) {
      const el = marks.current.get(key);
      if (!el) continue;
      const p = m.project(at);
      // The hero hides what would sit under the greeting and search.
      const off = p.x < -100 || p.y < (s.still ? s.topInset + 44 : -100) || p.x > width + 100 || p.y > height + 100;
      el.style.display = off ? 'none' : 'flex';
      shown.add(key);
      if (off) continue;
      const shop = key.startsWith('shop:');
      let dot = key === 'courier' || (shop && (Boolean(s.order) || !s.bubbles.has(key.slice(5))));
      // Bubbles hang above their spot (about 180 × 40 px); dots and the courier sit on it.
      const w = shop ? 180 : key === 'kitchen' ? 200 : 60;
      const box = dot ? { x0: p.x - 10, y0: p.y - 10, x1: p.x + 10, y1: p.y + 10 } : { x0: p.x - w / 2, y0: p.y - 44, x1: p.x + w / 2, y1: p.y };
      // A bubble that would cross the screen's side, or cover one already placed, shows as its dot.
      if (shop && !dot && (hits(box) || box.x0 < 4 || box.x1 > width - 4)) dot = true;
      if (!dot || !shop) taken.push(dot ? { x0: p.x - 22, y0: p.y - 22, x1: p.x + 22, y1: p.y + 22 } : box);
      if (shop && el.childElementCount > 1) {
        // A named shop holds both looks: the bubble first, the dot second.
        (el.firstElementChild as HTMLElement).style.display = dot ? 'none' : 'flex';
        (el.lastElementChild as HTMLElement).style.display = dot ? 'flex' : 'none';
      }
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, ${dot ? '-50%' : '-100%'})`;
    }
    for (const [key, el] of marks.current) if (!shown.has(key)) el.style.display = 'none';
  };

  /** The shops' 3D fronts for the current choice, and the houses they stand in for. */
  const paint = () => {
    const m = mapRef.current;
    const golden = goldenRef.current;
    if (!m || !golden || !m.getSource(golden.RESTAURANT_SOURCES.solid)) return;
    const s = live.current;
    const list = s.pins.map((x) => ({ id: x.id, at: x.at, facing: facing.current.get(x.id), kind: golden.restaurantKindOf([x.card.cuisine, ...x.card.tags]) }));
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

  const paintRoute = () => {
    mapRef.current?.getSource<GeoJSONSource>(ROUTE)?.setData(routeData(live.current.order?.route ?? null));
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
    for (const s of live.current.pins) {
      if (facing.current.has(s.id) || !bounds.contains(s.at)) continue;
      facing.current.set(s.id, golden.faceRoad(s.at, roads));
      changed = true;
    }
    if (changed) paint();
  };

  /** The camera: a chosen shop's front, the order end to end, or the town around their place. */
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
    const shop = s.order ? null : s.pins.find((x) => x.id === s.selectedId);
    if (!shop) {
      // Their place with the nearest named shops; the furthest drop out until the town stays close (TOWN_MIN_ZOOM).
      const points = framePoints(s.home, s.pins, s.bubbles, s.order).slice(0, s.still && !s.order ? 1 + HERO_SHOPS : undefined);
      const side = s.still ? 48 : 110;
      const minZoom = s.still ? HERO_MIN_ZOOM : TOWN_MIN_ZOOM;
      const fitOf = (pts: Pt[]) => {
        const over = golden.restaurantOverview(pts.map((at) => ({ at })));
        if (!over) return null;
        const bearing = s.lite ? 0 : over.bearing;
        const maxZoom = s.order ? over.maxZoom : TOWN_MAX_ZOOM;
        // Wide at the sides: the bubbles hang ~90 px each way, and the slow first turn swings the edges.
        const fit = m.cameraForBounds(over.bounds, { padding: { ...padding, left: side, right: side }, maxZoom, bearing });
        return fit ? { center: fit.center, mid: midOf(over.bounds), zoom: Math.min(fit.zoom ?? maxZoom, maxZoom), bearing, pitch: s.lite ? 0 : over.pitch } : null;
      };
      let fit = fitOf(points);
      while (!s.order && fit && fit.zoom < minZoom && points.length > 1) {
        points.pop();
        fit = fitOf(points);
      }
      if (!fit) return;
      // The hero: the middle of what it frames sits in the middle of the strip under the search (padding keeps it there with the tilt).
      const { mid, ...rest } = fit;
      const cam = s.still ? { ...rest, center: mid, padding: { top: s.topInset + PIN_LIFT, bottom: s.bottomInset, left: 0, right: 0 } } : { ...rest, padding: { top: 0, bottom: 0, left: 0, right: 0 } };
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
    // Once it lands: one slow turn round the shop, then still.
    m.once('moveend', () => {
      if (live.current.selectedId !== id || live.current.reduce) return;
      m.easeTo({ bearing: golden.restaurantSettledCamera(at).bearing, duration: golden.RESTAURANT_SETTLE_MS, easing: (x) => x * (2 - x), padding });
    });
  };

  /** On first open only: the camera turns slowly once over the town, then stays still. */
  const turnOnce = () => {
    const m = mapRef.current;
    const s = live.current;
    if (!m || turned.current || s.reduce || s.lite || s.selectedId || s.order) return;
    turned.current = true;
    m.easeTo({ bearing: m.getBearing() + 12, duration: 7000, easing: (x) => x * (2 - x) });
    // A touch stops it where it is.
    const stop = () => m.stop();
    m.once('mousedown', stop);
    m.once('touchstart', stop);
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
        lightRef.current = night === undefined ? golden.resolveLight().light : night ? 'night' : 'golden';
        const style = golden.chooseMapStyle({ tilesUrl: MAP_TILES_URL, glyphsUrl: MAP_GLYPHS_URL, mode: live.current.lite ? 'lite' : 'customer', light: lightRef.current }).style as unknown as StyleSpecification;
        try {
          map = new maplibregl.Map({ container: container.current, style, center: live.current.home, zoom: 15, attributionControl: false, fadeDuration: 0, maxPitch: 65, interactive: !still });
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
          // Place names fight the bubbles; street names stay.
          if (m.getLayer('golden-places')) m.setLayoutProperty('golden-places', 'visibility', 'none');
          const before = m.getLayer(golden.GOLDEN_FIRST_LABEL) ? golden.GOLDEN_FIRST_LABEL : undefined;
          // Their order's street route, in food saffron on a dark edge (the pins are our own markers).
          m.addSource(ROUTE, { type: 'geojson', data: routeData(live.current.order?.route ?? null) });
          m.addSource(ROUTE_PINS, { type: 'geojson', data: EMPTY });
          for (const layer of golden.goldenRouteLayers({ service: 'food', light: lightRef.current, routeSource: ROUTE, pinSource: ROUTE_PINS, id: ROUTE })) m.addLayer(layer as never, before);
          if (live.current.lite) return;
          for (const id of Object.values(golden.RESTAURANT_SOURCES)) m.addSource(id, { type: 'geojson', data: EMPTY });
          for (const layer of golden.restaurantLayers(lightRef.current)) m.addLayer(layer as never, before);
          houseFilters.current.clear();
          paint();
        });
        m.once('load', () => {
          frame(false);
          placeMarks();
          setTimeout(turnOnce, 600);
        });
        m.on('render', placeMarks);
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

  // A new choice, or the order came or went: repaint and move the camera.
  const orderId = order?.id ?? null;
  useEffect(() => {
    paint();
    paintRoute();
    placeMarks();
    frame(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, orderId]);

  // The hero's strip moves when its header grows (big text, a long greeting): frame it again, still.
  useEffect(() => {
    if (!still) return;
    mapRef.current?.resize();
    frame(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topInset, bottomInset]);

  // New data (the list, the chips, the town picture, the courier): repaint without moving.
  useEffect(() => {
    paint();
    paintRoute();
    placeMarks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, bubbles, order]);

  const asMark = (key: string) => (el: unknown) => {
    if (el) marks.current.set(key, el as HTMLElement);
    else marks.current.delete(key);
  };
  const dim = Boolean(order);

  return (
    <View pointerEvents={still ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden', backgroundColor: theme.colors.bg }]} testID={still ? 'live-map-still' : 'live-map'}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {pins
        .filter((p) => p.id !== selectedId)
        .map((p) => {
          const named = !dim && bubbles.has(p.id);
          return (
            <Pressable
              key={p.id}
              ref={asMark(`shop:${p.id}`) as never}
              onPress={() => onSelect(p.id)}
              disabled={dim}
              accessibilityRole="button"
              accessibilityLabel={p.card.open && p.minutes !== null ? t('live_map.pin_label', { name: p.card.name, n: p.minutes }) : t('live_map.pin_closed', { name: p.card.name })}
              testID={`live-pin-${p.id}`}
              style={[styles.mark, { display: 'none', zIndex: named ? 2 : 1 }]}
            >
              {named ? (
                <View style={{ direction: 'rtl' }}>
                  <LiveBubble pin={p} />
                </View>
              ) : null}
              <View style={{ direction: 'rtl', display: named ? 'none' : 'flex' }}>
                <LiveDot pin={p} dim={dim} />
              </View>
            </Pressable>
          );
        })}
      {homeLabel ? (
        <View ref={asMark('home') as never} pointerEvents="none" style={[styles.mark, { display: 'none', zIndex: 3 }]} testID="live-home">
          <View style={{ direction: 'rtl' }}>
            <HomePin label={homeLabel} />
          </View>
        </View>
      ) : null}
      {order?.kitchen ? (
        <View ref={asMark('kitchen') as never} pointerEvents="none" style={[styles.mark, { display: 'none', zIndex: 4 }]} testID="live-order-kitchen">
          <View style={{ direction: 'rtl' }}>
            <OrderKitchen name={order.kitchen.name} cooking={order.cooking} />
          </View>
        </View>
      ) : null}
      {order?.courier ? (
        <View ref={asMark('courier') as never} pointerEvents="none" style={[styles.mark, { display: 'none', zIndex: 5 }]} testID="live-courier">
          <CourierDisc />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Min 44 px tap target round every shop, dot or bubble.
  mark: { position: 'absolute', left: 0, top: 0, alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44 },
});
