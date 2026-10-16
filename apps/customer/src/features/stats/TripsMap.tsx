import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { LayerProps } from '@maplibre/maplibre-react-native';
import * as golden from '@driver/map/golden';
import { MY_TRIPS_CAMERA, MY_TRIPS_DRAW_MS, myTripsBounds, myTripsGeoJSON, myTripsLayers } from '@driver/map/pieces/my-trips';
import type { StatsTrips } from '@driver/contracts';
import { useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { nativeGoldenImages, nativeGoldenStyle, nativeMapLibre } from '@/features/track/map/native-maplibre';
import { tripsLight } from './trips-light';

const SOURCE = 'mytrips';

/**
 * «خريطتك» on phones (MapLibre Native): his own trips over the Golden hour map. The lines draw once, the
 * pins come in, then nothing moves; reduce motion shows it drawn. Pinch zooms; one finger scrolls the page.
 */
export function TripsMap({ trips, height, onFail }: { trips: StatsTrips; height: number; onFail: () => void }) {
  const theme = useTheme();
  const t = useT();
  const ml = nativeMapLibre();
  const light = useMemo(() => tripsLight(golden.resolveLight().light), []);
  const style = useMemo(() => nativeGoldenStyle(golden, light), [light]);
  const images = useMemo(() => nativeGoldenImages(golden, light), [light]);
  const layers = useMemo(() => myTripsLayers({ source: SOURCE, light }), [light]);
  const bounds = useMemo(() => myTripsBounds(trips), [trips]);
  const [ready, setReady] = useState(false);
  const [draw, setDraw] = useState<{ k?: number; pins?: boolean }>(theme.reduceMotion ? {} : { k: 0 });

  useEffect(() => {
    if (!ready || theme.reduceMotion) return;
    let raf = 0;
    const start = Date.now();
    const step = () => {
      const k = Math.min(1, (Date.now() - start) / MY_TRIPS_DRAW_MS);
      if (k < 1) {
        setDraw({ k: 1 - (1 - k) * (1 - k) });
        raf = requestAnimationFrame(step);
      } else setDraw({ k: 1, pins: true });
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [ready, theme.reduceMotion]);

  const data = useMemo(() => myTripsGeoJSON(trips, { labels: { baghdad: t('stats.map_to_baghdad'), kut: t('stats.map_to_kut') }, ...draw }), [trips, t, draw]);
  if (!ml) return null;
  return (
    <View style={{ height, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }} testID="stats-map-canvas">
      <ml.Map
        style={StyleSheet.absoluteFill}
        mapStyle={style}
        attribution={false}
        logo={false}
        compass={false}
        dragPan={false}
        touchPitch={false}
        touchRotate={false}
        onDidFinishLoadingMap={() => setReady(true)}
        onDidFailLoadingMap={onFail}
      >
        <ml.Camera
          initialViewState={bounds ? { bounds: [...bounds[0], ...bounds[1]] as never, padding: { top: 40, right: 40, bottom: 40, left: 40 }, ...MY_TRIPS_CAMERA } : { center: [45.0666, 32.9021], zoom: 13, ...MY_TRIPS_CAMERA }}
        />
        <ml.Images images={images} />
        <ml.GeoJSONSource id={SOURCE} data={data as GeoJSON.FeatureCollection}>
          {layers.map((l) => (
            <ml.Layer key={l.id} {...(l as unknown as LayerProps)} />
          ))}
        </ml.GeoJSONSource>
      </ml.Map>
    </View>
  );
}
