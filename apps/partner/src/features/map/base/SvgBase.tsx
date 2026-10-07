import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import { MAP_COLORS_LIGHT } from '@driver/map';
import { clamp, mercX, mercY, TILE_SIZE } from '../geo';
import { LandmarkLayer } from './LandmarkLayer';
import type { BaseMapProps } from './types';
import { ZoneLayer } from './ZoneLayer';

/**
 * Tile-free base map: cream ground plus the zone layer and the landmarks (maps b3), with pan and pinch. Used on native until
 * `@maplibre/maplibre-react-native` is in a dev-client build, and on the web when WebGL is missing.
 */
export function SvgBase({ drawn, cam, size, onUserGestureStart, onUserCamera, labelAvoid, coveredTop, coveredBottom }: BaseMapProps) {
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startZoom = useSharedValue(0);

  const commit = () => {
    'worklet';
    runOnJS(onUserCamera)({ lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value });
  };

  const setCentre = (x: number, y: number, zoom: number) => {
    'worklet';
    const scale = TILE_SIZE * Math.pow(2, zoom);
    cam.lng.value = (x / scale) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / scale;
    cam.lat.value = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  };

  const pan = Gesture.Pan()
    .minDistance(4)
    .onStart(() => {
      startX.value = mercX(cam.lng.value, cam.zoom.value);
      startY.value = mercY(cam.lat.value, cam.zoom.value);
      runOnJS(onUserGestureStart)();
    })
    .onUpdate((e) => {
      setCentre(startX.value - e.translationX, startY.value - e.translationY, cam.zoom.value);
    })
    .onEnd(commit);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startZoom.value = cam.zoom.value;
      runOnJS(onUserGestureStart)();
    })
    .onUpdate((e) => {
      cam.zoom.value = clamp(startZoom.value + Math.log2(Math.max(0.05, e.scale)), 11, 18);
    })
    .onEnd(commit);

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: MAP_COLORS_LIGHT.background }]}>
        <ZoneLayer drawn={drawn} cam={cam} size={size} {...(labelAvoid ? { avoid: labelAvoid } : {})} />
        <LandmarkLayer drawn={drawn} cam={cam} size={size} coveredTop={coveredTop ?? 0} coveredBottom={coveredBottom ?? 0} {...(labelAvoid ? { avoid: labelAvoid } : {})} />
      </View>
    </GestureDetector>
  );
}
