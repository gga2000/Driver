import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { GeoJSONSource, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import type { CourierPosition, OrderTracking } from '@driver/contracts';
import { Avatar, Icon, Text, useTheme, withAlpha } from '@driver/ui';
import { MAP_GLYPHS_URL, MAP_TILES_URL } from '@/lib/env';
import { useT } from '@/lib/i18n';
import { apiPhoto } from '@/lib/photo';
import { distanceM, type LngLat } from '../geo';
import { litBuilding, momentOf, routeGeoJSON, routeParts } from '../map3d';
import { glidePos } from '../motion';
import { isLive, POSITION_POLL_MS, useOrderRoute } from '../queries';
import { MAP_CREDIT } from './credit';
import { LIGHT_CHECK_MS, prepareGolden } from './golden-setup';
import { ensureMaplibreCss } from './maplibre-css';
import { RecentreChip } from './RecentreChip';
import { useRoadGlide } from './useRoadGlide';

type Golden = typeof import('@driver/map/golden');
type Pt = [number, number];

const SRC = { route: 'track-route', glow: 'track-glow', lit: 'track-lit' } as const;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
/** The route redraws at most this often while the courier glides (the marker itself moves every frame). */
const ROUTE_REDRAW_MS = 250;
const PIN = 40;
const PHOTO = 38;
const RING_W = 3;

export interface TrackMap3DProps {
  view: OrderTracking;
  fix: CourierPosition | null;
  stale: boolean;
  topInset: number;
  bottomInset: number;
  /** Our map file failed (or WebGL is missing): the screen shows the flat map instead. */
  onFail: () => void;
}

const pt = (p: LngLat): Pt => [p.lng, p.lat];

/**
 * The live order map in 3D, web (docs/specs/2026-10-09-map-golden-hour-design.md, "The order map"):
 * the kitchen lit while it cooks, a tilted ride over a risen town with one glint per update, a
 * closer tilt as he nears, the house lit on arrival. Pins are screen markers above the map (no roof
 * hides them), placed every frame from MapLibre's own projection, so they follow tilt and turn.
 */
export function TrackMap3D({ view, fix, stale, topInset, bottomInset, onFail }: TrackMap3DProps) {
  const theme = useTheme();
  const t = useT();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const goldenRef = useRef<Golden | null>(null);
  const lightRef = useRef<ReturnType<Golden['resolveLight']>['light'] | null>(null);
  const [ready, setReady] = useState(false);
  const [follow, setFollow] = useState(true);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const home = view.dropoff?.pin ?? view.trip?.stops.find((s) => s.mine && s.type === 'dropoff')?.target ?? null;
  const kitchen = view.merchant?.pin ?? null;
  const pickedUp = Boolean(view.order.pickedUpAt);
  const toDoorM = fix && home ? distanceM(fix.pin, home) : null;
  const moment = momentOf(view, toDoorM);

  const stage = `${view.order.state}:${view.trip?.state ?? 'none'}:${pickedUp}`;
  const roadQuery = useOrderRoute(view.order.id, isLive(view), stage);
  const motion = useRoadGlide({ fix, polyline6: roadQuery.data?.polyline6 ?? null, stale, intervalMs: POSITION_POLL_MS, onStray: () => void roadQuery.refetch() });

  // Everything the frame loop and map callbacks read, without re-creating the map.
  const live = useRef({ moment, kitchen, home, pickedUp, follow, topInset, bottomInset, reduce: theme.reduceMotion });
  live.current = { moment, kitchen, home, pickedUp, follow, topInset, bottomInset, reduce: theme.reduceMotion };
  const failRef = useRef(onFail);
  failRef.current = onFail;

  const kitchenPin = useRef<HTMLElement | null>(null);
  const doorPin = useRef<HTMLElement | null>(null);
  const courierPin = useRef<HTMLElement | null>(null);
  const wedge = useRef<HTMLElement | null>(null);
  const courierAt = useRef<{ pos: LngLat; heading: number; d: number | null } | null>(null);
  const glint = useRef<() => void>(() => undefined);

  /** Where the courier is drawn now (gliding along the road between fixes). */
  const courierNow = () => {
    const g = motion.glide.value;
    if (!g) return null;
    return glidePos(g, motion.path.value, motion.progress.value);
  };

  /** The moment's camera, eased (1.2 s) or jumped (first frame, reduce motion). */
  const frame = (animate: boolean) => {
    const m = mapRef.current;
    const golden = goldenRef.current;
    const s = live.current;
    if (!m || !golden) return;
    const to = s.home ?? s.kitchen;
    const from = s.kitchen ?? s.home;
    if (!to || !from) return;
    const vehicle = s.moment === 'on_the_way' || s.moment === 'near' ? courierAt.current?.pos : undefined;
    const cam = golden.trackingCamera(s.moment, { from: pt(from), to: pt(to), ...(vehicle ? { vehicle: pt(vehicle) } : {}) });
    const padding = { top: s.topInset + 56, bottom: s.bottomInset + 56, left: 48, right: 48 };
    const duration = animate && !s.reduce ? golden.TRACKING_EASE_MS : 0;
    if (cam.bounds) m.fitBounds(cam.bounds, { padding, maxZoom: cam.maxZoom, pitch: cam.pitch, bearing: cam.bearing, duration });
    else m.easeTo({ center: cam.center, zoom: cam.zoom, pitch: cam.pitch, bearing: cam.bearing, padding, duration });
  };

  /** Route, glow and the lit building for the current moment. */
  const paint = () => {
    const m = mapRef.current;
    if (!m || !m.getSource(SRC.route)) return;
    const s = live.current;
    const here = s.moment === 'kitchen' ? null : courierAt.current;
    const parts = routeParts(s.moment, motion.path.value, { kitchen: s.kitchen, door: s.home, d: here?.d ?? null, courier: here?.pos ?? null });
    m.getSource<GeoJSONSource>(SRC.route)?.setData(routeGeoJSON(parts));
    const spot = s.moment === 'kitchen' ? s.kitchen : s.home;
    m.getSource<GeoJSONSource>(SRC.glow)?.setData(spot ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pt(spot) } }] } : EMPTY);
    const litAt = s.moment === 'kitchen' ? s.kitchen : s.moment === 'arrived' ? s.home : null;
    m.getSource<GeoJSONSource>(SRC.lit)?.setData(litAt ? litBuilding(litAt, housesNear(m, goldenRef.current)) : EMPTY);
  };

  // ── the map, created once ──
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let glintRaf = 0;
    let lightTimer: ReturnType<typeof setInterval> | undefined;
    let stopFallback: (() => void) | undefined;
    let map: MlMap | null = null;
    Promise.all([import('maplibre-gl'), import('@driver/map/golden')])
      .then(async ([mod, golden]) => {
        const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
        await prepareGolden(maplibregl);
        if (cancelled || !container.current) return;
        ensureMaplibreCss();
        goldenRef.current = golden;
        lightRef.current = golden.resolveLight().light;
        const style = () =>
          golden.chooseMapStyle({ tilesUrl: MAP_TILES_URL, glyphsUrl: MAP_GLYPHS_URL, mode: 'customer', light: lightRef.current!, riseAt: golden.TRACKING_RISE_ZOOM }).style as unknown as StyleSpecification;
        const start = live.current.kitchen ?? live.current.home;
        try {
          map = new maplibregl.Map({
            container: container.current,
            style: style(),
            ...(start ? { center: pt(start), zoom: 16 } : {}),
            attributionControl: false,
            dragRotate: false,
            touchPitch: false,
            fadeDuration: 0,
            maxPitch: 60,
          });
        } catch {
          failRef.current();
          return;
        }
        const m = map;
        mapRef.current = m;
        m.touchZoomRotate.disableRotation();
        m.keyboard.disableRotation();
        m.on('error', () => undefined);
        stopFallback = golden.fallBackToOriginalMap(m as never, { onFallback: () => failRef.current() });

        m.on('style.load', () => {
          const light = lightRef.current!;
          for (const [id, img] of Object.entries(golden.goldenImages(light))) {
            if (m.hasImage(id)) m.updateImage(id, img);
            else m.addImage(id, img);
          }
          // Place names fight the risen roofs; street names stay.
          if (m.getLayer('golden-places')) m.setLayoutProperty('golden-places', 'visibility', 'none');
          m.addSource(SRC.route, { type: 'geojson', data: EMPTY, lineMetrics: true });
          m.addSource(SRC.glow, { type: 'geojson', data: EMPTY });
          m.addSource(SRC.lit, { type: 'geojson', data: EMPTY });
          const before = m.getLayer(golden.GOLDEN_FIRST_LABEL) ? golden.GOLDEN_FIRST_LABEL : undefined;
          for (const layer of golden.goldenTrackingLayers({ service: 'food', light, routeSource: SRC.route, glowSource: SRC.glow, litSource: SRC.lit })) m.addLayer(layer as never, before);
          paint();
        });
        m.once('load', () => {
          frame(false);
          setReady(true);
        });
        // The town's houses arrive with the tiles: light the right one once they are in.
        m.once('idle', () => paint());
        m.on('movestart', (e) => {
          if ((e as { originalEvent?: unknown }).originalEvent) setFollow(false);
        });

        lightTimer = setInterval(() => {
          const next = golden.resolveLight().light;
          if (next === lightRef.current) return;
          lightRef.current = next;
          m.setStyle(style());
        }, LIGHT_CHECK_MS);

        // Every frame: the courier glides, the pins follow the map's own projection (tilt and turn).
        let lastRoute = 0;
        let lastAt = '';
        const place = (el: HTMLElement | null, at: LngLat | null, ax: number, ay: number) => {
          if (!el) return;
          if (!at) {
            el.style.display = 'none';
            return;
          }
          const p = m.project(pt(at));
          el.style.display = 'flex';
          el.style.transform = `translate(${p.x - ax}px, ${p.y - ay}px)`;
        };
        const tick = (now: number) => {
          const s = live.current;
          const c = courierNow();
          courierAt.current = c;
          const riding = s.moment === 'on_the_way' || s.moment === 'near';
          place(kitchenPin.current, s.moment === 'kitchen' ? s.kitchen : null, PIN / 2, PIN + 4);
          place(doorPin.current, s.home, PIN / 2, PIN + 4);
          const courierSpot = riding ? (c?.pos ?? null) : s.moment === 'arrived' && s.pickedUp ? s.home : null;
          place(courierPin.current, courierSpot, PHOTO / 2 + (s.moment === 'arrived' ? PIN : 0), PHOTO / 2 + (s.moment === 'arrived' ? PIN / 2 : 0));
          if (wedge.current) {
            wedge.current.style.display = riding && c ? 'block' : 'none';
            if (c) wedge.current.style.transform = `rotate(${c.heading - m.getBearing()}deg)`;
          }
          const at = c ? `${c.pos.lat},${c.pos.lng}` : '';
          if (riding && c && at !== lastAt && now - lastRoute > ROUTE_REDRAW_MS) {
            lastRoute = now;
            lastAt = at;
            paint();
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        // One glint courier → door after each position update, then the line rests.
        glint.current = () => {
          cancelAnimationFrame(glintRaf);
          const s = live.current;
          if (s.reduce || !m.getLayer('track-ahead')) return;
          const t0 = performance.now();
          const step = (now: number) => {
            const k = (now - t0) / golden.TRACKING_GLINT_MS;
            if (!m.getLayer('track-ahead')) return;
            m.setPaintProperty('track-ahead', 'line-gradient', golden.glintGradient('food', lightRef.current!, k >= 1 ? null : k) as never);
            if (k < 1) glintRaf = requestAnimationFrame(step);
          };
          glintRaf = requestAnimationFrame(step);
        };
      })
      .catch(() => failRef.current());
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(glintRaf);
      clearInterval(lightTimer);
      stopFallback?.();
      map?.remove();
      mapRef.current = null;
    };
    // The map is created once; everything else reaches it through `live` and the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.resize();
    if (ready) frame(false);
  }, [size.w, size.h, ready]);

  // A new moment: repaint and ease to its camera (unless the person moved the map).
  useEffect(() => {
    if (!ready) return;
    paint();
    if (live.current.follow) frame(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment, ready, roadQuery.data?.polyline6]);

  // Each position update: keep him and the door in the shot, and one glint along the road ahead.
  const fixKey = fix ? `${fix.at.getTime()}` : 'none';
  useEffect(() => {
    if (!ready || !fix) return;
    if (live.current.follow && (moment === 'on_the_way' || moment === 'near')) frame(true);
    if (moment === 'on_the_way' || moment === 'near') glint.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixKey, ready]);

  const recentre = () => {
    setFollow(true);
    live.current.follow = true;
    frame(true);
  };

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const ring = theme.colors.accent;
  const name = view.courier?.firstName ?? '';
  const asEl = (r: { current: HTMLElement | null }) => (el: unknown) => {
    r.current = el as HTMLElement | null;
  };

  return (
    <View style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden', backgroundColor: theme.colors.bg }]} onLayout={onLayout} accessibilityLabel={t('track.map_label')} testID="track-map">
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {/* Restaurant: saffron teardrop with the food icon. */}
      <View ref={asEl(kitchenPin)} pointerEvents="none" style={[styles.marker, { display: 'none' }]} testID="pin-kitchen">
        <Teardrop fill={theme.colors.accent} halo={withAlpha(theme.colors.accent, 0.25)}>
          <Icon name="food" size={18} color="text" strokeWidth={2.2} />
        </Teardrop>
      </View>
      {/* The door: dark teardrop, home icon, cream halo. */}
      <View ref={asEl(doorPin)} pointerEvents="none" style={[styles.marker, { display: 'none' }]} testID="pin-home">
        <Teardrop fill={theme.colors.text} halo={withAlpha(theme.colors.surface, 0.7)}>
          <Icon name="home" size={18} color="surface" strokeWidth={2.2} />
        </Teardrop>
      </View>
      {/* The courier: his approved photo in a ring of the service colour, a small wedge for his heading. */}
      <View ref={asEl(courierPin)} pointerEvents="none" style={[styles.marker, { display: 'none', alignItems: 'center' }]} testID="courier-marker">
        <View style={{ width: PHOTO, height: PHOTO, alignItems: 'center', justifyContent: 'center' }}>
          <View ref={asEl(wedge)} style={[StyleSheet.absoluteFill, { alignItems: 'center' }]}>
            <View style={{ marginTop: -7, width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderBottomWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: ring }} />
          </View>
          <View style={{ width: PHOTO, height: PHOTO, borderRadius: PHOTO / 2, borderWidth: RING_W, borderColor: stale ? theme.colors.borderStrong : ring, backgroundColor: theme.colors.surface, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(40,24,8,0.25)' }}>
            <Avatar name={name} uri={apiPhoto(view.courier?.photoUrl) ?? undefined} size={PHOTO - RING_W * 2} />
          </View>
        </View>
        {moment === 'arrived' ? (
          <View style={{ position: 'absolute', bottom: PHOTO + 6, paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: theme.colors.text, justifyContent: 'center', direction: 'rtl' }}>
            <Text variant="caption" weight={600} color="surface" numberOfLines={1}>
              {t('track.map_at_door')}
            </Text>
          </View>
        ) : null}
      </View>
      {!follow ? <RecentreChip bottom={bottomInset + theme.space[5]} onPress={recentre} /> : null}
      <Text variant="caption" color="textMuted" style={{ position: 'absolute', right: theme.space[3], bottom: bottomInset + theme.space[1], fontSize: 10, lineHeight: 14, opacity: 0.8 }}>
        {MAP_CREDIT}
      </Text>
    </View>
  );
}

/** A map pin: a rounded square turned 45°, tip down, with a soft halo. */
function Teardrop({ fill, halo, children }: { fill: string; halo: string; children: React.ReactNode }) {
  const inner = PIN - 6;
  return (
    <View style={{ width: PIN, height: PIN + 4, alignItems: 'center' }}>
      <View
        style={{
          width: inner,
          height: inner,
          marginTop: 3,
          backgroundColor: fill,
          borderRadius: inner / 2,
          borderBottomRightRadius: 3,
          transform: [{ rotate: '45deg' }],
          boxShadow: `0 0 0 4px ${halo}, 0 3px 8px rgba(40,24,8,0.3)`,
        }}
      />
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingBottom: 6 }]}>{children}</View>
    </View>
  );
}

/** The houses of our map around the screen, for lighting the one under a pin. */
function housesNear(m: MlMap, golden: Golden | null): { ring: Pt[]; hm: number }[] {
  if (!golden) return [];
  const out: { ring: Pt[]; hm: number }[] = [];
  for (const f of m.querySourceFeatures(golden.GOLDEN_SOURCE, { sourceLayer: 'buildings' })) {
    const g = f.geometry;
    const hm = Number((f.properties as { hm?: number } | null)?.hm ?? 6);
    if (g.type === 'Polygon') out.push({ ring: g.coordinates[0] as Pt[], hm });
    else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) out.push({ ring: poly[0] as Pt[], hm });
  }
  return out;
}

const styles = StyleSheet.create({
  marker: { position: 'absolute', left: 0, top: 0 },
});

/** The web draws the order map in 3D (the phones keep the flat map until the native map lands). */
export const TRACK_3D = true;
