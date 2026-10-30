import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import { useLiteMode, useTheme } from '@driver/ui';
import { goldenMapUrls, zoneBounds, zoneFeatures } from './golden-zones';
import { fitZoneMap, mapPoints } from './logic';
import { ZoneMapSvg, type MapZone, type ZoneMapProps } from './ZoneMapSvg';

export type { MapZone, ZoneMapProps } from './ZoneMapSvg';

// Inlined by the build (Expo only replaces `process.env.EXPO_PUBLIC_*` written out in full).
const URLS = goldenMapUrls({ EXPO_PUBLIC_MAP_TILES_URL: process.env.EXPO_PUBLIC_MAP_TILES_URL, EXPO_PUBLIC_MAP_GLYPHS_URL: process.env.EXPO_PUBLIC_MAP_GLYPHS_URL });

/**
 * Web: the zones on the Golden hour street map (Ali 2026-10-09, `docs/specs/2026-10-09-map-golden-hour-design.md`),
 * flat like the Console's zone map (`lite`: no 3D, shadows or patterns on a counter tablet). The plain
 * drawing stays the fallback: when the map's addresses aren't set, in low-data mode, without WebGL, and
 * when our map file doesn't answer within 10 s (`fallBackToOriginalMap`).
 */
export function ZoneMap<Z extends MapZone>(props: ZoneMapProps<Z>) {
  const lite = useLiteMode();
  const [failed, setFailed] = useState(false);
  if (!URLS || lite || failed) return <ZoneMapSvg {...props} />;
  return <GoldenZoneMap {...props} urls={URLS} onFail={() => setFailed(true)} />;
}

const SOURCE = 'driver-zones';
let protocolAdded = false;

function GoldenZoneMap<Z extends MapZone>({ zones, kitchen, shade, selectedKey, onSelect, maxHeight, label, testID, urls, onFail }: ZoneMapProps<Z> & { urls: { tilesUrl: string; glyphsUrl: string }; onFail: () => void }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  // Same box as the drawing, so the screen keeps its layout whichever map it gets.
  const height = useMemo(() => (width > 0 ? fitZoneMap(mapPoints(zones, kitchen), width, maxHeight).height : 0), [zones, kitchen, width, maxHeight]);
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const data = useMemo(() => zoneFeatures(zones, shade, selectedKey, kitchen), [zones, shade, selectedKey, kitchen]);
  const bounds = useMemo(() => zoneBounds(zones, kitchen), [zones, kitchen]);
  const live = useRef({ data, bounds, onSelect, onFail });
  live.current = { data, bounds, onSelect, onFail };
  const ink = { text: theme.colors.text, muted: theme.colors.textMuted, surface: theme.colors.surface };

  useEffect(() => {
    if (height === 0) return;
    let cancelled = false;
    let stopWatching = () => undefined as void;
    let map: MlMap | null = null;
    void Promise.all([import('maplibre-gl'), import('pmtiles'), import('@driver/map'), import('@driver/map/golden')])
      .then(([ml, pm, base, golden]) => {
        const maplibregl = (ml as unknown as { default?: typeof ml }).default ?? ml;
        if (cancelled || !container.current) return;
        if (!protocolAdded) {
          protocolAdded = true;
          maplibregl.addProtocol('pmtiles', new pm.Protocol().tile);
          if (maplibregl.getRTLTextPluginStatus() === 'unavailable') void maplibregl.setRTLTextPlugin(base.RTL_TEXT_PLUGIN_URL, true);
        }
        const { light } = golden.resolveLight();
        const { style } = golden.chooseMapStyle({ tilesUrl: urls.tilesUrl, glyphsUrl: urls.glyphsUrl, mode: 'lite', light, fallback: { theme: 'light' } });
        const b = live.current.bounds;
        try {
          map = new maplibregl.Map({
            container: container.current,
            style,
            ...(b ? { bounds: b, fitBoundsOptions: { padding: 16 } } : { center: [45.067, 32.9], zoom: 13 }),
            attributionControl: { compact: true },
            dragRotate: false,
            dragPan: false,
            scrollZoom: false,
            boxZoom: false,
            doubleClickZoom: false,
            touchZoomRotate: false,
            touchPitch: false,
            keyboard: false,
            fadeDuration: 0,
          });
        } catch {
          live.current.onFail();
          return;
        }
        mapRef.current = map;
        const m = map;
        for (const [id, img] of Object.entries(golden.goldenImages(light))) m.addImage(id, img);
        // Our map file not answering → the plain drawing (the original street map would be a third look here).
        stopWatching = golden.fallBackToOriginalMap(m as unknown as Parameters<typeof golden.fallBackToOriginalMap>[0], { onFallback: () => live.current.onFail() });
        m.on('error', () => undefined);
        m.once('load', () => {
          // The credit line folded to its «i» (a tap opens it), so it never covers the zones.
          m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
          const before = m.getLayer(golden.GOLDEN_FIRST_LABEL) ? golden.GOLDEN_FIRST_LABEL : undefined;
          m.addSource(SOURCE, { type: 'geojson', data: live.current.data as never });
          const zone = ['==', ['get', 'kind'], 'zone'] as never;
          m.addLayer({ id: 'driver-zone-fill', type: 'fill', source: SOURCE, filter: zone, paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.72 } }, before);
          m.addLayer({ id: 'driver-zone-line', type: 'line', source: SOURCE, filter: ['all', zone, ['!', ['get', 'dashed']], ['!', ['get', 'selected']]] as never, paint: { 'line-color': ink.surface, 'line-width': 1.25 } }, before);
          m.addLayer({ id: 'driver-zone-line-off', type: 'line', source: SOURCE, filter: ['all', zone, ['get', 'dashed'], ['!', ['get', 'selected']]] as never, paint: { 'line-color': ink.muted, 'line-width': 1.25, 'line-dasharray': [4, 3] } }, before);
          m.addLayer({ id: 'driver-zone-selected', type: 'line', source: SOURCE, filter: ['all', zone, ['get', 'selected']] as never, paint: { 'line-color': ink.text, 'line-width': 3 } });
          m.addLayer({ id: 'driver-zone-dot', type: 'circle', source: SOURCE, filter: ['==', ['get', 'kind'], 'dot'] as never, paint: { 'circle-radius': 6, 'circle-color': ['get', 'fill'], 'circle-stroke-color': ['case', ['get', 'selected'], ink.text, ink.muted] as never, 'circle-stroke-width': ['case', ['get', 'selected'], 3, 1.25] as never } });
          m.addLayer({ id: 'driver-kitchen', type: 'circle', source: SOURCE, filter: ['==', ['get', 'kind'], 'kitchen'] as never, paint: { 'circle-radius': 7, 'circle-color': ink.text, 'circle-stroke-color': ink.surface, 'circle-stroke-width': 2 } });
          m.addLayer({ id: 'driver-kitchen-core', type: 'circle', source: SOURCE, filter: ['==', ['get', 'kind'], 'kitchen'] as never, paint: { 'circle-radius': 3, 'circle-color': ink.surface } });
        });
        m.on('click', (e) => {
          const hit = m.queryRenderedFeatures(e.point, { layers: ['driver-zone-fill', 'driver-zone-dot'] })[0];
          const key = hit?.properties?.key as string | undefined;
          if (key) live.current.onSelect?.(key);
        });
      })
      .catch(() => live.current.onFail());
    return () => {
      cancelled = true;
      stopWatching();
      map?.remove();
      mapRef.current = null;
    };
    // Built once per size; zones and the selection update in place below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height > 0, urls.tilesUrl, urls.glyphsUrl]);

  useEffect(() => {
    mapRef.current?.getSource<GeoJSONSource>(SOURCE)?.setData(data as never);
  }, [data]);
  useEffect(() => {
    if (height > 0) mapRef.current?.resize();
  }, [height, width]);

  return (
    <View testID={testID} onLayout={onLayout} accessibilityRole="image" accessibilityLabel={label} style={{ width: '100%', height: height || undefined, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
      <div ref={container} data-testid="zone-map-golden" style={{ position: 'absolute', inset: 0, cursor: onSelect ? 'pointer' : 'default' }} />
    </View>
  );
}
