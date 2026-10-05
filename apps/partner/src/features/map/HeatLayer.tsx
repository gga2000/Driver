import { memo, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import type { DemandLevel } from '@driver/contracts';
import { buildZonesGeoJSON } from '@driver/map';
import { useTheme } from '@driver/ui';
import type { CameraValues } from './base/types';
import { layerTransform, pathD, project, type Camera, type Size } from './geo';

const ZONES = buildZonesGeoJSON();
const FILL: Record<DemandLevel, number> = { hot: 0.36, warm: 0.16, calm: 0 };

/**
 * Where the orders are (maps program d5): busy zones filled in the accent — strong where there is more
 * work than drivers, light where there is some — drawn for the settled camera and carried to the live
 * one with a single transform, like the zone layer under it.
 */
export const HeatLayer = memo(function HeatLayer({ drawn, cam, size, zones }: { drawn: Camera; cam: CameraValues; size: Size; zones: ReadonlyArray<{ zoneId: string; level: DemandLevel }> }) {
  const theme = useTheme();
  const level = useMemo(() => new Map(zones.map((z) => [z.zoneId, z.level])), [zones]);
  const shapes = useMemo(
    () =>
      ZONES.features
        .filter((f) => (FILL[level.get(f.properties.id) ?? 'calm'] ?? 0) > 0)
        .map((f) => ({
          id: f.properties.id,
          level: level.get(f.properties.id) ?? 'calm',
          d: pathD(f.geometry.coordinates[0]!.map(([lng, lat]) => project(lat!, lng!, drawn, size))) + 'Z',
        })),
    [drawn, size, level],
  );
  const style = useAnimatedStyle(() => {
    const { tx, ty, s } = layerTransform(drawn, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size);
    return { transform: [{ translateX: tx }, { translateY: ty }, { scale: s }] };
  }, [drawn, size]);
  if (size.w === 0 || shapes.length === 0) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]} testID="heat-layer">
      <Svg width={size.w} height={size.h}>
        {shapes.map((z) => (
          <Path key={z.id} testID={`heat-${z.id}`} d={z.d} fill={theme.colors.accent} fillOpacity={FILL[z.level]} stroke={theme.colors.accent} strokeOpacity={z.level === 'hot' ? 0.9 : 0.5} strokeWidth={z.level === 'hot' ? 2 : 1.2} />
        ))}
      </Svg>
    </Animated.View>
  );
});
