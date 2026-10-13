import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { Map as MlMap } from 'maplibre-gl';
import { useTheme } from '@driver/ui';
import { CITY_CENTRE, DOOR_MAP_URLS, DOOR_ZOOM, roundDoor, type DoorMapProps } from './door';
import { DoorPin } from './DoorPin';

let protocolAdded = false;

/**
 * Her door on the day map (web): she drags the streets under the fixed pin until it sits on her door.
 * Without map files, without WebGL, or when our map file doesn't answer, the screen asks for a landmark.
 */
export function DoorMap({ value, onChange, onUnavailable, height }: DoorMapProps) {
  const theme = useTheme();
  const container = useRef<HTMLDivElement | null>(null);
  const live = useRef({ onChange, onUnavailable });
  live.current = { onChange, onUnavailable };
  const start = useRef(value ?? CITY_CENTRE);

  useEffect(() => {
    const urls = DOOR_MAP_URLS;
    if (!urls) {
      live.current.onUnavailable();
      return;
    }
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
        // Pin-setting maps are always the day map (Ali), whatever the hour.
        const { light } = golden.resolveLight({ light: 'day' });
        const { style } = golden.chooseMapStyle({ tilesUrl: urls.tilesUrl, glyphsUrl: urls.glyphsUrl, mode: 'lite', light, fallback: { theme: 'light' } });
        try {
          map = new maplibregl.Map({ container: container.current, style, center: [start.current.lng, start.current.lat], zoom: DOOR_ZOOM, minZoom: 12, maxZoom: 19, attributionControl: { compact: true }, dragRotate: false, touchPitch: false, pitchWithRotate: false, fadeDuration: 0 });
        } catch {
          live.current.onUnavailable();
          return;
        }
        const m = map;
        for (const [id, img] of Object.entries(golden.goldenImages(light))) m.addImage(id, img);
        stopWatching = golden.fallBackToOriginalMap(m as unknown as Parameters<typeof golden.fallBackToOriginalMap>[0], { onFallback: () => live.current.onUnavailable() });
        m.on('error', () => undefined);
        m.once('load', () => m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
        m.on('moveend', () => {
          const c = m.getCenter();
          live.current.onChange(roundDoor({ lat: c.lat, lng: c.lng }));
        });
      })
      .catch(() => live.current.onUnavailable());
    return () => {
      cancelled = true;
      stopWatching();
      map?.remove();
    };
  }, []);

  return (
    <View testID="door-map" style={{ height, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      <DoorPin />
    </View>
  );
}
