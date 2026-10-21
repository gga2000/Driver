import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { runOnJS, useAnimatedReaction, useSharedValue } from 'react-native-reanimated';
import type { CameraRef, LayerProps, MapRef, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import * as golden from '@driver/map/golden';
import { MAP_COLORS_LIGHT } from '@driver/map';
import { WINDOW_SOURCE } from '@driver/map/pieces/windows';
import { useLiteMode } from '@driver/ui';
import { LIGHT_CHECK_MS } from './golden-setup';
import { WINDOW_TOLERANCE } from './house-windows';
import { LandmarkLayer } from './LandmarkLayer';
import { nativeGolden, nativeGoldenImages, nativeGoldenStyle, nativeMapLibre } from './native-maplibre';
import { SvgBase } from './SvgBase';
import type { BaseMapProps } from './types';
import { useHouseWindows } from './useHouseWindows';
import { useZoneShapes } from './ZoneLayer';

/**
 * Phones: the Golden hour map through MapLibre Native when the build has it and the map's files are
 * set up; else (Expo Go, low-data mode, the map failing) the drawn town. The overlay (courier, route,
 * pins) is drawn by the screen from the same camera values either way.
 */
export function BaseMap(props: BaseMapProps) {
  const [failed, setFailed] = useState(false);
  const lite = useLiteMode();
  if (failed || lite || !nativeGolden()) return <SvgBase {...props} />;
  return <NativeBase {...props} onFail={() => setFailed(true)} />;
}

export const BASE_MAP_KIND: 'svg' | 'maplibre' = nativeGolden() ? 'maplibre' : 'svg';

/**
 * The camera lives in the shared values (`cam`): when they move (a follow animation, a recentre) the
 * map jumps to them; while the person drags or pinches the map leads and writes them instead, so the
 * overlay drawn from the same values stays on the streets.
 */
function NativeBase({ drawn, cam, size, onUserGestureStart, onUserCamera, labelAvoid, coveredTop, coveredBottom, alwaysDay, onRoads, onFail }: BaseMapProps & { onFail: () => void }) {
  const ml = nativeMapLibre()!;
  const camera = useRef<CameraRef>(null);
  const map = useRef<MapRef>(null);
  const driving = useRef(false);
  const labels = useSharedValue(1);
  const [light, setLight] = useState(() => golden.resolveLight(alwaysDay ? { light: 'day' } : {}).light);
  // The Console's neighbourhoods: edges and one painted name each, as data in the style (#339). Pin pickers
  // (`alwaysDay`) keep the edges but no names: one would sit under the pin, and the sheet says «المنطقة: …».
  const { zones, centroids } = useZoneShapes();
  const style = useMemo(() => {
    const s = nativeGoldenStyle(golden, light, 'customer', { zoneNames: !alwaysDay });
    const fill = (id: string, data: GeoJSON.FeatureCollection) => (s.sources[id] ? { [id]: { ...s.sources[id], data } } : {});
    return { ...s, sources: { ...s.sources, ...fill(golden.GOLDEN_ZONES_SOURCE, zones), ...fill(golden.GOLDEN_ZONE_NAMES_SOURCE, centroids) } } as typeof s;
  }, [light, zones, centroids, alwaysDay]);
  const images = useMemo(() => nativeGoldenImages(golden, light), [light]);
  const windows = useHouseWindows(map, light);
  const roadLayers = useMemo(() => style.layers.filter((l) => 'source-layer' in l && l['source-layer'] === 'roads').map((l) => l.id), [style]);
  /** The streets on screen once the map settles, for a screen that asked. */
  const readRoads = () => {
    if (!onRoads || !roadLayers.length) return;
    void map.current
      ?.queryRenderedFeatures({ layers: roadLayers })
      .then((fs) => onRoads(golden.roadsFromFeatures(fs)))
      .catch(() => undefined);
  };

  // The light changes a few times a day; the pin pickers stay on the day map.
  useEffect(() => {
    if (alwaysDay) return;
    const id = setInterval(() => setLight(golden.resolveLight().light), LIGHT_CHECK_MS);
    return () => clearInterval(id);
  }, [alwaysDay]);

  const jump = (lng: number, lat: number, zoom: number) => {
    if (!driving.current) camera.current?.jumpTo({ center: [lng, lat], zoom });
  };
  useAnimatedReaction(
    () => [cam.lng.value, cam.lat.value, cam.zoom.value] as const,
    (now, before) => {
      if (before && now[0] === before[0] && now[1] === before[1] && now[2] === before[2]) return;
      runOnJS(jump)(now[0], now[1], now[2]);
    },
  );

  const follow = (e: { nativeEvent: ViewStateChangeEvent }) => {
    const v = e.nativeEvent;
    if (!v.userInteraction) return;
    if (!driving.current) {
      driving.current = true;
      labels.value = 0;
      onUserGestureStart();
    }
    cam.lng.value = v.center[0];
    cam.lat.value = v.center[1];
    cam.zoom.value = v.zoom;
  };
  const settle = (e: { nativeEvent: ViewStateChangeEvent }) => {
    readRoads();
    windows.dress();
    if (!driving.current) return;
    driving.current = false;
    labels.value = 1;
    const v = e.nativeEvent;
    onUserCamera({ lng: v.center[0], lat: v.center[1], zoom: v.zoom });
  };

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: MAP_COLORS_LIGHT.background }]}>
      <ml.Map
        ref={map}
        style={StyleSheet.absoluteFill}
        mapStyle={style}
        attribution={false}
        logo={false}
        compass={false}
        touchRotate={false}
        touchPitch={false}
        onRegionIsChanging={follow}
        onRegionDidChange={settle}
        onDidFailLoadingMap={onFail}
        onDidFinishRenderingMapFully={() => {
          readRoads();
          windows.dress();
        }}
      >
        <ml.Camera ref={camera} initialViewState={{ center: [cam.lng.value, cam.lat.value], zoom: cam.zoom.value }} />
        <ml.Images images={images} />
        {/* Windows, doors and roof walls on the houses up close (from z17). */}
        <ml.GeoJSONSource id={WINDOW_SOURCE} data={windows.data} tolerance={WINDOW_TOLERANCE}>
          {windows.layers.map((l) => (
            <ml.Layer key={l.id} {...({ ...l, beforeId: golden.GOLDEN_FIRST_LABEL } as unknown as LayerProps)} />
          ))}
        </ml.GeoJSONSource>
      </ml.Map>
      {/* Landmarks over the tiles and under every pin the screen draws, as on the web (our map paints the neighbourhood names). */}
      <LandmarkLayer drawn={drawn} cam={cam} size={size} opacity={labels} coveredTop={coveredTop ?? 0} coveredBottom={coveredBottom ?? 0} {...(labelAvoid ? { avoid: labelAvoid } : {})} />
    </View>
  );
}
