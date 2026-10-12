import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { GeoJSONSource, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import { useTheme } from '@driver/ui';
import { MAP_GLYPHS_URL, MAP_TILES_URL } from '@/lib/env';
import { prepareGolden } from '@/features/track/map/golden-setup';
import { ensureMaplibreCss } from '@/features/track/map/maplibre-css';
import { GOLDEN_MAP } from '@/features/track/map/credit';
import { bearingAhead, pointAt, stripBounds } from './road-trip';
import { LOCALITIES_LAYER, roadChips, withoutNamed, type RoadMapProps } from './road-map-types';
import { CarPin, CarTag, HorizonCard, TownChip } from './RoadPins';

// The map's base (`golden`) and the screens' piece (the road, from its own entry so this screen carries no other piece).
type Golden = typeof import('@driver/map/golden') & typeof import('@driver/map/pieces/road');

/** Whether this build can draw the road (web, with our map files set up). */
export const ROAD_MAP = GOLDEN_MAP;
/** Whether the map can tilt for the window seat (WebGL maps always can). */
export const ROAD_TILT = GOLDEN_MAP;

const SOURCE = 'rajaa-road';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
/** The one glide when the view changes (or a town is passed in the window seat). */
const GLIDE_MS = 1400;
/** The strip follows the car with a short ease on each new fix. */
const STRIP_EASE_MS = 600;
const WINDOW = { pitch: 70, zoom: 13.4 };
const ease = (x: number) => 1 - (1 - x) ** 3;

/**
 * «طريق بغداد» on the web (map idea N13): the real road from the garage to Baghdad or Kut on the
 * Golden hour map, gold where the car has been and a cream dash ahead, the towns as chips and the car
 * as the driver's initial. Three ways to look at it: the pass's strip (about 20 km around the car,
 * still), the whole road framed once, and the window seat (tilted behind the car, looking down the
 * road). The camera glides once when the view changes and once when a town is passed in the window
 * seat, then holds still: nothing loops. Reduce motion and lite mode jump instead.
 */
export function RoadMap(props: RoadMapProps) {
  const { road, carM, mode, startName, initial, carTag, horizon, testID, accessibilityLabel } = props;
  const theme = useTheme();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const goldenRef = useRef<Golden | null>(null);
  const marks = useRef(new Map<string, HTMLElement>());
  const live = useRef({ ...props, reduce: theme.reduceMotion });
  live.current = { ...props, reduce: theme.reduceMotion };
  const failRef = useRef(props.onFail);
  failRef.current = props.onFail;

  const progress = useMemo(() => {
    const m = carM ?? 0;
    // the piece's own rule for "next" (a town within 300 m counts as reached)
    const ahead = road.towns.filter((t) => t.m - m > 300);
    return { next: ahead[0] ?? null, passed: carM === null ? [] : road.towns.filter((t) => !ahead.includes(t)) };
  }, [road, carM]);
  // Before the car leaves no town is "next" yet (the garage is).
  const chips = useMemo(() => (mode === 'window' ? [] : roadChips(road, startName, carM === null ? null : progress.next, progress.passed)), [mode, road, startName, carM, progress]);
  const car = carM === null ? null : pointAt(road, carM);
  const nextAt = progress.next ? (progress.next.kind === 'city' ? road.path[road.path.length - 1]! : progress.next.at) : null;
  const scene = useRef({ chips, car, nextAt });
  scene.current = { chips, car, nextAt };

  /** Each mark at its point, from the map's projection; a chip that would sit on one already placed hides. */
  const placeMarks = () => {
    const m = mapRef.current;
    if (!m) return;
    const { width, height } = m.getContainer().getBoundingClientRect();
    const taken: { x: number; y: number; w: number; h: number }[] = [];
    const overlaps = (r: { x: number; y: number; w: number; h: number }) => taken.some((q) => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
    const s = scene.current;
    // The strip's «الطريق كله» chip sits in the top corner (left, in Arabic): no town chip under it.
    if (live.current.mode === 'strip') taken.push({ x: 0, y: 0, w: 200, h: 60 });
    const carEl = marks.current.get('car');
    const tagEl = marks.current.get('tag');
    if (carEl) {
      carEl.style.display = s.car ? 'flex' : 'none';
      if (s.car) {
        const p = m.project(s.car);
        carEl.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
        taken.push({ x: p.x - 26, y: p.y - 26, w: 52, h: 52 });
        if (tagEl) {
          // The tag beside the car, on the side with more room.
          const w = tagEl.offsetWidth, h = tagEl.offsetHeight;
          const left = p.x > width / 2;
          const x = left ? p.x - 30 - w : p.x + 30;
          tagEl.style.display = 'flex';
          tagEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(p.y - h / 2)}px)`;
          taken.push({ x, y: p.y - h / 2, w, h });
        }
      } else if (tagEl) tagEl.style.display = 'none';
    }
    const horizonEl = marks.current.get('horizon');
    if (horizonEl) {
      const top = live.current.topInset + 56;
      let x = width / 2, y = top + horizonEl.offsetHeight;
      if (s.nextAt) {
        const p = m.project(s.nextAt);
        if (p.x > 40 && p.x < width - 40 && p.y > top + horizonEl.offsetHeight && p.y < height) ({ x, y } = { x: p.x, y: p.y - 10 });
      }
      horizonEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    }
    // The next town and the end first, so they always show.
    const order = [...s.chips].sort((a, b) => Number(b.tone === 'next' || b.tone === 'end') - Number(a.tone === 'next' || a.tone === 'end'));
    for (const c of order) {
      const el = marks.current.get(`chip:${c.id}`);
      if (!el) continue;
      const p = m.project(c.at);
      // A hidden chip measures 0: show it unseen for a moment to read its size.
      if (el.style.display === 'none') {
        el.style.visibility = 'hidden';
        el.style.display = 'flex';
      }
      const w = el.offsetWidth, h = el.offsetHeight;
      el.style.visibility = '';
      // Its own side of the road first, then the other side, then above or below its dot (off the
      // screen's edge, or on another mark).
      const left = { x: p.x - 10 - w, y: p.y - h / 2, w, h };
      const right = { x: p.x + 10, y: p.y - h / 2, w, h };
      const above = { x: p.x - w / 2, y: p.y - 10 - h, w, h };
      const below = { x: p.x - w / 2, y: p.y + 10, w, h };
      const tries = [...(c.side === 'left' ? [left, right] : [right, left]), above, below];
      const fits = tries.filter((q) => q.x >= 4 && q.x + w <= width - 4);
      const r = fits.find((q) => !overlaps(q)) ?? fits[0] ?? tries[0]!;
      const off = p.x < 0 || p.x > width || p.y < live.current.topInset || p.y > height - live.current.bottomInset;
      // The next town always shows, even over another chip (not under the strip's own «الطريق كله»).
      const hide = off || (overlaps(r) && (c.tone !== 'next' || live.current.mode === 'strip'));
      el.style.display = hide ? 'none' : 'flex';
      el.style.transform = `translate(${Math.round(r.x)}px, ${Math.round(r.y)}px)`;
      if (!hide) taken.push(r);
    }
  };

  const paint = () => {
    const m = mapRef.current;
    const golden = goldenRef.current;
    if (!m || !golden) return;
    const s = live.current;
    m.getSource<GeoJSONSource>(SOURCE)?.setData(golden.roadGeoJSON(s.road, { m: s.carM ?? 0 }) as GeoJSON.FeatureCollection);
  };

  /** Where the camera looks for this view. */
  const target = () => {
    const m = mapRef.current;
    const golden = goldenRef.current;
    if (!m || !golden) return null;
    const s = live.current;
    const { height } = m.getContainer().getBoundingClientRect();
    if (s.mode === 'window') {
      const at = s.carM ?? 0;
      // Just behind the car, looking down the road: the car sits low, the road runs up to the horizon.
      return { center: pointAt(s.road, at), zoom: WINDOW.zoom, pitch: WINDOW.pitch, bearing: bearingAhead(s.road, at), padding: { top: Math.round(height * 0.42), bottom: s.bottomInset + 24, left: 0, right: 0 } };
    }
    const box = s.mode === 'strip' ? stripBounds(s.road, s.carM) : golden.roadBounds(s.road);
    const pad = s.mode === 'strip' ? { top: 20, bottom: 20, left: 28, right: 28 } : { top: s.topInset + 40, bottom: s.bottomInset + 28, left: 56, right: 56 };
    const fit = m.cameraForBounds(box, { padding: pad, maxZoom: 13 });
    return fit ? { center: fit.center as [number, number], zoom: fit.zoom ?? 9, pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 } } : null;
  };

  const move = (how: 'jump' | 'glide' | 'ease') => {
    const m = mapRef.current;
    const at = target();
    if (!m || !at) return;
    const s = live.current;
    if (how === 'jump' || s.reduce || s.lite) m.jumpTo(at);
    else m.easeTo({ ...at, duration: how === 'glide' ? GLIDE_MS : STRIP_EASE_MS, easing: ease, essential: true });
  };

  // ── the map, created once ──
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    let stopFallback: (() => void) | undefined;
    Promise.all([import('maplibre-gl'), import('@driver/map/golden'), import('@driver/map/pieces/road')])
      .then(async ([mod, base, pieces]) => {
        const golden: Golden = { ...base, ...pieces };
        const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
        await prepareGolden(maplibregl);
        if (cancelled || !container.current) return;
        ensureMaplibreCss();
        goldenRef.current = golden;
        const light = golden.resolveLight().light;
        const s = live.current;
        const style = golden.chooseMapStyle({ tilesUrl: MAP_TILES_URL, glyphsUrl: MAP_GLYPHS_URL, mode: s.lite ? 'lite' : 'customer', light }).style as unknown as StyleSpecification;
        const fit = golden.roadBounds(s.road);
        try {
          map = new maplibregl.Map({
            container: container.current,
            style,
            bounds: fit,
            attributionControl: false,
            fadeDuration: 0,
            maxPitch: 75,
            // The strip is a picture: a tap opens the whole road.
            interactive: s.mode === 'whole',
            dragRotate: false,
            pitchWithRotate: false,
          });
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
          // The town names are the screen's chips (and the window seat's card), so the piece's own labels stay off.
          for (const layer of golden.roadLayers({ source: SOURCE, light })) {
            if (layer.type === 'symbol' || m.getLayer(layer.id)) continue;
            m.addLayer(layer as never, before);
          }
          if (m.getLayer(LOCALITIES_LAYER)) m.setFilter(LOCALITIES_LAYER, withoutNamed(m.getFilter(LOCALITIES_LAYER), [s.startName, ...s.road.towns.map((t) => t.nameAr)]) as never);
          paint();
        });
        m.once('load', () => {
          move('jump');
          placeMarks();
        });
        m.on('render', placeMarks);
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

  // The view changed (A ⇄ B): one glide there, then still. Gestures only on the whole road.
  const lastMode = useRef(mode);
  useEffect(() => {
    const m = mapRef.current;
    if (!m || lastMode.current === mode) return;
    lastMode.current = mode;
    for (const h of [m.dragPan, m.scrollZoom, m.touchZoomRotate, m.doubleClickZoom, m.keyboard]) {
      if (mode === 'whole') h.enable();
      else h.disable();
    }
    if (goldenRef.current) move('glide');
    placeMarks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // A new fix: the line and the car move. The strip eases along; the window seat glides once per town
  // passed and otherwise steps quietly with the car; the whole road holds its frame.
  const passedCount = progress.passed.length;
  const lastPassed = useRef(passedCount);
  useEffect(() => {
    paint();
    const m = mapRef.current;
    if (m && goldenRef.current) {
      if (mode === 'strip') move('ease');
      else if (mode === 'window') move(passedCount !== lastPassed.current ? 'glide' : 'jump');
    }
    lastPassed.current = passedCount;
    placeMarks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carM]);

  useEffect(() => {
    placeMarks();
  }, [chips, carTag, horizon]);

  const asMark = (id: string) => (el: unknown) => {
    if (el) marks.current.set(id, el as HTMLElement);
    else marks.current.delete(id);
  };

  return (
    <View style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }]} testID={testID ?? 'road-map'} accessibilityLabel={accessibilityLabel}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {chips.map((c) => (
        <View key={c.id} ref={asMark(`chip:${c.id}`) as never} style={[styles.mark, { display: 'none' }]} pointerEvents="none">
          <TownChip name={c.name} tone={c.tone} />
        </View>
      ))}
      {mode === 'whole' && carTag ? (
        <View ref={asMark('tag') as never} style={[styles.mark, { display: 'none' }]} pointerEvents="none">
          <CarTag top={carTag.top} bottom={carTag.bottom} />
        </View>
      ) : null}
      <View ref={asMark('car') as never} style={[styles.mark, { display: 'none' }]} pointerEvents="none">
        <CarPin initial={initial} size={mode === 'strip' ? 36 : 48} />
      </View>
      {mode === 'window' && horizon ? (
        <View ref={asMark('horizon') as never} style={styles.mark} pointerEvents="none">
          <HorizonCard eyebrow={horizon.eyebrow} title={horizon.title} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { position: 'absolute', left: 0, top: 0, alignItems: 'center' },
});
