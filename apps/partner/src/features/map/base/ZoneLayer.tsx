import { memo, useMemo } from 'react';
import { Platform, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { G, Path, Text as SvgText } from 'react-native-svg';
import { buildZoneCentroidsGeoJSON, buildZonesGeoJSON, MAP_COLORS_LIGHT } from '@driver/map';
import { layerTransform, pathD, project, type Camera, type Size } from '../geo';
import { toWesternDigits } from '@/lib/phone';
import type { CameraValues } from './types';

const ZONES = buildZonesGeoJSON();
const CENTROIDS = buildZoneCentroidsGeoJSON();
const LABEL_FONT = Platform.OS === 'web' ? 'IBM Plex Sans Arabic, sans-serif' : 'IBMPlexSansArabic_500Medium';

export interface ZoneLayerProps {
  drawn: Camera;
  cam: CameraValues;
  size: Size;
  /** Tier-tinted neighbourhood shapes (off over MapLibre, which draws its own). */
  fills?: boolean;
  /** Arabic neighbourhood names (MapLibre has no glyphs until the PMTiles basemap ships). */
  labels?: boolean;
  /** 0 hides the layer (labels while MapLibre is mid-pinch). */
  opacity?: SharedValue<number>;
}

/**
 * The 34 Aziziyah zones drawn in SVG for the camera `drawn`, carried to the live camera with one
 * transform on the UI thread (pan, zoom, follow animations), and redrawn crisp when the camera
 * settles. The map's floor when there are no tiles: the sandbox, a dead network, native without
 * MapLibre.
 */
export const ZoneLayer = memo(function ZoneLayer({ drawn, cam, size, fills = true, labels = true, opacity }: ZoneLayerProps) {
  const shapes = useMemo(
    () =>
      ZONES.features.map((f) => ({
        id: f.properties.id,
        color: f.properties.color,
        d: pathD(f.geometry.coordinates[0]!.map(([lng, lat]) => project(lat!, lng!, drawn, size))) + 'Z',
      })),
    [drawn, size],
  );
  const names = useMemo(
    () =>
      labels && drawn.zoom >= 13.5
        ? CENTROIDS.features.map((f) => {
            const [lng, lat] = f.geometry.coordinates as [number, number];
            return { id: f.properties.id, name: toWesternDigits(f.properties.name_ar), ...project(lat, lng, drawn, size) };
          })
        : [],
    [drawn, size, labels],
  );

  const style = useAnimatedStyle(() => {
    const live = { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value };
    const { tx, ty, s } = layerTransform(drawn, live, size);
    return { opacity: opacity ? opacity.value : 1, transform: [{ translateX: tx }, { translateY: ty }, { scale: s }] };
  }, [drawn, size]);

  if (size.w === 0) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width={size.w} height={size.h}>
        {fills ? (
          <G>
            {shapes.map((z) => (
              <Path key={z.id} d={z.d} fill={z.color} fillOpacity={0.13} stroke={z.color} strokeOpacity={0.55} strokeWidth={1.2} />
            ))}
          </G>
        ) : null}
        {/* Halo pass, then the text: paint-order is not supported everywhere. */}
        {[true, false].map((halo) =>
          names.map((n) => (
            <SvgText
              key={`${halo ? 'h' : 't'}-${n.id}`}
              x={n.x}
              y={n.y}
              fontSize={11}
              fontWeight="500"
              fontFamily={LABEL_FONT}
              fill={MAP_COLORS_LIGHT.muted}
              {...(halo ? { stroke: MAP_COLORS_LIGHT.labelHalo, strokeWidth: 3, strokeLinejoin: 'round' as const } : {})}
              textAnchor="middle"
            >
              {n.name}
            </SvgText>
          )),
        )}
      </Svg>
    </Animated.View>
  );
});
