import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { CameraRef, LayerProps } from '@maplibre/maplibre-react-native';
import type { GuardianRunView } from '@driver/contracts';
import * as golden from '@driver/map/golden';
import * as pieces from '@driver/map/pieces/khat';
import { useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { nativeGolden, nativeGoldenImages, nativeGoldenStyle, nativeMapLibre } from '@/features/track/map/native-maplibre';
import { khatScene } from './bus';
import { BusPin, HomePin, SchoolPin } from './KhatPins';

export interface KhatMapProps {
  view: GuardianRunView;
  /** Screen space the top bar and the sheet cover, so the camera frames the route in what is left. */
  topInset: number;
  bottomInset: number;
  /** Cheap phones and low-data mode: the flat map. */
  lite: boolean;
  /** Our map file failed: the screen shows the sheet alone. */
  onFail: () => void;
}

/** Whether this build can draw the bus map (a phone build with the native map and our map's files). */
export const KHAT_MAP = nativeGolden();

const SOURCE = 'khat-run';

/**
 * «بس بيتك والباص» on phones (MapLibre Native), the same as the web (KhatMap.web.tsx): the run's line,
 * the other children's stops as blank dots, and the three pins as the map's own markers. The camera fits
 * the route once and stays still; a new fix moves the bus marker only.
 */
export function KhatMap({ view, topInset, bottomInset, lite, onFail }: KhatMapProps) {
  const ml = nativeMapLibre()!;
  const theme = useTheme();
  const t = useT();
  const camera = useRef<CameraRef>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const framed = useRef(false);
  const light = useMemo(() => golden.resolveLight().light, []);
  const style = useMemo(() => nativeGoldenStyle(golden, light, lite ? 'lite' : 'customer'), [light, lite]);
  const images = useMemo(() => nativeGoldenImages(golden, light), [light]);
  const layers = useMemo(() => pieces.khatRouteLayers({ source: SOURCE, light }), [light]);
  const scene = useMemo(() => khatScene(view), [view]);
  const data = useMemo(
    () => pieces.khatRouteGeoJSON({ route: scene.route, school: scene.school, mine: scene.home, others: scene.others, ...(scene.bus ? { bus: scene.bus } : {}) }) as GeoJSON.FeatureCollection,
    [scene],
  );

  // Fit the line and the pins once, flat and north-up; later reads leave the camera where it is.
  useEffect(() => {
    if (!ready || !size.w || framed.current) return;
    framed.current = true;
    const pts = [...scene.route, scene.home, scene.school, ...(scene.bus ? [scene.bus] : [])];
    const fit = golden.fitCamera(pts, { width: size.w, height: size.h, padding: { top: topInset + 72, bottom: bottomInset + 32, left: 72, right: 72 }, maxZoom: 17 });
    camera.current?.jumpTo({ center: fit.center, zoom: fit.zoom, bearing: 0, pitch: 0 });
  }, [ready, size.w, size.h, scene, topInset, bottomInset]);

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: theme.colors.bg }]} onLayout={onLayout} testID="khat-map" accessibilityLabel={t('khat_bus.map_label')}>
      <ml.Map style={StyleSheet.absoluteFill} mapStyle={style} attribution={false} logo={false} compass={false} onDidFinishLoadingMap={() => setReady(true)} onDidFailLoadingMap={onFail}>
        <ml.Camera ref={camera} maxZoom={19} initialViewState={{ center: scene.home, zoom: 15 }} />
        <ml.Images images={images} />
        <ml.GeoJSONSource id={SOURCE} data={data}>
          {layers.map((l) => (
            <ml.Layer key={l.id} {...({ ...l, beforeId: golden.GOLDEN_FIRST_LABEL } as unknown as LayerProps)} />
          ))}
        </ml.GeoJSONSource>
        <ml.Marker id="khat-home" lngLat={scene.home} anchor="bottom">
          <HomePin compact={scene.compactHome} />
        </ml.Marker>
        <ml.Marker id="khat-school" lngLat={scene.school} anchor="bottom">
          <SchoolPin landmark={view.school.landmark} compact={scene.compactSchool} />
        </ml.Marker>
        {scene.bus ? (
          <ml.Marker id="khat-bus" lngLat={scene.bus} anchor="center">
            <BusPin />
          </ml.Marker>
        ) : null}
      </ml.Map>
    </View>
  );
}
