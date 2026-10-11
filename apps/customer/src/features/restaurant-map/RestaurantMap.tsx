import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { CameraRef, LayerProps, MapRef } from '@maplibre/maplibre-react-native';
import * as golden from '@driver/map/golden';
import { Icon, Text, useTheme, withAlpha } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { nativeGolden, nativeGoldenImages, nativeGoldenStyle, nativeMapLibre } from '@/features/track/map/native-maplibre';
import type { MapShop } from './shops';

type Pt = [number, number];

export interface RestaurantMapProps {
  shops: MapShop[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Screen space the top bar and the brief cover, so the camera frames the shop in what is left. */
  topInset: number;
  bottomInset: number;
  /** Cheap phones and low-data mode: the flat map, no 3D shops, no flights. */
  lite: boolean;
  /** Our map file failed: the screen shows the list instead. */
  onFail: () => void;
}

/** Whether this build can draw the restaurant map (a phone build with the native map and our map's files). */
export const RESTAURANT_MAP = nativeGolden();

const PIN = 36;

/**
 * The restaurant map on phones (MapLibre Native), the same Lantern tour as the web
 * (RestaurantMap.web.tsx): every restaurant as its own 3D shop with a pin over it; tapping one flies to
 * its front (one flight, one slow quarter-turn, then still) and lights it. Reduce motion jumps.
 * Pins are the map's own markers. The houses facing a chosen shop stay up on phones (the web lays them flat).
 */
export function RestaurantMap({ shops, selectedId, onSelect, topInset, bottomInset, lite, onFail }: RestaurantMapProps) {
  const ml = nativeMapLibre()!;
  const theme = useTheme();
  const t = useT();
  const map = useRef<MapRef>(null);
  const camera = useRef<CameraRef>(null);
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [facing, setFacing] = useState<Record<string, number>>({});
  const light = useMemo(() => golden.resolveLight().light, []);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const list = useMemo(
    () => shops.map((x) => ({ id: x.id, at: x.at, facing: facing[x.id], kind: golden.restaurantKindOf([x.card.cuisine, ...x.card.tags]) })),
    [shops, facing],
  );
  // The base style, with no house standing where a shop does (set once per set of shops: a new style reloads the map).
  const shopKey = shops.map((s) => s.id).join(',');
  const style = useMemo(() => {
    const s = nativeGoldenStyle(golden, light, lite ? 'lite' : 'customer');
    const hide = golden.restaurantHouseFilter(list.map(({ id, at }) => ({ id, at })), null);
    const hidden: ReadonlySet<string> = new Set(golden.RESTAURANT_HIDES_HOUSE_LAYERS);
    const layers = s.layers.map((l) => {
      // Place names fight the shops' signs and the pins; street names stay.
      if (l.id === 'golden-places') return { ...l, layout: { ...l.layout, visibility: 'none' } };
      if (!hidden.has(l.id) || !('filter' in l || 'source' in l)) return l;
      const own = 'filter' in l ? l.filter : undefined;
      return { ...l, filter: own ? ['all', own, hide] : hide };
    });
    return { ...s, layers } as typeof s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [light, lite, shopKey]);
  const images = useMemo(() => nativeGoldenImages(golden, light), [light]);
  const scene = useMemo(() => golden.restaurantScene(list, { light, selectedId }), [list, light, selectedId]);
  const layers = useMemo(() => golden.restaurantLayers(light), [light]);
  const roadLayers = useMemo(() => style.layers.filter((l) => 'source-layer' in l && l['source-layer'] === 'roads').map((l) => l.id), [style]);

  const live = useRef({ shops, selectedId, topInset, bottomInset, lite, size, facing, reduce: theme.reduceMotion });
  live.current = { shops, selectedId, topInset, bottomInset, lite, size, facing, reduce: theme.reduceMotion };

  /** Turns each shop on screen to its street once the streets around it have drawn. */
  const faceStreets = () => {
    if (lite || !roadLayers.length) return;
    void map.current
      ?.queryRenderedFeatures({ layers: roadLayers })
      .then((fs) => {
        const roads: { cls: string; coords: Pt[] }[] = [];
        for (const f of fs) {
          const cls = String(f.properties?.cls ?? '');
          const g = f.geometry;
          if (g.type === 'LineString') roads.push({ cls, coords: g.coordinates as Pt[] });
          else if (g.type === 'MultiLineString') for (const line of g.coordinates) roads.push({ cls, coords: line as Pt[] });
        }
        if (!roads.length) return;
        const known = live.current.facing;
        const next: Record<string, number> = {};
        for (const s of live.current.shops) if (known[s.id] === undefined) next[s.id] = golden.faceRoad(s.at, roads);
        if (Object.keys(next).length) setFacing((f) => ({ ...f, ...next }));
      })
      .catch(() => undefined);
  };

  /** The camera for the current choice: fly in to the shop, or back out over the town. */
  const frame = (animate: boolean) => {
    const s = live.current;
    if (!s.size.w) return;
    clearTimeout(settleTimer.current);
    const padding = { top: s.topInset + 24, bottom: s.bottomInset + 24, left: 32, right: 32 };
    const quiet = !animate || s.reduce || s.lite;
    const shop = s.shops.find((x) => x.id === s.selectedId);
    if (!shop) {
      const over = golden.restaurantOverview(s.shops);
      if (!over) return;
      const bearing = s.lite ? 0 : over.bearing;
      // Wider at the sides than the shops need: the names under the pins hang ~75 px each way.
      const fit = golden.fitCamera(over.bounds, { width: s.size.w, height: s.size.h, padding: { ...padding, left: 80, right: 80 }, bearing, maxZoom: over.maxZoom });
      const cam = { center: fit.center, zoom: fit.zoom, bearing, pitch: s.lite ? 0 : over.pitch };
      if (quiet) camera.current?.jumpTo(cam);
      else camera.current?.easeTo({ ...cam, duration: 1600, easing: 'ease' });
      return;
    }
    const at = { at: shop.at, facing: s.facing[shop.id] };
    const cam = golden.restaurantFocusCamera(at);
    if (s.lite) {
      camera.current?.jumpTo({ center: cam.center, zoom: 18, pitch: 0, bearing: 0, padding });
      return;
    }
    if (quiet) {
      camera.current?.jumpTo({ ...cam, padding });
      return;
    }
    camera.current?.flyTo({ ...cam, padding, duration: golden.RESTAURANT_FLY_MS, easing: 'fly' });
    // Once it lands: one slow turn round the shop, then still.
    const id = shop.id;
    settleTimer.current = setTimeout(() => {
      if (live.current.selectedId !== id || live.current.reduce) return;
      camera.current?.easeTo({ ...golden.restaurantSettledCamera(at), padding, duration: golden.RESTAURANT_SETTLE_MS, easing: 'ease' });
    }, golden.RESTAURANT_FLY_MS + 50);
  };

  useEffect(() => () => clearTimeout(settleTimer.current), []);

  useEffect(() => {
    if (ready) frame(false);
     
  }, [ready, size.w, size.h]);

  useEffect(() => {
    if (ready) frame(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const sourceOf = (l: (typeof layers)[number]) => ('source' in l ? l.source : '');
  const layerProps = (l: (typeof layers)[number]) => ({ ...l, beforeId: golden.GOLDEN_FIRST_LABEL }) as unknown as LayerProps;

  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: theme.colors.bg }]} onLayout={onLayout} testID="restaurant-map">
      <ml.Map
        ref={map}
        style={StyleSheet.absoluteFill}
        mapStyle={style}
        attribution={false}
        logo={false}
        compass={false}
        onDidFinishLoadingMap={() => setReady(true)}
        onDidFailLoadingMap={onFail}
        onDidFinishRenderingMapFully={faceStreets}
        onRegionDidChange={faceStreets}
      >
        <ml.Camera ref={camera} maxZoom={20} initialViewState={shops[0] ? { center: shops[0].at, zoom: 15 } : { zoom: 14 }} />
        <ml.Images images={images} />
        {lite ? null : (
          <>
            <ml.GeoJSONSource id={golden.RESTAURANT_SOURCES.solid} data={scene.solid as GeoJSON.FeatureCollection}>
              {layers.filter((l) => sourceOf(l) === golden.RESTAURANT_SOURCES.solid).map((l) => <ml.Layer key={l.id} {...layerProps(l)} />)}
            </ml.GeoJSONSource>
            <ml.GeoJSONSource id={golden.RESTAURANT_SOURCES.soft} data={scene.soft as GeoJSON.FeatureCollection}>
              {layers.filter((l) => sourceOf(l) === golden.RESTAURANT_SOURCES.soft).map((l) => <ml.Layer key={l.id} {...layerProps(l)} />)}
            </ml.GeoJSONSource>
            <ml.GeoJSONSource id={golden.RESTAURANT_SOURCES.glow} data={scene.glow as GeoJSON.FeatureCollection}>
              {layers.filter((l) => sourceOf(l) === golden.RESTAURANT_SOURCES.glow).map((l) => <ml.Layer key={l.id} {...layerProps(l)} />)}
            </ml.GeoJSONSource>
          </>
        )}
        {shops
          .filter((s) => s.id !== selectedId)
          .map((s) => (
            <ml.Marker key={s.id} id={`pin-${s.id}`} lngLat={s.at} anchor="bottom">
              {/* A saffron disc with the food mark in a date-brown ring, and the name under it. */}
              <Pressable
                onPress={() => onSelect(s.id)}
                accessibilityRole="button"
                accessibilityLabel={t('restaurant_map.pin_label', { name: s.card.name, cuisine: s.card.cuisine })}
                testID={`restaurant-pin-${s.id}`}
                style={styles.pin}
              >
                <View style={{ width: PIN, height: PIN, borderRadius: PIN / 2, borderWidth: 3, borderColor: theme.colors.text, backgroundColor: s.card.open ? theme.colors.accent : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="food" size={17} color="text" strokeWidth={2.2} />
                </View>
                <View style={{ marginTop: 3, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: withAlpha(theme.colors.surface, 0.94), maxWidth: 140 }}>
                  <Text variant="caption" weight={700} numberOfLines={1}>
                    {s.card.name}
                  </Text>
                </View>
              </Pressable>
            </ml.Marker>
          ))}
      </ml.Map>
    </View>
  );
}

const styles = StyleSheet.create({
  // Min 44 px tap target: the disc plus its name.
  pin: { alignItems: 'center', minWidth: 44, minHeight: 44 },
});
