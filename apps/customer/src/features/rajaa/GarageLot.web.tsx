import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl';
import { Text, useTheme, withAlpha } from '@driver/ui';
import { MAP_GLYPHS_URL, MAP_TILES_URL } from '@/lib/env';
import { prepareGolden } from '@/features/track/map/golden-setup';
import { ensureMaplibreCss } from '@/features/track/map/maplibre-css';
import { GOLDEN_MAP } from '@/features/track/map/credit';
import { barLiftPx, garageCars, LOT_GLIDE_MS, lotCamera, seatBarPaint, spreadBays, type GarageBay } from './garage-cars';
import type { GarageLotProps, LotCar, SeatColours } from './garage-lot-types';

// The map's base (`golden`) and the screens' pieces (the seat bars, from their own entry so this screen carries no other piece).
type Golden = typeof import('@driver/map/golden') & typeof import('@driver/map/pieces/garage-seats');

/** Whether this build can draw the garage (web, with our map files set up). */
export const GARAGE_LOT_MAP = GOLDEN_MAP;

const SOURCE = 'garage-seats';
const LAYER = 'garage-seats';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
/** The seat bars rise once, one seat after another, over about a second. */
const RISE_MS = 1000;
const RISE_STAGGER = 0.07;

/**
 * The garage on the Golden hour map, web (map idea N12 «مقاعد تشوفها بالكراج»): the 3D garage with a
 * bar of seats floating over each car, gold for free and date brown for taken. The camera glides into
 * the lot once (~3 s, pitched, looking across the cars at the hall) and then holds still; the bars rise
 * once on arrival. Reduce motion and lite mode jump there with no flight and no rise. A tap on a bar or
 * on a car's time chip picks that car. Chips are screen elements placed from MapLibre's projection.
 */
export function GarageLot({ lotKey, garageId, departures, labelOf, selectedId, onSelect, topInset, bottomInset, lite, onFail, legend }: GarageLotProps) {
  const theme = useTheme();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const goldenRef = useRef<Golden | null>(null);
  const chips = useRef(new Map<string, HTMLElement>());
  const [bays, setBays] = useState<readonly GarageBay[] | null>(null);
  const [colours, setColours] = useState<SeatColours | null>(null);
  const risen = useRef(false);
  const rise = useRef<number | undefined>(undefined);
  // The cars spread over the lot's bays, soonest first.
  const cars: LotCar[] = useMemo(
    () =>
      bays
        ? garageCars(departures, garageId, spreadBays(bays, departures.length)).map((c) => {
            const d = departures.find((x) => x.id === c.id)!;
            return { ...c, ...labelOf(d) };
          })
        : [],
    [bays, departures, garageId, labelOf],
  );
  const live = useRef({ cars, bays, selectedId, topInset, bottomInset, lite, reduce: theme.reduceMotion, onSelect });
  live.current = { cars, bays, selectedId, topInset, bottomInset, lite, reduce: theme.reduceMotion, onSelect };
  const failRef = useRef(onFail);
  failRef.current = onFail;

  /** Puts each car's chip under its car; a chip that would sit on one already shown hides (the strip below lists every car). */
  const placeChips = () => {
    const m = mapRef.current;
    if (!m) return;
    const { width, height } = m.getContainer().getBoundingClientRect();
    const shown: { x: number; y: number }[] = [];
    // The chosen car first, so its chip always shows.
    const sel = live.current.selectedId;
    const order = [...live.current.cars].sort((a, b) => Number(b.id === sel) - Number(a.id === sel));
    // The chip sits just over its car's bar (the bars float over the roof).
    const lift = barLiftPx(m.getZoom(), m.getPitch(), m.getCenter().lat);
    for (const c of order) {
      const el = chips.current.get(c.id);
      if (!el) continue;
      const g = m.project(c.at);
      const p = { x: g.x, y: g.y - lift };
      // A chip cut by the screen edge hides; the strip under the map still lists that car.
      const off = p.x < 36 || p.y < 60 || p.x > width - 36 || p.y > height;
      const crowded = shown.some((q) => Math.abs(q.x - p.x) < 76 && Math.abs(q.y - p.y) < 40);
      el.style.display = off || crowded ? 'none' : 'flex';
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
      if (!off && !crowded) shown.push(p);
    }
  };

  /** The seat bars for the current cars. */
  const paint = () => {
    const m = mapRef.current;
    const golden = goldenRef.current;
    if (!m || !golden) return;
    m.getSource<GeoJSONSource>(SOURCE)?.setData(golden.garageSeatsGeoJSON(live.current.cars) as GeoJSON.FeatureCollection);
  };

  /** Once on arrival: each seat block grows from its base to its top, one seat after the next. */
  const riseOnce = () => {
    const m = mapRef.current;
    if (!m || risen.current || !m.getLayer(LAYER)) return;
    risen.current = true;
    if (live.current.reduce || live.current.lite || !live.current.cars.length) {
      m.setPaintProperty(LAYER, 'fill-extrusion-height', seatBarPaint().height as never);
      return;
    }
    const most = Math.max(1, ...live.current.cars.map((c) => c.seats));
    const span = 1 + RISE_STAGGER * (most - 1);
    const height = (t: number) => seatBarPaint({ t, stagger: RISE_STAGGER }).height as never;
    const start = performance.now();
    const step = (at: number) => {
      if (!mapRef.current?.getLayer(LAYER)) return;
      const p = Math.min(1, (at - start) / RISE_MS);
      m.setPaintProperty(LAYER, 'fill-extrusion-height', p >= 1 ? (seatBarPaint().height as never) : height((1 - (1 - p) ** 3) * span));
      if (p < 1) rise.current = requestAnimationFrame(step);
    };
    m.setPaintProperty(LAYER, 'fill-extrusion-height', height(0));
    rise.current = requestAnimationFrame(step);
  };

  /** The camera over the lot: one glide in on arrival (a jump with reduce motion or lite), or a quiet reframe. */
  const frame = (mode: 'arrive' | 'reframe') => {
    const m = mapRef.current;
    const cam = live.current.bays ? lotCamera(live.current.bays) : null;
    if (!m || !cam) return;
    const s = live.current;
    const padding = { top: s.topInset + 16, bottom: s.bottomInset + 16, left: 24, right: 24 };
    const at = { center: cam.center, zoom: cam.zoom, bearing: cam.bearing, pitch: s.lite ? 0 : cam.pitch, padding };
    if (s.lite || s.reduce) {
      m.jumpTo(at);
      if (mode === 'arrive') riseOnce();
      return;
    }
    if (mode === 'reframe') {
      m.easeTo({ ...at, duration: 450 });
      return;
    }
    // From a little out over the town, one glide in (slowing as it lands), then still.
    m.jumpTo({ center: cam.center, zoom: cam.zoom - 1.6, bearing: cam.bearing - 35, pitch: 35, padding });
    m.easeTo({ ...at, duration: LOT_GLIDE_MS, easing: (x) => 1 - (1 - x) ** 3, essential: true });
    m.once('moveend', riseOnce);
  };

  // ── the map, created once ──
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    let stopFallback: (() => void) | undefined;
    Promise.all([import('maplibre-gl'), import('@driver/map/golden'), import('@driver/map/pieces/garage-seats')])
      .then(async ([mod, base, pieces]) => {
        const golden: Golden = { ...base, ...pieces };
        const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
        await prepareGolden(maplibregl);
        if (cancelled || !container.current) return;
        ensureMaplibreCss();
        goldenRef.current = golden;
        const lotBays = golden.GARAGE_BAYS[lotKey];
        const cam = lotCamera(lotBays);
        if (!cam) return failRef.current();
        live.current.bays = lotBays;
        setBays(lotBays);
        const light = golden.resolveLight().light;
        setColours(golden.garageSeatColours(light));
        const style = golden.chooseMapStyle({ tilesUrl: MAP_TILES_URL, glyphsUrl: MAP_GLYPHS_URL, mode: live.current.lite ? 'lite' : 'customer', light }).style as unknown as StyleSpecification;
        try {
          map = new maplibregl.Map({ container: container.current, style, center: cam.center, zoom: cam.zoom - 1.6, attributionControl: false, fadeDuration: 0, maxPitch: 65 });
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
          // Place names fight the seat bars and the chips; street names stay.
          if (m.getLayer('golden-places')) m.setLayoutProperty('golden-places', 'visibility', 'none');
          m.addSource(SOURCE, { type: 'geojson', data: EMPTY });
          const before = m.getLayer(golden.GOLDEN_FIRST_LABEL) ? golden.GOLDEN_FIRST_LABEL : undefined;
          for (const layer of golden.garageSeatLayers({ source: SOURCE, light, id: LAYER })) m.addLayer(layer as never, before);
          // Flat until the camera lands and they rise (standing at once with reduce motion or lite).
          const rises = !live.current.reduce && !live.current.lite;
          m.setPaintProperty(LAYER, 'fill-extrusion-height', (rises ? seatBarPaint({ t: 0, stagger: RISE_STAGGER }) : seatBarPaint()).height as never);
          paint();
        });
        m.once('load', () => {
          frame('arrive');
          placeChips();
        });
        m.on('render', placeChips);
        // A tap on a seat bar picks its car; a tap on the bare lot lets go of the chosen one.
        m.on('click', (e: MapMouseEvent) => {
          const box: [[number, number], [number, number]] = [
            [e.point.x - 12, e.point.y - 12],
            [e.point.x + 12, e.point.y + 12],
          ];
          const hit = m.getLayer(LAYER) ? m.queryRenderedFeatures(box, { layers: [LAYER] })[0] : undefined;
          const id = hit?.properties?.car;
          live.current.onSelect(typeof id === 'string' ? id : null);
        });
        m.on('mousemove', (e: MapMouseEvent) => {
          const over = m.getLayer(LAYER) ? m.queryRenderedFeatures(e.point, { layers: [LAYER] }).length > 0 : false;
          m.getCanvas().style.cursor = over ? 'pointer' : '';
        });
      })
      .catch(() => failRef.current());
    return () => {
      cancelled = true;
      if (rise.current) cancelAnimationFrame(rise.current);
      stopFallback?.();
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New board data: new bars, no camera move.
  useEffect(() => {
    paint();
    placeChips();
  }, [cars]);

  // The bottom card came up or went: keep the lot in the space left (a short ease; a jump with reduce motion).
  const lastBottom = useRef(bottomInset);
  useEffect(() => {
    placeChips();
    if (Math.abs(lastBottom.current - bottomInset) < 24) return;
    lastBottom.current = bottomInset;
    if (mapRef.current?.loaded()) frame('reframe');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomInset, selectedId]);

  const asChip = (id: string) => (el: unknown) => {
    if (el) chips.current.set(id, el as HTMLElement);
    else chips.current.delete(id);
  };

  return (
    <>
    <View style={[StyleSheet.absoluteFill, { direction: 'ltr', overflow: 'hidden', backgroundColor: theme.colors.bg }]} testID="garage-lot-map">
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {cars.map((c) => {
        const on = c.id === selectedId;
        return (
          <Pressable
            key={c.id}
            ref={asChip(c.id) as never}
            onPress={() => onSelect(c.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={c.a11y}
            testID={`garage-car-pin-${c.id}`}
            style={[styles.chip, { display: 'none' }]}
          >
            <View
              style={{
                paddingHorizontal: theme.space[2],
                paddingVertical: 3,
                borderRadius: theme.radius.pill,
                borderWidth: 2,
                borderColor: on ? theme.colors.text : withAlpha(theme.colors.text, 0.15),
                backgroundColor: on ? theme.colors.accent : withAlpha(theme.colors.surface, 0.95),
                boxShadow: '0 1px 4px rgba(40,24,8,0.25)',
              }}
            >
              <Text variant="caption" weight={700} numberOfLines={1}>
                {c.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
    {/* Outside the left-to-right map box, so the legend reads right to left. */}
    {colours && legend ? legend(colours) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // Min 44 px tap target around the small time chip.
  chip: { position: 'absolute', left: 0, top: 0, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2, minWidth: 44, minHeight: 44 },
});
