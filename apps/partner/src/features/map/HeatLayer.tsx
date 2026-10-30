import { memo, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import type { DemandLevel } from '@driver/contracts';
import type { DemandCell } from '@driver/map/pieces/demand';
import { buildPlacedZonesGeoJSON, buildZonesGeoJSON } from '@driver/map';
import { useTheme } from '@driver/ui';
import type { CameraValues } from './base/types';
import { layerTransform, pathD, project, type Camera, type Size } from './geo';
import { useZoneMap } from './base/useZoneMap';

const ZONES = buildZonesGeoJSON();
const FILL: Record<DemandLevel, number> = { hot: 0.36, warm: 0.16, calm: 0 };

type HeatZone = { zoneId: string; level: DemandLevel; forYou?: boolean };

/** How bright each zone glows inside the map (N17): his own strongest, then busy, then some work. */
const GLOW_WEIGHT: Record<DemandLevel, number> = { hot: 0.75, warm: 0.4, calm: 0 };

function usePlacedZones() {
  const liveZones = useZoneMap();
  return useMemo(() => (liveZones.data ? buildPlacedZonesGeoJSON(liveZones.data) : ZONES), [liveZones.data]);
}

/** The busy zones as glow cells at their middles, for a map that draws the glow itself (MapLibre). */
export function useGlowCells(zones: ReadonlyArray<HeatZone> | undefined): DemandCell[] {
  const geometry = usePlacedZones();
  return useMemo(() => {
    if (!zones || zones.length === 0) return [];
    const byId = new Map(geometry.features.map((f) => [f.properties.id, f.geometry.coordinates[0]!]));
    return zones.flatMap((z) => {
      const ring = byId.get(z.zoneId);
      const weight = z.forYou ? 1 : GLOW_WEIGHT[z.level];
      if (!ring || weight === 0) return [];
      // The ring repeats its first corner at the end: average the corners once.
      const pts = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1] ? ring.slice(0, -1) : ring;
      const lng = pts.reduce((a, p) => a + p[0]!, 0) / pts.length;
      const lat = pts.reduce((a, p) => a + p[1]!, 0) / pts.length;
      return [{ at: [lng, lat] as [number, number], weight }];
    });
  }, [zones, geometry]);
}

/**
 * Where the orders are (maps program d5, N17): busy zones filled in the accent — strong for the one
 * picked for him, light where there is some — drawn for the settled camera and carried to the live
 * one with a single transform, like the zone layer under it. A new picture cross-fades in (`at`); no
 * pulse, and reduce motion swaps it at once. When the map itself glows (`outline`), only his zone's edge is
 * drawn here.
 */
export const HeatLayer = memo(function HeatLayer({ drawn, cam, size, zones, at = 0, outline = false, strength = 1 }: { drawn: Camera; cam: CameraValues; size: Size; zones: ReadonlyArray<HeatZone>; at?: number; outline?: boolean; strength?: number }) {
  const theme = useTheme();
  const geometry = usePlacedZones();
  const level = useMemo(() => new Map(zones.map((z) => [z.zoneId, z.level])), [zones]);
  const mine = zones.find((z) => z.forYou)?.zoneId ?? null;
  const shapes = useMemo(
    () =>
      geometry.features
        .filter((f) => (outline ? f.properties.id === mine : (FILL[level.get(f.properties.id) ?? 'calm'] ?? 0) > 0))
        .map((f) => ({
          id: f.properties.id,
          level: level.get(f.properties.id) ?? 'calm',
          d: pathD(f.geometry.coordinates[0]!.map(([lng, lat]) => project(lat!, lng!, drawn, size))) + 'Z',
        })),
    [drawn, size, level, geometry, outline, mine],
  );
  const style = useAnimatedStyle(() => {
    const { tx, ty, s } = layerTransform(drawn, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size);
    return { transform: [{ translateX: tx }, { translateY: ty }, { scale: s }] };
  }, [drawn, size]);
  if (size.w === 0 || shapes.length === 0) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]} testID="heat-layer">
      <Animated.View key={at} style={StyleSheet.absoluteFill} entering={theme.reduceMotion ? undefined : FadeIn.duration(900)} exiting={theme.reduceMotion ? undefined : FadeOut.duration(900)}>
        <Svg width={size.w} height={size.h}>
          {shapes.map((z) => (
            <Path
              key={z.id}
              testID={z.id === mine ? `heat-${z.id}-mine` : `heat-${z.id}`}
              d={z.d}
              fill={theme.colors.accent}
              fillOpacity={outline ? 0 : FILL[z.level] * strength}
              stroke={theme.colors.accent}
              strokeOpacity={(z.level === 'hot' ? 0.9 : 0.5) * Math.max(0.4, strength)}
              strokeWidth={z.id === mine ? (strength < 1 ? 2 : 3) : z.level === 'hot' ? 2 : 1.2}
            />
          ))}
        </Svg>
      </Animated.View>
    </Animated.View>
  );
});
