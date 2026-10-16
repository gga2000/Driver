import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { Text, useTheme } from '@driver/ui';
import type { CameraValues } from './base/types';
import { closedColours, LABEL_PILL_H, labelBeside, type ClosedGeoJSON } from './closed';
import { layerTransform, pathD, project, type Camera, type LngLat, type Point, type Size } from './geo';

const LABEL_W = 120;
const LABEL_H = LABEL_PILL_H;
/**
 * N20: the closed streets drawn by the screen when the map can't draw them itself (native, low-data mode,
 * no WebGL; on MapLibre without glyphs only the label). Rust and cream stripes with a barrier at each end
 * and «مسدود» mid-stretch, as the map piece draws them, over the busy zones and under the road, the pins
 * and him. Drawn for the settled camera and carried to the live one with one transform, like the heat
 * layer. Nothing moves.
 */
export const ClosureLayer = memo(function ClosureLayer({ drawn, cam, size, data, lines, labels, road = [] }: { drawn: Camera; cam: CameraValues; size: Size; data: ClosedGeoJSON; lines: boolean; labels: boolean; road?: readonly LngLat[] }) {
  const theme = useTheme();
  const c = useMemo(() => closedColours(theme.scheme === 'dark'), [theme.scheme]);
  const shapes = useMemo(() => {
    const at = ([lng, lat]: readonly number[]) => project(lat!, lng!, drawn, size);
    const roadPx = road.map((p) => project(p.lat, p.lng, drawn, size));
    const stretchOf = new Map<string, Point[]>();
    for (const f of data.features) if (f.properties.part === 'closed' && f.geometry.type === 'LineString') stretchOf.set(f.properties.id ?? '', f.geometry.coordinates.map(at));
    const out = { closed: [] as string[], bars: [] as string[], ends: [] as { x: number; y: number }[], labels: [] as { x: number; y: number; text: string; key: string }[] };
    data.features.forEach((f, i) => {
      const part = f.properties.part;
      if (f.geometry.type === 'LineString') {
        const d = pathD(f.geometry.coordinates.map(at));
        if (part === 'closed') out.closed.push(d);
        else if (part === 'bar') out.bars.push(d);
      } else if (part === 'end') out.ends.push(at(f.geometry.coordinates));
      else if (part === 'label') {
        const mid = at(f.geometry.coordinates);
        const line = stretchOf.get(f.properties.id ?? '') ?? [mid];
        out.labels.push({ ...labelBeside(mid, line[0]!, line[line.length - 1]!, roadPx), text: f.properties.label ?? '', key: `${f.properties.id}-${i}` });
      }
    });
    return out;
  }, [data, drawn, size, road]);
  const style = useAnimatedStyle(() => {
    const { tx, ty, s } = layerTransform(drawn, { lng: cam.lng.value, lat: cam.lat.value, zoom: cam.zoom.value }, size);
    return { transform: [{ translateX: tx }, { translateY: ty }, { scale: s }] };
  }, [drawn, size]);
  if (size.w === 0 || data.features.length === 0 || (!lines && !labels)) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]} testID="closure-layer">
      {lines ? (
        <Svg width={size.w} height={size.h}>
          {shapes.closed.map((d, i) => (
            <G key={`c${i}`}>
              <Path d={d} stroke={c.rust} strokeWidth={10} strokeLinejoin="round" fill="none" />
              <Path d={d} stroke={c.cream} strokeWidth={6} strokeDasharray="5 5" strokeLinejoin="round" fill="none" />
            </G>
          ))}
          {shapes.bars.map((d, i) => (
            <G key={`b${i}`}>
              <Path d={d} stroke={c.rust} strokeWidth={7} strokeLinecap="round" fill="none" />
              <Path d={d} stroke={c.cream} strokeWidth={3.5} strokeDasharray="4 4" fill="none" />
            </G>
          ))}
          {shapes.ends.map((p, i) => (
            <Circle key={`e${i}`} cx={p.x} cy={p.y} r={4.5} fill={c.cream} stroke={c.rust} strokeWidth={2.5} />
          ))}
        </Svg>
      ) : null}
      {labels
        ? shapes.labels.map((l) => (
            <View key={l.key} testID="closure-label" style={[styles.label, { left: l.x - LABEL_W / 2, top: l.y - LABEL_H / 2 }]}>
              <View style={{ paddingHorizontal: 8, borderRadius: LABEL_H / 2, backgroundColor: c.halo, borderWidth: 1.5, borderColor: c.rust }}>
                <Text variant="caption" weight={700} numberOfLines={1} style={{ color: c.ink, lineHeight: LABEL_H - 3 }}>
                  {l.text}
                </Text>
              </View>
            </View>
          ))
        : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({ label: { position: 'absolute', width: LABEL_W, height: LABEL_H, alignItems: 'center', justifyContent: 'center' } });
