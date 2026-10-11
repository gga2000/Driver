import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { CameraRef, LayerProps } from '@maplibre/maplibre-react-native';
import * as golden from '@driver/map/golden';
import * as pieces from '@driver/map/pieces/garage-seats';
import { Text, useTheme, withAlpha } from '@driver/ui';
import { nativeGolden, nativeGoldenImages, nativeGoldenStyle, nativeMapLibre } from '@/features/track/map/native-maplibre';
import { barLiftPx, garageCars, LOT_GLIDE_MS, lotCamera, spreadBays } from './garage-cars';
import type { GarageLotProps, LotCar } from './garage-lot-types';

/** Whether this build can draw the garage (a phone build with the native map and our map's files). */
export const GARAGE_LOT_MAP = nativeGolden();

const SOURCE = 'garage-seats';

/**
 * The garage on phones (MapLibre Native), as on the web (GarageLot.web.tsx): the 3D garage with a bar
 * of seats over each car, gold free and date brown taken. One ~3 s glide into the lot, then still;
 * reduce motion and lite jump. The bars stand at once here (no rise: cheaper on phones). A tap on a bar
 * or on a car's time chip (the map's own markers, ≥44 px) picks that car.
 */
export function GarageLot({ lotKey, garageId, departures, labelOf, selectedId, onSelect, topInset, bottomInset, lite, onFail, legend }: GarageLotProps) {
  const ml = nativeMapLibre()!;
  const theme = useTheme();
  const camera = useRef<CameraRef>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const light = useMemo(() => golden.resolveLight().light, []);
  const bays = pieces.GARAGE_BAYS[lotKey];
  const cam = useMemo(() => lotCamera(bays), [bays]);
  // The chips sit just over their car's bar once the camera has settled over the lot (it then holds still).
  const lift = cam && !lite ? Math.round(barLiftPx(cam.zoom, cam.pitch, cam.center[1])) : 0;
  const cars: LotCar[] = useMemo(
    () =>
      garageCars(departures, garageId, spreadBays(bays, departures.length)).map((c) => {
        const d = departures.find((x) => x.id === c.id)!;
        return { ...c, ...labelOf(d) };
      }),
    [bays, departures, garageId, labelOf],
  );
  const style = useMemo(() => {
    const s = nativeGoldenStyle(golden, light, lite ? 'lite' : 'customer');
    // Place names fight the seat bars and the chips; street names stay.
    const layers = s.layers.map((l) => (l.id === 'golden-places' ? { ...l, layout: { ...l.layout, visibility: 'none' } } : l));
    return { ...s, layers } as typeof s;
  }, [light, lite]);
  const images = useMemo(() => nativeGoldenImages(golden, light), [light]);
  const seats = useMemo(() => pieces.garageSeatsGeoJSON(cars) as GeoJSON.FeatureCollection, [cars]);
  const layers = useMemo(() => pieces.garageSeatLayers({ source: SOURCE, light }), [light]);
  const arrived = useRef(false);
  const live = useRef({ topInset, bottomInset, lite, reduce: theme.reduceMotion });
  live.current = { topInset, bottomInset, lite, reduce: theme.reduceMotion };

  const frame = (mode: 'arrive' | 'reframe') => {
    const s = live.current;
    if (!cam) return;
    const padding = { top: s.topInset + 16, bottom: s.bottomInset + 16, left: 24, right: 24 };
    const at = { center: cam.center, zoom: cam.zoom, bearing: cam.bearing, pitch: s.lite ? 0 : cam.pitch, padding };
    if (s.lite || s.reduce) {
      camera.current?.jumpTo(at);
      return;
    }
    if (mode === 'reframe') {
      camera.current?.easeTo({ ...at, duration: 450, easing: 'ease' });
      return;
    }
    // From a little out over the town, one glide in, then still.
    camera.current?.jumpTo({ center: cam.center, zoom: cam.zoom - 1.6, bearing: cam.bearing - 35, pitch: 35, padding });
    camera.current?.easeTo({ ...at, duration: LOT_GLIDE_MS, easing: 'ease' });
  };

  useEffect(() => {
    if (!ready || !size.w || arrived.current) return;
    arrived.current = true;
    frame('arrive');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, size.w]);

  // The bottom card came up or went: keep the lot in the space left.
  const lastBottom = useRef(bottomInset);
  useEffect(() => {
    if (!arrived.current || Math.abs(lastBottom.current - bottomInset) < 24) return;
    lastBottom.current = bottomInset;
    frame('reframe');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomInset]);

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <>
      <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: theme.colors.bg }]} onLayout={onLayout} testID="garage-lot-map">
        <ml.Map
          style={StyleSheet.absoluteFill}
          mapStyle={style}
          attribution={false}
          logo={false}
          compass={false}
          onDidFinishLoadingMap={() => setReady(true)}
          onDidFailLoadingMap={onFail}
          onPress={() => onSelect(null)}
        >
          <ml.Camera ref={camera} maxZoom={20} initialViewState={cam ? { center: cam.center, zoom: cam.zoom - 1.6 } : { zoom: 15 }} />
          <ml.Images images={images} />
          <ml.GeoJSONSource
            id={SOURCE}
            data={seats}
            onPress={(e) => {
              e.stopPropagation();
              const id = e.nativeEvent.features[0]?.properties?.car;
              if (typeof id === 'string') onSelect(id);
            }}
          >
            {layers.map((l) => (
              <ml.Layer key={l.id} {...({ ...l, beforeId: golden.GOLDEN_FIRST_LABEL } as unknown as LayerProps)} />
            ))}
          </ml.GeoJSONSource>
          {cars.map((c) => {
            const on = c.id === selectedId;
            return (
              <ml.Marker key={c.id} id={`car-${c.id}`} lngLat={c.at} anchor="bottom" offset={[0, -lift]}>
                <Pressable
                  onPress={() => onSelect(c.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={c.a11y}
                  testID={`garage-car-pin-${c.id}`}
                  style={styles.chip}
                >
                  <View
                    style={{
                      paddingHorizontal: theme.space[2],
                      paddingVertical: 3,
                      borderRadius: theme.radius.pill,
                      borderWidth: 2,
                      borderColor: on ? theme.colors.text : withAlpha(theme.colors.text, 0.15),
                      backgroundColor: on ? theme.colors.accent : withAlpha(theme.colors.surface, 0.95),
                    }}
                  >
                    <Text variant="caption" weight={700} numberOfLines={1}>
                      {c.label}
                    </Text>
                  </View>
                </Pressable>
              </ml.Marker>
            );
          })}
        </ml.Map>
      </View>
      {legend ? legend(pieces.garageSeatColours(light)) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // Min 44 px tap target around the small time chip.
  chip: { alignItems: 'center', justifyContent: 'flex-end', minWidth: 44, minHeight: 44, paddingBottom: 2 },
});
