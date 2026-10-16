import { memo, useMemo } from 'react';
import { Platform, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, G, Text as SvgText } from 'react-native-svg';
import { labelBox, LANDMARK_RULES, landmarkGlyph, landmarksVisible, placeLandmarks, type LabelObstacle } from '@driver/map';
import { GlyphShapes, useLiteMode } from '@driver/ui';
import { layerTransform, project, type Camera, type Size } from '../geo';
import type { CameraValues } from './types';
import { useMapColors } from './mapColors';
import { useLandmarks } from './useLandmarks';
import { useZoneNames } from './ZoneLayer';

const NO_OBSTACLES: readonly LabelObstacle[] = [];
const LABEL_FONT = Platform.OS === 'web' ? 'IBM Plex Sans Arabic, sans-serif' : 'IBMPlexSansArabic_500Medium';
const GLYPH_PX = 13;

export interface LandmarkLayerProps {
  drawn: Camera;
  cam: CameraValues;
  size: Size;
  /** Markers drawn over the map (pins, the courier, the centre pin): no landmark goes under them. */
  avoid?: readonly LabelObstacle[];
  /** 0 hides the layer (while MapLibre is mid-pinch, like the zone names). */
  opacity?: SharedValue<number>;
  /** Bands the screen covers with its own bars, px (top bar, sheet). */
  coveredTop?: number;
  coveredBottom?: number;
  /** Zoom names show from on this map (the job map: `LANDMARK_RULES.driverNameZoom`). */
  nameZoom?: number;
}

/**
 * Landmarks on the map (maps program b3): the mosque, the school, the market… as small badges with
 * their names when zoomed in, placed by `placeLandmarks` (zoom rules, lite mode, never under a pin or
 * a zone name). Drawn for the camera `drawn` and carried to the live camera on the UI thread like the
 * zone layer; under every pin, route and marker because the base map draws it. Decorative: hidden
 * from screen readers like the zone names (the pins carry the meaning).
 */
export const LandmarkLayer = memo(function LandmarkLayer({ drawn, cam, size, avoid = NO_OBSTACLES, opacity, coveredTop = 0, coveredBottom = 0, nameZoom }: LandmarkLayerProps) {
  const lite = useLiteMode();
  const lc = useMapColors().landmark;
  const landmarks = useLandmarks();
  const zoneNames = useZoneNames(drawn, size, avoid);
  const placed = useMemo(() => {
    if (landmarks.length === 0 || !landmarksVisible(drawn.zoom, lite)) return [];
    const bars = [
      { left: 0, right: size.w, top: 0, bottom: coveredTop },
      { left: 0, right: size.w, top: size.h - coveredBottom, bottom: size.h },
    ];
    return placeLandmarks(landmarks, { zoom: drawn.zoom, size, lite, obstacles: avoid, blocked: [...zoneNames.map((n) => labelBox(n)), ...bars], ...(nameZoom !== undefined ? { nameZoom } : {}), project: (p) => project(p.lat, p.lng, drawn, size) });
  }, [landmarks, drawn, size, lite, avoid, zoneNames, coveredTop, coveredBottom, nameZoom]);

  const style = useAnimatedStyle(() => {
    const live = { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value };
    const { tx, ty, s } = layerTransform(drawn, live, size);
    return { opacity: opacity ? opacity.value : 1, transform: [{ translateX: tx }, { translateY: ty }, { scale: s }] };
  }, [drawn, size]);

  if (size.w === 0 || placed.length === 0) return null;
  const r = LANDMARK_RULES.iconPx / 2;
  const nameY = (y: number) => y + r + LANDMARK_RULES.nameGapPx + LANDMARK_RULES.nameFontPx;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]} testID="landmark-layer">
      <Svg width={size.w} height={size.h}>
        {placed.map((l) => (
          <G key={l.id} testID={`landmark-${l.category}`}>
            <Circle cx={l.x} cy={l.y} r={r - 0.75} fill={lc.badgeFill} stroke={lc.badgeRing} strokeWidth={1.25} />
            <GlyphShapes shapes={landmarkGlyph(l.category)} x={l.x} y={l.y} size={GLYPH_PX} color={lc.glyph} strokeWidth={2.1} />
          </G>
        ))}
        {/* Halo pass, then the text: paint-order is not supported everywhere. */}
        {[true, false].map((halo) =>
          placed.map((l) =>
            l.name ? (
              <SvgText
                key={`${halo ? 'h' : 't'}-${l.id}`}
                x={l.x}
                y={nameY(l.y)}
                fontSize={LANDMARK_RULES.nameFontPx}
                fontWeight="500"
                fontFamily={LABEL_FONT}
                fill={lc.name}
                {...(halo ? { stroke: lc.halo, strokeWidth: 3, strokeLinejoin: 'round' as const } : {})}
                textAnchor="middle"
              >
                {l.name}
              </SvgText>
            ) : null,
          ),
        )}
      </Svg>
    </Animated.View>
  );
});
