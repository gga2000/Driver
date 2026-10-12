import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { Map as MlMap } from 'maplibre-gl';
import { Text, useTheme } from '@driver/ui';
import { goldenMapUrls } from '@/features/area/golden-zones';
import type { SpotMapProps } from './SpotMap';

export type { SpotMapProps } from './SpotMap';

// Inlined by the build (Expo only replaces `process.env.EXPO_PUBLIC_*` written out in full).
const URLS = goldenMapUrls({ EXPO_PUBLIC_MAP_TILES_URL: process.env.EXPO_PUBLIC_MAP_TILES_URL, EXPO_PUBLIC_MAP_GLYPHS_URL: process.env.EXPO_PUBLIC_MAP_GLYPHS_URL });

/** Web with our map files: the day map under a fixed pin. */
export const SPOT_MAP = !!URLS;

/** Close enough to see which side of the street the cart is on. */
const ZOOM = 17;
let protocolAdded = false;

/**
 * «فتحت هنا» (v1): the Golden hour map in day light (pin-setting maps are always the day map), flat
 * and light for a phone at the roadside. The pin stays in the middle, saffron in a cream ring with
 * «إنت هنا: يم …» over it; moving the map moves the spot under it.
 */
export function SpotMap({ at, bubble, onMove, onFail, height }: SpotMapProps) {
  const theme = useTheme();
  const container = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MlMap | null>(null);
  const live = useRef({ onMove, onFail });
  live.current = { onMove, onFail };

  useEffect(() => {
    if (!URLS) return;
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
        const { style } = golden.chooseMapStyle({ tilesUrl: URLS.tilesUrl, glyphsUrl: URLS.glyphsUrl, mode: 'lite', light: 'day', fallback: { theme: 'light' } });
        try {
          map = new maplibregl.Map({ container: container.current, style, center: [at.lng, at.lat], zoom: ZOOM, attributionControl: { compact: true }, dragRotate: false, touchPitch: false, pitchWithRotate: false, fadeDuration: 0 });
        } catch {
          live.current.onFail();
          return;
        }
        mapRef.current = map;
        const m = map;
        for (const [id, img] of Object.entries(golden.goldenImages('day'))) m.addImage(id, img);
        stopWatching = golden.fallBackToOriginalMap(m as unknown as Parameters<typeof golden.fallBackToOriginalMap>[0], { onFallback: () => live.current.onFail() });
        m.on('error', () => undefined);
        m.once('load', () => m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
        m.on('moveend', () => {
          const c = m.getCenter();
          live.current.onMove({ lat: c.lat, lng: c.lng });
        });
      })
      .catch(() => live.current.onFail());
    return () => {
      cancelled = true;
      stopWatching();
      map?.remove();
      mapRef.current = null;
    };
    // Built once; a new starting point is eased to below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const c = m.getCenter();
    if (Math.abs(c.lat - at.lat) > 1e-6 || Math.abs(c.lng - at.lng) > 1e-6) m.jumpTo({ center: [at.lng, at.lat] });
  }, [at.lat, at.lng]);

  const ring = 64;
  return (
    <View testID="cart-spot-map" style={{ height, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
      <div ref={container} style={{ position: 'absolute', inset: 0 }} />
      {/* The pin: fixed in the middle, the map moves under it. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ alignItems: 'center', transform: [{ translateY: -(ring / 2 + 30) }] }}>
          <View style={{ paddingHorizontal: theme.space[3], paddingVertical: 6, borderRadius: 999, backgroundColor: theme.colors.text, marginBottom: theme.space[2] }}>
            <Text variant="footnote" weight={600} style={{ color: theme.colors.bg }} numberOfLines={1}>
              {bubble}
            </Text>
          </View>
          <View style={{ width: ring, height: ring, borderRadius: ring / 2, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', ...theme.elevation[2] }}>
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.accent }} />
          </View>
          <View style={{ width: 3, height: 14, borderRadius: 2, backgroundColor: theme.colors.surface }} />
        </View>
      </View>
    </View>
  );
}
