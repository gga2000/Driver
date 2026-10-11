import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { GeoJSONSource, Map as MlMap, StyleSpecification } from 'maplibre-gl';
import type { StatsTrips } from '@driver/contracts';
import { useTheme } from '@driver/ui';
import { MAP_GLYPHS_URL, MAP_TILES_URL } from '@/lib/env';
import { useT } from '@/lib/i18n';
import { prepareGolden } from '@/features/track/map/golden-setup';
import { ensureMaplibreCss } from '@/features/track/map/maplibre-css';
import { tripsLight } from './trips-light';

const SOURCE = 'mytrips';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * «خريطتك» on the web: his own trips over the Golden hour map (the map thread's my-trips layer). The lines
 * draw once, the pins come in, then nothing moves; reduce motion shows it drawn. Pinch zooms; one finger
 * scrolls the page, so the map never traps it.
 */
export function TripsMap({ trips, height, onFail }: { trips: StatsTrips; height: number; onFail: () => void }) {
  const theme = useTheme();
  const t = useT();
  const container = useRef<HTMLDivElement | null>(null);
  const live = useRef({ trips, reduce: theme.reduceMotion, labels: { baghdad: t('stats.map_to_baghdad'), kut: t('stats.map_to_kut') } });
  live.current = { trips, reduce: theme.reduceMotion, labels: { baghdad: t('stats.map_to_baghdad'), kut: t('stats.map_to_kut') } };
  const failRef = useRef(onFail);
  failRef.current = onFail;

  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    let raf = 0;
    Promise.all([import('maplibre-gl'), import('@driver/map/golden'), import('@driver/map/pieces/my-trips')])
      .then(async ([mod, golden, mine]) => {
        const maplibregl = (mod as unknown as { default?: typeof mod }).default ?? mod;
        await prepareGolden(maplibregl);
        if (cancelled || !container.current) return;
        ensureMaplibreCss();
        const light = tripsLight(golden.resolveLight().light);
        const style = golden.chooseMapStyle({ tilesUrl: MAP_TILES_URL, glyphsUrl: MAP_GLYPHS_URL, mode: 'customer', light }).style as unknown as StyleSpecification;
        const bounds = mine.myTripsBounds(live.current.trips);
        try {
          map = new maplibregl.Map({
            container: container.current,
            style,
            ...(bounds ? { bounds, fitBoundsOptions: { padding: 40 } } : { center: [45.0666, 32.9021], zoom: 13 }),
            ...mine.MY_TRIPS_CAMERA,
            attributionControl: false,
            fadeDuration: 0,
            dragPan: false,
            scrollZoom: false,
            dragRotate: false,
            touchPitch: false,
          });
        } catch {
          failRef.current();
          return;
        }
        const m = map;
        m.on('error', () => undefined);
        golden.fallBackToOriginalMap(m as never, { onFallback: () => failRef.current() });
        m.on('style.load', () => {
          for (const [id, img] of Object.entries(golden.goldenImages(light))) {
            if (m.hasImage(id)) m.updateImage(id, img);
            else m.addImage(id, img);
          }
          if (m.getLayer('golden-places')) m.setLayoutProperty('golden-places', 'visibility', 'none');
          m.addSource(SOURCE, { type: 'geojson', data: EMPTY });
          for (const layer of mine.myTripsLayers({ source: SOURCE, light })) m.addLayer(layer as never);
          const src = m.getSource(SOURCE) as GeoJSONSource;
          const draw = (opts: { k?: number; pins?: boolean }) => src.setData(mine.myTripsGeoJSON(live.current.trips, { labels: live.current.labels, ...opts }) as never);
          if (live.current.reduce) {
            draw({});
            return;
          }
          // The one draw: lines over MY_TRIPS_DRAW_MS, then the pins, then still.
          const start = performance.now();
          const step = (now: number) => {
            const k = Math.min(1, (now - start) / mine.MY_TRIPS_DRAW_MS);
            if (k < 1) {
              draw({ k: 1 - (1 - k) * (1 - k) });
              raf = requestAnimationFrame(step);
            } else draw({ k: 1, pins: true });
          };
          raf = requestAnimationFrame(step);
        });
      })
      .catch(() => failRef.current());
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      map?.remove();
    };
  }, []);

  return (
    <View style={{ height, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }} testID="stats-map-canvas">
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
    </View>
  );
}
