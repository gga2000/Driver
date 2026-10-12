import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { CameraRef, LayerProps } from '@maplibre/maplibre-react-native';
import * as golden from '@driver/map/golden';
import * as road from '@driver/map/pieces/road';
import { useTheme } from '@driver/ui';
import { nativeGolden, nativeGoldenImages, nativeGoldenStyle, nativeMapLibre } from '@/features/track/map/native-maplibre';
import { bearingAhead, pointAt, stripBounds } from './road-trip';
import { LOCALITIES_LAYER, roadChips, withoutNamed, type RoadMapProps } from './road-map-types';
import { CarPin, CarTag, HorizonCard, TownChip } from './RoadPins';

/** Whether this build can draw the road (a phone build with the native map and our map's files). */
export const ROAD_MAP = nativeGolden();
/** Whether the map can tilt for the window seat (MapLibre Native always can). */
export const ROAD_TILT = ROAD_MAP;

const SOURCE = 'rajaa-road';
const GLIDE_MS = 1400;
const STRIP_EASE_MS = 600;
const WINDOW = { pitch: 70, zoom: 13.4 };

/**
 * «طريق بغداد» on phones (MapLibre Native), the same as the web (RoadMap.web.tsx): the road gold where
 * the car has been, the towns as chips, the car as the driver's initial; the strip, the whole road and
 * the window seat. One glide when the view changes or a town is passed in the window seat; then still.
 */
export function RoadMap(props: RoadMapProps) {
  const { road: r, carM, mode, startName, initial, carTag, horizon, topInset, bottomInset, lite, onFail, testID, accessibilityLabel } = props;
  const ml = nativeMapLibre()!;
  const theme = useTheme();
  const camera = useRef<CameraRef>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const light = useMemo(() => golden.resolveLight().light, []);
  // The map's own town names that our chips already say stay off (a town is never named twice).
  const style = useMemo(() => {
    const base = nativeGoldenStyle(golden, light, lite ? 'lite' : 'customer');
    const named = [startName, ...r.towns.map((t) => t.nameAr)];
    return { ...base, layers: base.layers.map((l) => (l.id === LOCALITIES_LAYER && l.type === 'symbol' ? { ...l, filter: withoutNamed(l.filter, named) as never } : l)) };
  }, [light, lite, startName, r]);
  const images = useMemo(() => nativeGoldenImages(golden, light), [light]);
  // The town names are the screen's chips, so the piece's own labels stay off.
  const layers = useMemo(() => road.roadLayers({ source: SOURCE, light }).filter((l) => l.type !== 'symbol'), [light]);
  const data = useMemo(() => road.roadGeoJSON(r, { m: carM ?? 0 }) as GeoJSON.FeatureCollection, [r, carM]);
  const progress = useMemo(() => {
    const m = carM ?? 0;
    const ahead = r.towns.filter((t) => t.m - m > 300);
    return { next: ahead[0] ?? null, passed: carM === null ? [] : r.towns.filter((t) => !ahead.includes(t)) };
  }, [r, carM]);
  // Before the car leaves no town is "next" yet (the garage is).
  const chips = useMemo(() => (mode === 'window' ? [] : roadChips(r, startName, carM === null ? null : progress.next, progress.passed)), [mode, r, startName, carM, progress]);
  const car = carM === null ? null : pointAt(r, carM);
  const nextAt = progress.next ? (progress.next.kind === 'city' ? r.path[r.path.length - 1]! : progress.next.at) : null;

  const move = (how: 'jump' | 'glide' | 'ease') => {
    const cam = camera.current;
    if (!cam || !size.w) return;
    const jump = how === 'jump' || theme.reduceMotion || lite;
    const duration = jump ? 0 : how === 'glide' ? GLIDE_MS : STRIP_EASE_MS;
    if (mode === 'window') {
      const at = carM ?? 0;
      cam.easeTo({ center: pointAt(r, at), zoom: WINDOW.zoom, pitch: WINDOW.pitch, bearing: bearingAhead(r, at), padding: { top: Math.round(size.h * 0.42), bottom: bottomInset + 24, left: 0, right: 0 }, duration });
      return;
    }
    const box = mode === 'strip' ? stripBounds(r, carM) : road.roadBounds(r);
    const padding = mode === 'strip' ? { top: 20, bottom: 20, left: 28, right: 28 } : { top: topInset + 40, bottom: bottomInset + 28, left: 56, right: 56 };
    const fit = golden.fitCamera([box[0], box[1]], { width: size.w, height: size.h, padding, maxZoom: 13 });
    cam.easeTo({ center: fit.center, zoom: fit.zoom, pitch: 0, bearing: 0, duration });
  };

  // First frame: a jump to the view. A new view (A ⇄ B): one glide.
  const shownMode = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !size.w) return;
    move(shownMode.current === null ? 'jump' : 'glide');
    shownMode.current = mode;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, size.w, size.h, mode]);

  // A new fix: the strip eases along, the window seat glides once per town passed and steps otherwise.
  const lastPassed = useRef(progress.passed.length);
  useEffect(() => {
    if (!ready || !shownMode.current) return;
    if (mode === 'strip') move('ease');
    else if (mode === 'window') move(progress.passed.length !== lastPassed.current ? 'glide' : 'jump');
    lastPassed.current = progress.passed.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carM]);

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const touch = mode === 'whole';

  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }]} onLayout={onLayout} testID={testID ?? 'road-map'} accessibilityLabel={accessibilityLabel}>
      <ml.Map
        style={StyleSheet.absoluteFill}
        mapStyle={style}
        attribution={false}
        logo={false}
        compass={false}
        dragPan={touch}
        touchZoom={touch}
        doubleTapZoom={touch}
        touchRotate={false}
        touchPitch={false}
        onDidFinishLoadingMap={() => setReady(true)}
        onDidFailLoadingMap={onFail}
      >
        <ml.Camera ref={camera} maxZoom={17} initialViewState={{ bounds: [...road.roadBounds(r)[0], ...road.roadBounds(r)[1]] as [number, number, number, number] }} />
        <ml.Images images={images} />
        <ml.GeoJSONSource id={SOURCE} data={data}>
          {layers.map((l) => (
            <ml.Layer key={l.id} {...({ ...l, beforeId: golden.GOLDEN_FIRST_LABEL } as unknown as LayerProps)} />
          ))}
        </ml.GeoJSONSource>
        {chips.map((c) => (
          <ml.Marker key={c.id} id={`road-${c.id}`} lngLat={c.at} anchor={c.side === 'left' ? 'right' : 'left'} offset={[c.side === 'left' ? -10 : 10, 0]}>
            <TownChip name={c.name} tone={c.tone} />
          </ml.Marker>
        ))}
        {car && mode === 'whole' && carTag ? (
          <ml.Marker id="road-car-tag" lngLat={car} anchor="right" offset={[-30, 0]}>
            <CarTag top={carTag.top} bottom={carTag.bottom} />
          </ml.Marker>
        ) : null}
        {car ? (
          <ml.Marker id="road-car" lngLat={car} anchor="center">
            <CarPin initial={initial} size={mode === 'strip' ? 36 : 48} />
          </ml.Marker>
        ) : null}
        {mode === 'window' && horizon && nextAt ? (
          <ml.Marker id="road-horizon" lngLat={nextAt} anchor="bottom" offset={[0, -10]}>
            <HorizonCard eyebrow={horizon.eyebrow} title={horizon.title} />
          </ml.Marker>
        ) : null}
      </ml.Map>
    </View>
  );
}
