import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GeoJSONSource, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import type { GuardianRunView } from '@driver/contracts';
import { useTheme } from '@driver/ui';
import { MAP_GLYPHS_URL, MAP_TILES_URL } from '@/lib/env';
import { useT } from '@/lib/i18n';
import { prepareGolden } from '@/features/track/map/golden-setup';
import { ensureMaplibreCss } from '@/features/track/map/maplibre-css';
import { GOLDEN_MAP } from '@/features/track/map/credit';
import { khatScene, type Pt } from './bus';
import { BusPin, HomePin, SCHOOL_DOT_R, SchoolPin } from './KhatPins';

// The map's base (`golden`) and the screens' pieces (the khat route, from its own entry so this screen carries no other piece).
type Golden = typeof import('@driver/map/golden') & typeof import('@driver/map/pieces/khat');

export interface KhatMapProps {
  view: GuardianRunView;
  /** Screen space the top bar and the sheet cover, so the camera frames the route in what is left. */
  topInset: number;
  bottomInset: number;
  /** Cheap phones and low-data mode: the flat map. */
  lite: boolean;
  /** Our map file failed (or WebGL is missing): the screen shows the sheet alone. */
  onFail: () => void;
}

/** Whether this build can draw the bus map (web, with our map files set up). */
export const KHAT_MAP = GOLDEN_MAP;

const SOURCE = 'khat-run';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * «بس بيتك والباص» on the web (map idea N14): the Golden hour map with the run's line, the other
 * children's stops as blank dots, and three pins drawn by the screen (بيتكم, المدرسة, الباص), placed
 * from MapLibre's projection every frame. The camera fits the route once and then stays still: a new
 * fix moves the bus pin only (no glide, no idle motion), so reduce motion needs nothing more.
 */
export function KhatMap({ view, topInset, bottomInset, lite, onFail }: KhatMapProps) {
  const theme = useTheme();
  const t = useT();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const goldenRef = useRef<Golden | null>(null);
  const pins = useRef(new Map<'home' | 'school' | 'bus', HTMLElement>());
  const scene = useMemo(() => khatScene(view), [view]);
  const live = useRef({ scene, topInset, bottomInset, lite });
  live.current = { scene, topInset, bottomInset, lite };
  const failRef = useRef(onFail);
  failRef.current = onFail;

  const placePins = () => {
    const m = mapRef.current;
    if (!m) return;
    const s = live.current.scene;
    const at: Record<'home' | 'school' | 'bus', Pt | undefined> = { home: s.home, school: s.school, bus: s.bus };
    for (const [id, el] of pins.current) {
      const p = at[id];
      el.style.display = p ? 'flex' : 'none';
      if (!p) continue;
      const xy = m.project(p);
      // The bus pill sits on its point, the home pin stands on its, and the school dot's centre is on the school.
      const lift = id === 'bus' ? '-50%' : id === 'school' ? `calc(-100% + ${SCHOOL_DOT_R}px)` : '-100%';
      el.style.transform = `translate(${Math.round(xy.x)}px, ${Math.round(xy.y)}px) translate(-50%, ${lift})`;
    }
  };

  const paint = () => {
    const m = mapRef.current;
    const golden = goldenRef.current;
    if (!m || !golden) return;
    const s = live.current.scene;
    m.getSource<GeoJSONSource>(SOURCE)?.setData(golden.khatRouteGeoJSON({ route: s.route, school: s.school, mine: s.home, others: s.others, ...(s.bus ? { bus: s.bus } : {}) }) as GeoJSON.FeatureCollection);
  };

  /** Fits the line and the pins once, flat and north-up, with room for the pins' pills. */
  const frame = () => {
    const m = mapRef.current;
    if (!m) return;
    const s = live.current;
    const pts = [...s.scene.route, s.scene.home, s.scene.school, ...(s.scene.bus ? [s.scene.bus] : [])];
    const lngs = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    const fit = m.cameraForBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: { top: s.topInset + 72, bottom: s.bottomInset + 32, left: 72, right: 72 }, maxZoom: 17 },
    );
    if (fit) m.jumpTo({ center: fit.center, zoom: Math.min(fit.zoom ?? 16, 17), bearing: 0, pitch: 0 });
  };

  // ── the map, created once ──
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    let stopFallback: (() => void) | undefined;
    Promise.all([import('maplibre-gl'), import('@driver/map/golden'), import('@driver/map/pieces/khat')])
      .then(async ([mod, base, pieces]) => {
        const golden: Golden = { ...base, ...pieces };
        const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
        await prepareGolden(maplibregl);
        if (cancelled || !container.current) return;
        ensureMaplibreCss();
        goldenRef.current = golden;
        const light = golden.resolveLight().light;
        const style = golden.chooseMapStyle({ tilesUrl: MAP_TILES_URL, glyphsUrl: MAP_GLYPHS_URL, mode: live.current.lite ? 'lite' : 'customer', light }).style as unknown as StyleSpecification;
        try {
          map = new maplibregl.Map({ container: container.current, style, center: live.current.scene.home, zoom: 15, attributionControl: false, fadeDuration: 0 });
        } catch {
          failRef.current();
          return;
        }
        const m = map;
        mapRef.current = m;
        m.on('error', () => undefined);
        stopFallback = golden.fallBackToOriginalMap(m as never, { onFallback: () => failRef.current() });
        m.on('style.load', () => {
          for (const [id, img] of Object.entries(golden.goldenImages(light))) {
            if (m.hasImage(id)) m.updateImage(id, img);
            else m.addImage(id, img);
          }
          if (!m.getSource(SOURCE)) m.addSource(SOURCE, { type: 'geojson', data: EMPTY });
          const before = m.getLayer(golden.GOLDEN_FIRST_LABEL) ? golden.GOLDEN_FIRST_LABEL : undefined;
          for (const layer of golden.khatRouteLayers({ source: SOURCE, light })) if (!m.getLayer(layer.id)) m.addLayer(layer as never, before);
          paint();
        });
        m.once('load', () => {
          frame();
          placePins();
        });
        m.on('render', placePins);
      })
      .catch(() => failRef.current());
    return () => {
      cancelled = true;
      stopFallback?.();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // A new read: the line and the bus move, the camera does not.
  useEffect(() => {
    paint();
    placePins();
  }, [scene]);

  const asPin = (id: 'home' | 'school' | 'bus') => (el: unknown) => {
    if (el) pins.current.set(id, el as HTMLElement);
    else pins.current.delete(id);
  };

  return (
    <View style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden', backgroundColor: theme.colors.bg }]} testID="khat-map" accessibilityLabel={t('khat_bus.map_label')}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      <View ref={asPin('home') as never} style={[styles.pin, { display: 'none' }]} pointerEvents="none">
        <HomePin compact={scene.compactHome} />
      </View>
      <View ref={asPin('school') as never} style={[styles.pin, { display: 'none' }]} pointerEvents="none">
        <SchoolPin landmark={view.school.landmark} compact={scene.compactSchool} />
      </View>
      <View ref={asPin('bus') as never} style={[styles.pin, { display: 'none' }]} pointerEvents="none">
        <BusPin />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { position: 'absolute', left: 0, top: 0, alignItems: 'center' },
});
